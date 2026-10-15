// Minimal iCalendar (.ics) reader for LMS calendar feeds (Canvas, Schoology, ...).
// Feed formats checked against Canvas's source (CalendarEvent#to_ics) and two
// open-source Schoology feed parsers; see the tests for the shapes.

const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

export const typeOf = (title) => (/\b(exams?|midterms?|tests?|quiz(zes)?)\b/i.test(title) ? 'test' : undefined);

// Wall-clock time in an IANA zone -> epoch ms. Returns null for zones Intl doesn't know.
function zonedToUtc(parts, tz) {
  const guess = Date.UTC(...parts);
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const p = Object.fromEntries(f.formatToParts(new Date(guess)).map((x) => [x.type, +x.value]));
    return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess);
  } catch { return null; }
}

function parseDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // All-day items count as due at the end of that day.
  if (!h) return { due: new Date(+y, mo - 1, +d, 23, 59).toISOString(), allDay: true };
  const parts = [+y, mo - 1, +d, +h, +mi, +s];
  const tz = params.TZID?.replace(/^"|"$/g, '');
  const t = z ? Date.UTC(...parts) : (tz && zonedToUtc(parts, tz)) || new Date(...parts).getTime();
  return { due: new Date(t).toISOString(), allDay: false };
}

export function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let calName = '', ev = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') { if (ev?.uid && ev.due) events.push(ev); ev = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [rawName, ...rawParams] = line.slice(0, i).split(';');
    const name = rawName.toUpperCase(), value = line.slice(i + 1);
    const params = Object.fromEntries(rawParams.map((p) => { const [k, ...v] = p.split('='); return [k.toUpperCase(), v.join('=')]; }));
    if (!ev) { if (name === 'X-WR-CALNAME') calName = unescape(value); continue; }
    if (name === 'UID') ev.uid = value;
    else if (name === 'SUMMARY') ev.summary = unescape(value);
    else if (name === 'DESCRIPTION') ev.description = unescape(value);
    else if (name === 'URL') ev.url = value;
    else if (name === 'DTSTART') Object.assign(ev, parseDate(value, params));
  }
  return { calName, events };
}

// Canvas UIDs are "event-<type>-<id>"; Schoology links are ".../<type>/<id>".
function kindOf(uid, url) {
  if (/^event-(calendar-event|appointment|reservation)/.test(uid)) return 'event';
  const s = url.match(/schoology\.com\/([a-z_]+)\/\d+/i);
  if (s && !/assignment|assessment|discussion/i.test(s[1])) return 'event';
  return 'task';
}

// Turn a feed into planner items.
export function feedItems(text, feedUrl) {
  const { calName, events } = parseICS(text);
  const host = new URL(feedUrl.replace(/^webcal:/i, 'https:')).hostname;
  // Schoology feeds carry no class at all, so those land in "Unsorted" for the user to file.
  const fallback = /schoology/i.test(host) ? 'Unsorted' : calName || host;
  return events.map((ev) => {
    const m = (ev.summary || '').match(/^(.*?)\s*\[([^\]]+)\]\s*$/); // Canvas: "Title [COURSE CODE]"
    const desc = (ev.description || '').match(/^(.*?)\s*-\s*Link:\s*(\S+)\s*$/s); // Schoology: "text - Link: url"
    const url = ev.url || desc?.[2] || '';
    const title = (m ? m[1] : ev.summary)?.trim() || '(untitled)';
    return {
      uid: ev.uid,
      title,
      course: m ? m[2] : fallback,
      due: ev.due,
      allDay: ev.allDay,
      url: /^https?:\/\//.test(url) ? url : '',
      description: (desc ? desc[1] : ev.description || '').trim().slice(0, 2000),
      kind: kindOf(ev.uid, url),
      type: typeOf(title),
      feed: feedUrl,
    };
  });
}
