// Menu extras: the live stats strip (everyone) and friends' activity (signed in).
import { h, timeAgo } from './ui.js';
import { avatarEl, nameColor } from './avatars.js';
import { fmtScore } from './profile.js';

let live = null; // { at, data }

// openOnline (signed in only) makes "N online now" open the drawer's ONLINE NOW list.
export async function renderLive(mount, { gameLabel, pick, openOnline }) {
  if (!live || Date.now() - live.at > 30000) {
    try {
      const res = await fetch('/api/live');
      if (!res.ok) throw new Error(res.status);
      live = { at: Date.now(), data: await res.json() };
    } catch { if (!live) { mount.replaceChildren(); return; } }
  }
  const d = live.data;
  const stat = (n, label) => h('span.live-stat', h('b', n.toLocaleString()), ` ${label}`);
  mount.replaceChildren(h('p.live-strip', { 'aria-label': 'Site activity' },
    h('span.live-dot', { 'aria-hidden': 'true' }), openOnline
      ? h('button.live-hot.live-online', { type: 'button', title: 'See who\'s online', onclick: openOnline }, h('b', d.online.toLocaleString()), ' online now')
      : stat(d.online, 'online now'),
    h('span.live-sep', { 'aria-hidden': 'true' }, '·'), stat(d.today, d.today === 1 ? 'game today' : 'games today'),
    d.topWeek ? [h('span.live-sep', { 'aria-hidden': 'true' }, '·'), h('span.live-stat', 'hot this week: ',
      h('button.live-hot', { type: 'button', title: `${d.topWeek.plays.toLocaleString()} games in 7 days`, onclick: () => pick(d.topWeek.gameType) }, gameLabel(d.topWeek.gameType).toUpperCase()))] : null));
}

const LINE = {
  ranked: (it, g) => [`won ranked ${g(it.gameType)} `, h('span.muted', `(${it.rating})`)],
  daily: (it, g) => `placed #${it.rank} of ${it.of} in the daily ${g(it.gameType)}`,
  streak: (it) => `hit a ${it.days}-day daily streak 🔥`,
  level: (it) => `reached level ${it.level}`,
  achievement: (it) => ['unlocked ', h('b', it.name)],
};

// payload: { items, friends } from the server's ACTIVITY message.
export function renderActivity(mount, payload, { gameLabel, openFriends }) {
  const items = payload.items.filter((it) => LINE[it.kind]).slice(0, 6);
  let open = true;
  try { open = localStorage.getItem('gt.activityOpen') !== '0'; } catch {}
  mount.replaceChildren(h('details.activity', {
    open,
    ontoggle: (e) => { try { localStorage.setItem('gt.activityOpen', e.currentTarget.open ? '1' : '0'); } catch {} },
  },
    h('summary.activity-title', '> FRIENDS\' ACTIVITY', items.length ? h('span.muted.activity-count', ` (${items.length})`) : null),
    items.length
      ? h('ul.activity-list', items.map((it) => h('li.activity-item',
        avatarEl(it.user.avatar, 20, it.user.cosmetics),
        h('span.activity-text',
          h('a', { href: `/u/${encodeURIComponent(it.user.username)}`, 'data-link': true, class: nameColor(it.user.cosmetics) }, it.user.username), ' ',
          LINE[it.kind](it, gameLabel)),
        h('time.muted.activity-at', { datetime: new Date(it.at).toISOString() }, timeAgo(it.at)))))
      : h('p.muted.activity-empty', payload.friends
        ? 'Nothing new from your friends yet. Wins, level-ups and unlocks show up here.'
        : ['Add friends to see their wins, level-ups and unlocks here. ', h('button.link-btn', { type: 'button', onclick: openFriends }, 'FIND FRIENDS')])));
}

// Solo: games built to be played alone for a personal best (no opponent or bot needed).
// One click opens a private room.
const SOLO = ['crossword', 'anagrams', 'wordhunt', 'wordbites', 'wordscapes', 'wordsearch', 'wordtrails', 'mazedash', 'slope', 'bowling', 'skeeball', 'basketball', 'archery', 'minigolf', 'blackjack'];

export function renderSoloCard(mount, { account, gameLabel, play }) {
  let open = true;
  try { open = localStorage.getItem('gt.soloOpen') !== '0'; } catch {}
  const chips = new Map(SOLO.map((type) => [type, h('button.landing-chip', { type: 'button', onclick: () => play(type) }, gameLabel(type))]));
  mount.replaceChildren(h('details.activity', {
    open,
    ontoggle: (e) => { try { localStorage.setItem('gt.soloOpen', e.currentTarget.open ? '1' : '0'); } catch {} },
  },
    h('summary.activity-title', '> SOLO · BEAT YOUR BEST'),
    h('p.muted.activity-empty', account ? 'Play alone and chase your high score. Your best shows on each game.' : 'Play alone and chase your high score. Sign in to keep your bests.'),
    h('div.landing-chips.solo-chips', [...chips.values()])));
  if (!account) return;
  fetch(`/api/user/${encodeURIComponent(account.username)}`).then((r) => (r.ok ? r.json() : null)).then((data) => {
    for (const st of (data && data.stats) || []) {
      const chip = chips.get(st.gameType);
      if (chip && st.best != null) chip.append(h('span.muted', ` · ${fmtScore(st.best, st.score)}`));
    }
  }).catch(() => {}); // bests are a nicety; the buttons work without them
}
