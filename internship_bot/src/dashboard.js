// Local dashboard: http://localhost:8377  (npm run dashboard)
// Everything Ben does by hand lives here: answer questions, review + approve applications,
// apply-yourself list, outcomes, insights, profile editing, settings.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, openSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import YAML from 'yaml';
import { db, meta } from './db.js';
import { handleReply, syncReplies } from './queue.js';
import { learn, normQ, filePath } from './profile.js';
import { lessons } from './answer.js';
import { topics } from './notify.js';
import { adapterFor } from './apply.js';

const PORT = +process.env.PORT || 8377;
const ROOT = new URL('..', import.meta.url).pathname;
const PROFILE_FILES = ['profile.yaml', 'stories.md', 'answers.yaml'];
const OUTCOMES = ['', 'confirmed', 'oa', 'interview', 'offer', 'rejected', 'withdrawn'];
const LOG = ROOT + 'data/run.log';

const all = (sql, ...a) => db.prepare(sql).all(...a);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const audit = j => { try { return JSON.parse(j.answers || '{}'); } catch { return {}; } };
const ATS = [[/greenhouse/, 'Greenhouse'], [/ashbyhq/, 'Ashby'], [/lever\.co/, 'Lever'], [/workday/, 'Workday'], [/icims/, 'iCIMS'],
  [/oraclecloud/, 'Oracle'], [/smartrecruiters/, 'SmartRecruiters'], [/tiktok|bytedance/, 'TikTok/ByteDance'], [/taleo/, 'Taleo'], [/workable/, 'Workable']];
