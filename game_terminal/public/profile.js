// Public profile page: /u/<username>. Data comes from GET /api/user/<name>.
import { h, timeAgo, fmtDate } from './ui.js';
import { avatarEl } from './avatars.js';

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

function fmtScore(v, score) {
  if (v == null) return '—';
  if (score && score.format === 'ms') return `${(v / 1000).toFixed(2)}s`;
  if (score && score.format === 'pts') return `${v.toLocaleString()} pts`;
  return v.toLocaleString();
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function resultOf(m) {
  const me = m.me || {};
  if (m.kind === 'solo') return { cls: 'solo', text: me.score != null ? 'SCORE' : 'DONE' };
  if (me.draw) return { cls: 'draw', text: 'DRAW' };
  if (me.won) return { cls: 'win', text: 'WIN' };
  const n = (m.players || []).length;
  if (n > 2) return { cls: me.place >= n - 1 ? 'loss' : 'draw', text: ordinal(me.place + 1).toUpperCase() };
  return { cls: 'loss', text: 'LOSS' };
}

function playerLink(p) {
  if (p.bot) return h('span.muted', 'BOT');
  if (!p.account) return h('span.muted', p.name);
  return h('a', { href: `/u/${encodeURIComponent(p.name)}`, 'data-link': true }, p.name);
}

function matchRow(m, self, gameLabel) {
  const r = resultOf(m);
  const others = (m.players || []).filter((p) => !(p.account && p.name === self));
  const vs = m.kind === 'solo' ? [] : others.flatMap((p, i) => [i ? ', ' : '', playerLink(p)]);
  const score = m.me && m.me.score != null ? fmtScore(m.me.score, null) : null;
  return h('li.match-row',
    h(`span.match-result.res-${r.cls}`, r.text),
    h('span.match-game', gameLabel(m.gameType)),
    h('span.match-vs', m.kind === 'solo' ? h('span.muted', 'solo') : ['vs ', ...vs],
      m.kind === 'bot' && m.botLevel ? h('span.muted', ` (${m.botLevel})`) : null),
    h('span.match-score', m.replay
      ? h('a.match-replay', { href: `/replay/${m.id}`, 'data-link': true, 'aria-label': `Watch replay: ${gameLabel(m.gameType)}` }, '▶ REPLAY')
      : score || ''),
    h('time.match-when.muted', { dateTime: new Date(m.endedAt).toISOString(), title: new Date(m.endedAt).toLocaleString() }, timeAgo(m.endedAt)));
}

function statsTable(stats, gameLabel) {
  const rows = [...stats].sort((a, b) => (b.played + b.botPlayed + b.soloPlayed) - (a.played + a.botPlayed + a.soloPlayed));
  return h('div.table-wrap', h('table.stats-table',
    h('thead', h('tr',
      h('th', { scope: 'col' }, 'GAME'), h('th.num', { scope: 'col' }, 'PLAYED'), h('th.num', { scope: 'col' }, 'W-L-D'),
      h('th.num', { scope: 'col' }, 'WIN %'), h('th.num', { scope: 'col', title: 'Best win streak vs. people' }, 'STREAK'),
      h('th.num', { scope: 'col' }, 'VS BOTS'), h('th.num', { scope: 'col' }, 'BEST'))),
    h('tbody', rows.map((s) => h('tr',
      h('th', { scope: 'row' }, gameLabel(s.gameType)),
      h('td.num', s.played + s.botPlayed + s.soloPlayed),
      h('td.num', s.played ? `${s.wins}-${s.losses}-${s.draws}` : '—'),
      h('td.num', pct(s.wins, s.played)),
      h('td.num', s.bestStreak || '—'),
      h('td.num', s.botPlayed ? `${s.botWins}/${s.botPlayed}` : '—'),
      h('td.num', s.best != null ? h('span', { title: s.score ? s.score.label : '' }, fmtScore(s.best, s.score)) : '—'))))));
}

function summaryCards(stats) {
  const sum = (k) => stats.reduce((t, s) => t + (s[k] || 0), 0);
  const total = sum('played') + sum('botPlayed') + sum('soloPlayed');
  const fav = [...stats].sort((a, b) => (b.played + b.botPlayed + b.soloPlayed) - (a.played + a.botPlayed + a.soloPlayed))[0];
  return { total, pvp: sum('played'), wins: sum('wins'), best: Math.max(0, ...stats.map((s) => s.bestStreak || 0)), fav };
}

export async function renderProfile(mount, name, { gameLabel, me }) {
  mount.replaceChildren(h('div.profile', h('p.muted.loading', 'Loading profile…')));
  let data;
  try {
    const res = await fetch(`/api/user/${encodeURIComponent(name)}`);
    if (res.status === 404) {
      mount.replaceChildren(h('div.notfound',
        h('p.notfound-code', '?'),
        h('h1', 'NO SUCH PLAYER'),
        h('p.muted', `Nobody goes by "${name}" here. They may have changed their name.`),
        h('a.btn-primary', { href: '/', 'data-link': true }, 'BACK TO GAMES')));
      return 'Player not found';
    }
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    mount.replaceChildren(h('div.profile', h('p.error', 'Couldn\'t load this profile. Check your connection and try again.')));
    return 'Profile';
  }
  const { user, stats, matches } = data;
  const t = summaryCards(stats);
  const isMe = me && me.username === user.username;
  mount.replaceChildren(h('article.profile',
    h('header.profile-head',
      avatarEl(user.avatar, 88),
      h('div.profile-id',
        h('h1.profile-name', user.username),
        h('p.muted', `LEVEL ${user.level} · joined ${fmtDate(user.createdAt)}`),
        isMe ? h('p.profile-you', 'This is you. Other players see this page too.') : null)),
    h('dl.profile-kpis',
      kpi('MATCHES', t.total),
      kpi('VS PEOPLE', t.pvp),
      kpi('WIN RATE', pct(t.wins, t.pvp)),
      kpi('BEST STREAK', t.best || '—'),
      kpi('FAVOURITE', t.fav ? gameLabel(t.fav.gameType) : '—')),
    h('section.profile-section',
      h('h2.panel-title', '> STATS BY GAME'),
      stats.length ? statsTable(stats, gameLabel) : h('p.muted.empty', isMe ? 'Finish a game and your stats show up here.' : 'No games played yet.')),
    h('section.profile-section',
      h('h2.panel-title', '> RECENT MATCHES'),
      matches.length
        ? h('ol.match-list', matches.map((m) => matchRow(m, user.username, gameLabel)))
        : h('p.muted.empty', 'No matches yet.'))));
  return user.username;
}

function kpi(label, value) {
  return h('div.kpi', h('dt', label), h('dd', String(value)));
}
