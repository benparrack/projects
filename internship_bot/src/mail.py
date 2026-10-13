#!/usr/bin/env python3
"""Reads Ben's inbox (IMAP, Gmail app password in data/mail.json) and turns replies from companies
he applied to into outcomes: confirmed / oa / interview / offer / rejected.

Only emails that match an applied company are stored (sender, subject, a short snippet).
    python3 src/mail.py            check new mail
    python3 src/mail.py --selftest classifier + matching checks, no network
"""
import email, email.header, email.utils, imaplib, json, re, sqlite3, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'data' / 'jobs.sqlite'
CREDS = ROOT / 'data' / 'mail.json'
RANK = {'': 0, 'confirmed': 1, 'oa': 2, 'interview': 3, 'rejected': 4, 'offer': 5}

# Order matters: an offer email may say "unfortunately", a rejection says "thank you for applying".
RULES = [
    ('offer', r'pleased to (extend|offer)|offer letter|extend (you )?an offer|offer of (employment|internship)'),
    ('rejected', r'unfortunately|not (be )?(moving|move) forward|decided to (pursue|move forward with|proceed with) other|'
                 r'no longer (under consideration|being considered)|other candidates|position has been filled|will not be (moving|proceeding)'),
    ('interview', r'schedule (a|an|your)? ?(call|interview|chat|time|conversation)|invite you to (an? )?(interview|chat|call)|'
                  r'next (round|step)s? (in|of) (the|our) (process|interview)|phone screen|availability for (a|an) (call|interview)'),
    ('oa', r'hackerrank|codesignal|codility|hirevue|karat|coding (challenge|assessment|exercise)|online assessment|technical assessment'),
    ('confirmed', r'received your application|thank(s| you) for (applying|your application|submitting)|application (has been |was )?(received|submitted)'),
]


def classify_rules(text):
    t = text.lower()
    return next((kind for kind, rx in RULES if re.search(rx, t)), None)


def classify(subject, body):
    """Claude reads the email (it handles "we'd love to chat" and soft rejections); regex is the fallback."""
    schema = {'type': 'object', 'required': ['kind'], 'properties': {'kind': {'enum': list(RANK)[1:] + ['other']}}}
    try:
        out = subprocess.run(['claude', '-p', '--output-format', 'json', '--model', 'haiku', '--tools', '',
                              '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
                              '--json-schema', json.dumps(schema), '--system-prompt',
                              'Classify this email a company sent to an internship applicant. confirmed = application received; '
                              'oa = online/coding assessment invite; interview = invite to talk/interview/schedule; offer = job offer; '
                              'rejected = not moving forward; other = anything else (newsletters, marketing, job alerts).',
                              f'Subject: {subject}\n\n{body[:4000]}'], capture_output=True, text=True, timeout=90)
        kind = json.loads(out.stdout)['structured_output']['kind']
        return None if kind == 'other' else kind
    except Exception:
        return classify_rules(subject + '\n' + body)


STOP = r'\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs|group|the|systems|holdings)\b'


def norm(s):
    return re.sub(r'\s+', ' ', re.sub(STOP, ' ', re.sub(r'[^a-z0-9 ]', ' ', s.lower()))).strip()


def match(jobs, sender, subject, body):
    """The applied job this email is about: company name in sender/subject first, else in the body.
    Ties go to the most recent application."""
    head, text = norm(sender + ' ' + subject), norm(body[:3000])
    for hay in (head, text):
        hits = [j for j in jobs if len(norm(j['company'])) >= 3 and re.search(rf'\b{re.escape(norm(j["company"]))}\b', hay)]
        if hits:
            return max(hits, key=lambda j: j['applied_at'] or 0)
    return None


def text_of(msg):
    def dec(part):
        raw = part.get_payload(decode=True) or b''
        return raw.decode(part.get_content_charset() or 'utf-8', 'replace')
    plain = [dec(p) for p in msg.walk() if p.get_content_type() == 'text/plain']
    if plain:
        return '\n'.join(plain)
    html = ' '.join(dec(p) for p in msg.walk() if p.get_content_type() == 'text/html')
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(style|script).*?</\1>', ' ', html)))


def header(msg, k):
    return str(email.header.make_header(email.header.decode_header(msg.get(k, ''))))


def notify(conn, title, body):
    topic = conn.execute("SELECT v FROM meta WHERE k='ntfy:alert'").fetchone()
    if not topic:
        return
    req = urllib.request.Request('https://ntfy.sh', json.dumps({'topic': topic[0], 'title': title, 'message': body, 'tags': ['tada']}).encode())
    try:
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:
        print('ntfy failed:', e)


