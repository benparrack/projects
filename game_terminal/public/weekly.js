// Game of the week, on the menu: the featured game (double XP), time left, and its points table.
import { h } from './ui.js';
import { avatarEl, nameColor } from './avatars.js';

const left = (ms) => {
  const hrs = Math.max(0, Math.floor(ms / 3600e3));
  return hrs >= 24 ? `${Math.floor(hrs / 24)}d ${hrs % 24}h` : `${hrs}h ${Math.max(0, Math.floor(ms / 60e3)) % 60}m`;
};

export async function renderWeeklyCard(mount, { auth, account, gameLabel, play }) {
  if (!auth || auth.mode === 'off') { mount.replaceChildren(); return; }
  let d;
  try {
    const res = await fetch('/api/weekly');
    if (!res.ok) throw new Error(res.status);
    d = await res.json();
  } catch { mount.replaceChildren(); return; }
  const label = gameLabel(d.gameType).toUpperCase();
  mount.replaceChildren(h('section.weekly-card', { 'aria-labelledby': 'weekly-title' },
    h('div.weekly-head',
      h('h2#weekly-title.weekly-title', '★ GAME OF THE WEEK: ', h('span.weekly-game', label)),
      h('span.weekly-badge', '2× XP'),
      h('span.muted.weekly-left', { title: 'A new game every Monday at 00:00 UTC' }, `ends in ${left(d.endsAt - Date.now())}`)),
    h('div.weekly-body',
      h('button.weekly-play', { type: 'button', onclick: () => play(d.gameType) }, `▶ JOIN A ${label} ROOM`),
      h('span.muted.weekly-rules', account ? 'Win 3 pts · draw 1 · beat a bot 1' : 'Sign in to earn double XP and points.')),
    d.rows.length
      ? h('ol.weekly-rows', { 'aria-label': `This week's ${label} table` }, d.rows.map((r) => h(`li.weekly-row${account && r.username === account.username ? '.lb-me' : ''}`,
        h('span.weekly-rank', `#${r.rank}`),
        avatarEl(r.avatar, 20, r.cosmetics),
        h('a.weekly-player', { href: `/u/${encodeURIComponent(r.username)}`, 'data-link': true, class: nameColor(r.cosmetics) }, r.username),
        h('span.weekly-pts', `${r.points} pts`))))
      : h('p.muted.weekly-empty', 'No points yet this week. Win one to top the table!')));
}
