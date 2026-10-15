// Phone I/O via ntfy.sh (same pattern as money/flip-bot): alerts out, typed replies back in.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { meta } from './db.js';

const NTFY = 'https://ntfy.sh';

// Secret topics are generated once and kept in the (git-ignored) db.
export function topics() {
  for (const k of ['alert', 'reply'])
    if (!meta.get('ntfy:' + k)) meta.set('ntfy:' + k, `intern-${k}-` + randomBytes(9).toString('base64url').replace(/[-_]/g, ''));
  return { alert: meta.get('ntfy:alert'), reply: meta.get('ntfy:reply') };
}

export async function send(title, message, { click, actions = [], tags = [] } = {}) {
  if (process.env.NO_NOTIFY) return console.log(`[ntfy] ${title}: ${message}`);
  // Also on the laptop screen, for when Ben is at it rather than on his phone.
  spawn('notify-send', ['-a', 'Internship Bot', '-i', 'internship-bot', title, message], { stdio: 'ignore' }).on('error', () => {});
  const body = { topic: topics().alert, title, message, tags, ...(click ? { click } : {}),
    actions: actions.slice(0, 3) };        // ntfy allows max 3 buttons
  const r = await fetch(NTFY, { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) console.error(`ntfy ${r.status}`);
}

// One-tap answer button: posts the reply text to the reply topic.
export const replyButton = (label, text) =>
  ({ action: 'http', label: label.slice(0, 40), url: `${NTFY}/${topics().reply}`, method: 'POST', body: text, clear: true });

// New replies since last poll, as plain strings.
export async function pollReplies() {
  const since = meta.get('ntfy:since') || 'all';
  const r = await fetch(`${NTFY}/${topics().reply}/json?poll=1&since=${since}`);
  if (!r.ok) return [];
  const msgs = (await r.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.event === 'message');
  if (msgs.length) meta.set('ntfy:since', msgs.at(-1).id);
  return msgs.map(m => m.message);
}