const ats = url => ATS.find(([re]) => re.test(url))?.[1] ?? (() => { try { return new URL(url).hostname.replace(/^(www|jobs|careers)\./, ''); } catch { return 'Other'; } })();
const formUrl = u => /ashbyhq/.test(u) && !/\/application/.test(u) ? u.replace(/[?#].*$/, '') + '/application'
  : /lever\.co/.test(u) && !/\/apply/.test(u) ? u.replace(/[?#].*$/, '') + '/apply' : u;
const responded = o => ['oa', 'interview', 'offer', 'rejected'].includes(o);
const advanced = o => ['oa', 'interview', 'offer'].includes(o);

// Form answers as reviewable rows. Old dry runs stored [key, label] without a type.
function items(j) {
  const a = audit(j);
  return (a.questions || []).filter(([k]) => a.answers?.[k] != null).map(([key, label, type]) => {
    const v = a.answers[key];
    type ||= /^\/.*\.\w{2,4}$/.test(v) ? 'file' : Array.isArray(v) ? 'multiselect' : String(v).length > 120 ? 'textarea' : 'text';
    return { key, label, type, value: type === 'file' ? basename(String(v)) : Array.isArray(v) ? v.join(' | ') : String(v), ...(type === 'file' && { path: String(v) }) };
  });
}

function runner() {
  let pid = 0;
  try { pid = +readFileSync(ROOT + 'data/run.lock', 'utf8'); process.kill(pid, 0); } catch { pid = 0; }
  const log = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').slice(-40).join('\n') : '';
  return { running: !!pid, current: meta.get('run:current') || '', log };
}

function startRun(args) {
  if (runner().running) return false;
  const out = openSync(LOG, 'w');
  spawn(process.execPath, ['--no-warnings', ROOT + 'src/run.js', ...args], { cwd: ROOT, stdio: ['ignore', out, out], detached: true }).unref();
  return true;
}

// What's working: response/interview rates split by things the bot controls.
export function insights(rows) {
  const apps = rows.filter(r => r.status === 'applied');
  const dims = {
    'Resume version': r => /emb/.test(audit(r).answers?.resume || '') ? 'Embedded' : 'SWE',
    'Form type': r => ats(r.url),
    'Role category': r => r.category || 'Uncategorized',
    'How fast after posting': r => { const h = (r.applied_at - r.posted) / 36e5;
      return !r.applied_at || !r.posted ? 'Unknown' : h < 24 ? 'Within a day' : h < 72 ? '1-3 days' : 'Later'; },
    'Written answers': r => (audit(r).questions || []).some(([, , t]) => t === 'textarea') ? 'Had essays' : 'No essays',
    'Applied by': r => r.reason === 'applied by Ben' ? 'Ben' : 'Bot',
  };
  const split = Object.entries(dims).map(([name, f]) => {
    const g = {};
    for (const r of apps) (g[f(r)] ??= []).push(r);
    return { name, groups: Object.entries(g).map(([k, rs]) => ({ group: k, n: rs.length,
      responses: rs.filter(r => responded(r.outcome)).length, advanced: rs.filter(r => advanced(r.outcome)).length }))
      .sort((a, b) => b.n - a.n) };
  });
  // A finding needs at least 5 applications on each side before it means anything.
  const findings = split.flatMap(({ name, groups }) => {
    const ok = groups.filter(g => g.n >= 5 && g.group !== 'Unknown');
    if (ok.length < 2) return [];
    const rate = g => g.advanced / g.n, best = ok.reduce((a, b) => rate(b) > rate(a) ? b : a);
    const rest = ok.filter(g => g !== best), other = rest.reduce((s, g) => ({ n: s.n + g.n, a: s.a + g.advanced }), { n: 0, a: 0 });
    return rate(best) > other.a / other.n ? [`${name}: "${best.group}" got to an OA/interview ${Math.round(rate(best) * 100)}% of the time vs ${Math.round(other.a / other.n * 100)}% otherwise (${best.n} vs ${other.n} applications).`] : [];
  });
  const day = 864e5, start = new Date().setHours(0, 0, 0, 0) - 29 * day;
  const perDay = Array.from({ length: 30 }, (_, i) => ({ day: new Date(start + i * day).toISOString().slice(5, 10),
    n: apps.filter(r => r.applied_at >= start + i * day && r.applied_at < start + (i + 1) * day).length }));
  const count = o => apps.filter(r => r.outcome === o).length;
  return {
    funnel: { applied: apps.length, responded: apps.filter(r => responded(r.outcome)).length, oa: count('oa'),
      interview: count('interview'), offer: count('offer'), rejected: count('rejected'),
      silent: apps.filter(r => !responded(r.outcome) && Date.now() - r.applied_at > 21 * day).length },
    split, findings, perDay, ...lessons(),
  };
}

function state() {
  const rows = all('SELECT * FROM jobs');
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM jobs GROUP BY status').map(c => [c.status, c.n]));
  const queued = rows.filter(r => r.status === 'queued');
  const waitingOn = norm => queued.filter(j => { try { return JSON.parse(j.reason).some(x => normQ(x.label) === norm); } catch { return false; } });
  const pick = (r, ...extra) => ({ id: r.id, company: r.company, title: r.title, url: r.url, posted: r.posted,
    locations: JSON.parse(r.locations || '[]').slice(0, 3), category: r.category, ats: ats(r.url), form: formUrl(r.url), ...Object.fromEntries(extra.map(k => [k, r[k]])) });
  const emails = all('SELECT * FROM emails ORDER BY received');
  const byStatus = s => rows.filter(r => r.status === s).sort((a, b) => b.updated - a.updated);
  return {
    counts,
    questions: all("SELECT * FROM questions WHERE status='open' ORDER BY id").map(q => ({ id: q.id, label: q.label,
      options: JSON.parse(q.options || '[]'), multi: /select all|all that apply|check all/i.test(q.label), jobs: waitingOn(q.norm).map(j => j.company) })),
    approvals: byStatus('dryrun').map(r => ({ ...pick(r, 'updated'), shot: !!r.screenshot && existsSync(r.screenshot), items: items(r) })),
    manual: byStatus('manual').map(r => ({ ...pick(r, 'reason', 'updated'), items: items(r) })),
    history: rows.filter(r => r.status === 'applied').sort((a, b) => b.applied_at - a.applied_at)
      .map(r => ({ ...pick(r, 'applied_at', 'outcome', 'outcome_at', 'notes', 'reason'), shot: !!r.screenshot && existsSync(r.screenshot),
        items: items(r), emails: emails.filter(e => e.job_id === r.id) })),
    pipeline: {
      ...(() => {
        const waiting = rows.filter(r => r.status === 'new').sort((a, b) => b.posted - a.posted);
        const ok = waiting.filter(r => adapterFor(r.url)), no = waiting.filter(r => !adapterFor(r.url));
        const by = {};
        for (const r of no) by[ats(r.url)] = (by[ats(r.url)] || 0) + 1;
        return { next: ok.slice(0, 40).map(r => pick(r)), nextCount: ok.length, unsupported: no.slice(0, 40).map(r => pick(r)),
          unsupportedCount: no.length, unsupportedBy: Object.entries(by).map(([ats, n]) => ({ ats, n })).sort((a, b) => b.n - a.n) };
      })(),
      approved: byStatus('approved').map(r => pick(r)),
      queued: queued.map(r => pick(r, 'reason')),
      failed: byStatus('failed').map(r => pick(r, 'reason', 'updated')),
      skipped: all("SELECT reason, COUNT(*) n FROM jobs WHERE status='skipped' GROUP BY reason ORDER BY n DESC"),
      bySource: all('SELECT source, COUNT(*) n FROM jobs GROUP BY source'),
    },
    insights: insights(rows),
    settings: { auto_submit: meta.get('auto_submit') === '1', daily_cap: +(meta.get('daily_cap') || 25),
      mail: existsSync(ROOT + 'data/mail.json') ? JSON.parse(readFileSync(ROOT + 'data/mail.json', 'utf8')).user : '',
      mail_checked: +(meta.get('mail:checked') || 0), ntfy: topics(), last_fetch: +(meta.get('fetch:at') || 0),
      workday: meta.get('workday_accounts') === '1',
      workday_accounts: existsSync(ROOT + 'data/workday.json') ? Object.keys(JSON.parse(readFileSync(ROOT + 'data/workday.json', 'utf8'))).length : 0 },
    runner: runner(),
  };
}

// Approve: save Ben's edits (learned for next time), then hand the job to the runner.
function approve({ id, edits = {} }) {
  const j = one('SELECT * FROM jobs WHERE id=?', id);
  if (!j || j.status !== 'dryrun') throw new Error('not awaiting approval');
  const a = audit(j), labels = Object.fromEntries((a.questions || []).map(([k, l]) => [k, l]));
  const log = JSON.parse(meta.get('edits') || '[]');
  for (const [k, v] of Object.entries(edits)) {
    const before = a.answers[k];
    if (before == null || Array.isArray(before) || String(before) === v) continue;
    a.answers[k] = v;
    learn(labels[k], v);
    if (String(before).length > 80) log.push({ question: labels[k], draft: before, ben: v });
  }
  meta.set('edits', JSON.stringify(log.slice(-20)));
  db.prepare("UPDATE jobs SET status='approved', answers=?, updated=? WHERE id=?").run(JSON.stringify(a), Date.now(), id);
  startRun(['--approved']);
}

let watcher = null;
const routes = {
  'GET /api/state': () => state(),
  'POST /api/answer': ({ id, answer, skip }) => {
    if (!handleReply(skip ? `skip ${id}` : `${id} ${String(answer).trim()}`)) throw new Error('empty answer');
    return syncReplies();
  },
  'POST /api/approve': b => (approve(b), { ok: true }),
  // Ashby flags the bot's browser as spam, so Ben sends those himself (Open form + Copy).
  'POST /api/approve-all': () => { for (const { id } of all("SELECT id FROM jobs WHERE status='dryrun' AND url NOT LIKE '%ashbyhq%'")) approve({ id }); return { ok: true }; },
  'POST /api/reject': ({ id }) => db.prepare("UPDATE jobs SET status='skipped', reason='Ben passed on it', updated=? WHERE id=?").run(Date.now(), id),
  'POST /api/redo': ({ id }) => db.prepare("UPDATE jobs SET status='new', reason=NULL, updated=? WHERE id=?").run(Date.now(), id),
  'POST /api/manual-done': ({ id, applied }) => applied
    ? db.prepare("UPDATE jobs SET status='applied', reason='applied by Ben', applied_at=?, updated=? WHERE id=?").run(Date.now(), Date.now(), id)
    : db.prepare("UPDATE jobs SET status='skipped', reason='Ben passed on it', updated=? WHERE id=?").run(Date.now(), id),
  'POST /api/outcome': ({ id, outcome, notes }) => {
    if (!OUTCOMES.includes(outcome)) throw new Error('bad outcome');
    db.prepare('UPDATE jobs SET outcome=?, outcome_at=?, notes=? WHERE id=?').run(outcome, Date.now(), notes ?? null, id);
  },
  'POST /api/run': ({ apply = 5, live = false }) => ({ started: startRun(['--apply', String(+apply || 5), ...(live ? ['--live'] : [])]) }),
  'POST /api/settings': ({ auto_submit, daily_cap, workday }) => {
    if (auto_submit != null) meta.set('auto_submit', auto_submit ? '1' : '0');
    if (workday != null) meta.set('workday_accounts', workday ? '1' : '0');
    if (daily_cap != null) meta.set('daily_cap', String(Math.max(0, Math.min(200, +daily_cap || 0))));
  },
  'POST /api/mail': ({ user, password }) => {
    writeFileSync(ROOT + 'data/mail.json', JSON.stringify({ user, password: password.replace(/\s+/g, '') }), { mode: 0o600 });
  },
  // A page can't resize a maximized window, so tile.py (un)maximizes the dashboard first.
  // Open form starts an inbox watch for that job's confirmation (one at a time).
  'POST /api/watch': ({ id }) => {
    if (!one('SELECT id FROM jobs WHERE id=?', id) || !existsSync(ROOT + 'data/mail.json')) return { ok: false };
    try { watcher?.kill(); } catch {}
    watcher = spawn('python3', [ROOT + 'src/mail.py', '--watch', id, String(Date.now() / 1000)], { cwd: ROOT, stdio: 'ignore' });
    return { ok: true };
  },
  'GET /api/status': ({ id }) => ({ status: one('SELECT status FROM jobs WHERE id=?', id)?.status }),
  'POST /api/tile': ({ mode }) => (spawnSync('python3', [ROOT + 'src/tile.py', mode === 'max' ? 'max' : 'unmax'], { timeout: 5000 }), { ok: true }),
  'POST /api/mail-check': () => new Promise(res => {
    const p = spawn('python3', [ROOT + 'src/mail.py'], { cwd: ROOT });
    let out = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', () => res({ out }));
  }),
  'GET /api/profile': ({ file }) => {
    if (!PROFILE_FILES.includes(file)) throw new Error('unknown file');
    return { text: readFileSync(ROOT + 'profile/' + file, 'utf8') };
  },
  'POST /api/profile': ({ file, text }) => {
    if (!PROFILE_FILES.includes(file)) throw new Error('unknown file');
    if (file.endsWith('.yaml')) YAML.parse(text);           // refuse to save broken YAML
    writeFileSync(ROOT + 'profile/' + file, text);
  },
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  try {
    if (url.pathname === '/') return send(200, readFileSync(ROOT + 'src/dashboard.html'), 'text/html; charset=utf-8');
    const shot = url.pathname.match(/^\/shots\/(\w+)\.png$/);
    if (shot) {
      const j = one('SELECT screenshot FROM jobs WHERE id=?', shot[1]);
      return j?.screenshot && existsSync(j.screenshot) ? send(200, readFileSync(j.screenshot), 'image/png') : send(404, 'no screenshot', 'text/plain');
    }
    const file = url.pathname.match(/^\/files\/([\w-]+\.pdf)$/), fp = file && filePath(file[1]);
    if (file) return fp ? send(200, readFileSync(fp), 'application/pdf') : send(404, 'no such file', 'text/plain');
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(404, '{"error":"not found"}');
    // Only this page may call the API (blocks other sites from POSTing to localhost).
    if (req.method === 'POST' && req.headers['x-dashboard'] !== '1') return send(403, '{"error":"forbidden"}');
    let body = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') { let s = ''; for await (const c of req) s += c; body = s ? JSON.parse(s) : {}; }
    send(200, JSON.stringify((await route(body)) ?? { ok: true }));
  } catch (e) { send(400, JSON.stringify({ error: e.message })); }
}).listen(PORT, '127.0.0.1', () => console.log(`dashboard: http://localhost:${PORT}`));
