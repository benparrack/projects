// Daily challenge: the menu card (today's games, your result, streak, reset countdown) and the
// /daily page (today's boards). Boards come from /api/daily; your own state from the account.
import { h, toast } from './ui.js';
import { avatarEl, nameColor } from './avatars.js';
import { fmtScore } from './profile.js';

let cache = null; // { at, data }

async function load(force = false) {
  if (!force && cache && Date.now() - cache.at < 60000) return cache.data;
  const res = await fetch('/api/daily');
  if (!res.ok) throw new Error(res.status);
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

const left = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();

// What your button says for one game today.
function myState(account, type) {
  const v = account && account.daily && account.daily.games ? account.daily.games[type] : undefined;
  if (v === undefined) return null;
  if (v === 'started') return { text: 'NO SCORE', done: true }; // claimed at start; an abandoned run stays this way
  return { text: v == null ? 'DID NOT FINISH' : null, score: v, done: true };
}

// Fills `mount` (a menu slot). play(type) joins today's room; signIn() opens the sign-in modal.
export async function renderDailyCard(mount, { account, auth, play, signIn, onPage = false }) {
  if (!auth || auth.mode === 'off') { mount.replaceChildren(); return; }
  let data;
  try { data = await load(); } catch { mount.replaceChildren(); return; }
  const streak = account && account.daily ? account.daily.streak : 0;
  const buttons = Object.entries(data.games).map(([type, g]) => {
    const mine = myState(account, type);
    const label = mine ? (mine.text || `✓ ${fmtScore(mine.score, g.score)}`) : '▶ PLAY';
    return h(`button.daily-game${mine ? '.done' : ''}`, {
      type: 'button',
      'aria-label': `${g.label}: ${mine ? `played today, ${label}` : 'play today\'s run'}`,
      onclick: () => {
        if (!account) { signIn(); return; }
        if (mine) { toast(`You've played today's ${g.label}. A new one unlocks at 00:00 UTC.`); return; }
        play(type);
      },
    }, h('span.daily-name', g.label.toUpperCase()), h('span.daily-act', label), h('span.daily-count', `${g.total} played`));
  });
  mount.replaceChildren(h('section.daily-card', { 'aria-labelledby': 'daily-title' },
    h('div.daily-head',
      h('h2#daily-title.daily-title', onPage ? '◆ TODAY ' : '◆ DAILY CHALLENGE ', h('span.muted', `· ${dayLabel(data.date)}`)),
      h('span.muted.daily-reset', { title: 'New boards every day at 00:00 UTC' }, `new in ${left(data.nextAt - Date.now())}`)),
    h('div.daily-games', buttons),
    h('div.daily-foot',
      account
        ? h('span.daily-streak', streak ? `🔥 ${streak}-day streak` : 'Play one today to start a streak.')
        : h('span.muted', 'Same board for everyone, one try a day. Sign in to play.'),
      onPage ? null : h('a.daily-board-link', { href: '/daily', 'data-link': true }, 'TODAY\'S BOARD →'))));
}

function board(type, g, me) {
  return h('section.daily-board', { 'aria-labelledby': `db-${type}` },
    h('h2.panel-title', { id: `db-${type}` }, `> ${g.label.toUpperCase()}`),
    h('p.muted.daily-sub', `${g.total} finished · ${g.better === 'low' ? 'fastest' : 'highest'} first`),
    g.rows.length
      ? h('ol.daily-rows', g.rows.map((r) => h(`li.daily-row${me && r.username === me.username ? '.lb-me' : ''}`,
        h('span.daily-rank', `#${r.rank}`),
        avatarEl(r.avatar, 24, r.cosmetics),
        h('a.daily-player', { href: `/u/${encodeURIComponent(r.username)}`, 'data-link': true, class: nameColor(r.cosmetics) }, r.username),
        h('span.daily-score', fmtScore(r.score, g.score)))))
      : h('p.muted.empty', 'Nobody has finished yet. Be the first!'));
}

export async function renderDaily(mount, { account, auth, play, signIn }) {
  mount.replaceChildren(h('div.daily-page', h('p.muted.loading', 'Loading today\'s challenge…')));
  let data;
  try { data = await load(true); } catch {
    mount.replaceChildren(h('div.daily-page', h('p.error', 'Couldn\'t load the daily challenge. Check your connection and try again.')));
    return 'Daily challenge';
  }
  const cardSlot = h('div');
  mount.replaceChildren(h('article.daily-page',
    h('h1.page-title', 'DAILY CHALLENGE'),
    h('p.muted', 'One shared board per game, the same for everyone. You get one try a day. Play on consecutive days to build a streak.'),
    cardSlot,
    h('div.daily-boards', Object.entries(data.games).map(([type, g]) => board(type, g, account)))));
  renderDailyCard(cardSlot, { account, auth, play, signIn, onPage: true });
  return 'Daily challenge';
}
