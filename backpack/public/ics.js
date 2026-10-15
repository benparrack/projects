// Minimal iCalendar (.ics) reader for LMS calendar feeds (Canvas, Schoology, ...).

const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  // All-day items count as due at the end of that day.
  if (!h) return { due: new Date(+y, mo - 1, +d, 23, 59).toISOString(), allDay: true };
  const parts = [+y, mo - 1, +d, +h, +mi, +s];
  // shortcut: TZID times are read as the device's local time; fine while the student is in the school's timezone.
  return { due: (z ? new Date(Date.UTC(...parts)) : new Date(...parts)).toISOString(), allDay: false };
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
    const name = line.slice(0, i).split(';')[0].toUpperCase(), value = line.slice(i + 1);
    if (!ev) { if (name === 'X-WR-CALNAME') calName = unescape(value); continue; }
    if (name === 'UID') ev.uid = value;
    else if (name === 'SUMMARY') ev.summary = unescape(value);
    else if (name === 'DESCRIPTION') ev.description = unescape(value);
    else if (name === 'URL') ev.url = value;
    else if (name === 'DTSTART') Object.assign(ev, parseDate(value));
  }
  return { calName, events };
}

// Turn a feed into planner items. Canvas writes "Title [Course]" in SUMMARY.
export function feedItems(text, feedUrl) {
  const { calName, events } = parseICS(text);
  const fallback = calName || new URL(feedUrl.replace(/^webcal:/i, 'https:')).hostname;
  return events.map((ev) => {
    const m = (ev.summary || '').match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    return {
      uid: ev.uid,
      title: (m ? m[1] : ev.summary) || '(untitled)',
      course: m ? m[2] : fallback,
      due: ev.due,
      allDay: ev.allDay,
      url: /^https?:\/\//.test(ev.url || '') ? ev.url : '',
      feed: feedUrl,
    };
  });
}