def check():
    if not CREDS.exists():
        sys.exit('no data/mail.json: add your Gmail address + app password in the dashboard (Settings)')
    creds = json.loads(CREDS.read_text())
    conn = sqlite3.connect(DB, timeout=10)
    conn.row_factory = sqlite3.Row
    jobs = [dict(r) for r in conn.execute("SELECT id, company, title, applied_at, outcome FROM jobs WHERE status='applied'")]
    if not jobs:
        return print('no applications yet, nothing to match')
    first = min(j['applied_at'] or time.time() * 1000 for j in jobs) / 1000 - 86400
    meta = lambda k: (conn.execute('SELECT v FROM meta WHERE k=?', (k,)).fetchone() or [None])[0]
    set_meta = lambda k, v: conn.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', (k, str(v)))

    imap = imaplib.IMAP4_SSL(creds.get('host', 'imap.gmail.com'))
    imap.login(creds['user'], creds['password'])
    imap.select('INBOX', readonly=True)
    validity = imap.response('UIDVALIDITY')[1][0].decode()
    last = int(meta('mail:uid') or 0) if meta('mail:validity') == validity else 0
    crit = f'UID {last + 1}:*' if last else 'SINCE ' + time.strftime('%d-%b-%Y', time.localtime(first))
    uids = [int(u) for u in imap.uid('search', None, crit)[1][0].split() if int(u) > last]
    found = 0
    for uid in uids:
        msg = email.message_from_bytes(imap.uid('fetch', str(uid), '(BODY.PEEK[])')[1][0][1])
        sender, subject, body = header(msg, 'From'), header(msg, 'Subject'), text_of(msg)
        job = match(jobs, sender, subject, body)
        if not job:
            continue
        kind = classify(subject, body)
        if not kind:
            continue
        found += 1
        received = int(email.utils.parsedate_to_datetime(msg['Date']).timestamp() * 1000) if msg['Date'] else int(time.time() * 1000)
        conn.execute('INSERT OR IGNORE INTO emails VALUES (?,?,?,?,?,?,?)',
                     (f'{validity}:{uid}', job['id'], received, sender, subject, re.sub(r'\s+', ' ', body)[:400], kind))
        if RANK[kind] > RANK.get(job['outcome'] or '', 0):
            conn.execute('UPDATE jobs SET outcome=?, outcome_at=? WHERE id=?', (kind, received, job['id']))
            job['outcome'] = kind
            if kind in ('oa', 'interview', 'offer'):
                notify(conn, {'oa': 'Assessment', 'interview': 'Interview request', 'offer': 'OFFER'}[kind] + f": {job['company']}", subject)
        print(f'{kind:9} {job["company"]} | {subject}')
    if uids:
        set_meta('mail:uid', max(uids))
    set_meta('mail:validity', validity)
    set_meta('mail:checked', int(time.time() * 1000))
    conn.commit()
    imap.logout()
    print(f'{len(uids)} new email(s), {found} about applications')


def selftest():
    assert classify_rules('Unfortunately, we have decided to move forward with other candidates.') == 'rejected'
    assert classify_rules('Thank you for applying to Acme! We received your application.') == 'confirmed'
    assert classify_rules("Thanks for applying. Unfortunately we won't be moving forward.") == 'rejected'
    assert classify_rules('Please complete this HackerRank coding challenge within 7 days') == 'oa'
    assert classify_rules('We would like to schedule a call with you next week') == 'interview'
    assert classify_rules('We are pleased to extend an offer for the Summer 2027 internship') == 'offer'
    assert classify_rules('Our weekly newsletter') is None
    jobs = [{'company': 'DRW', 'applied_at': 1}, {'company': 'Appian Corporation', 'applied_at': 2}, {'company': 'Two Sigma', 'applied_at': 3}]
    assert match(jobs, 'Appian Recruiting <no-reply@greenhouse.io>', 'Your application', '')['company'] == 'Appian Corporation'
    assert match(jobs, 'no-reply@ashbyhq.com', 'Update', 'Thanks for your interest in Two Sigma.')['company'] == 'Two Sigma'
    assert match(jobs, 'news@sigma.com', 'Sigma news', 'nothing here') is None
    print('mail selftest ok')


if __name__ == '__main__':
    selftest() if '--selftest' in sys.argv else check()
