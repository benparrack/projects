// Public profile page: /u/<username>. Data comes from GET /api/user/<name>.
import { h, timeAgo, fmtDate } from './ui.js';
import { avatarEl } from './avatars.js';
import { relationButtons } from './friends.js';

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3 ^ 1) && n % 10] || 'th'}`;

export function fmtScore(v, score) {
  if (v == null) return '—';
  if (score && score.format === 'ms') return `${(v / 1000).toFixed(2)}s`;
  if (score && score.format === 'pts') return `${v.toLocaleString()} pts`;
  return v.toLocaleString();
}

// Rank badge for a rating tier (Bronze…Master); colors live in style.css.
export const tierBadge = (tier, rating) => h(`span.tier.tier-${tier.toLowerCase()}`, { title: rating != null ? `${tier} · ${rating}` : tier }, tier.toUpperCase());

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
      m.kind === 'bot' && m.botLevel ? h('span.muted', ` (${m.botLevel})`) : null,
      m.me && m.me.delta != null ? h(`span.match-delta${m.me.delta < 0 ? '.neg' : ''}`, { title: `Ranked · rating ${m.me.rating}` }, ` ★ ${m.me.delta >= 0 ? '+' : '−'}${Math.abs(m.me.delta)}`) : null),
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
      h('th.num', { scope: 'col' }, 'VS BOTS'), h('th.num', { scope: 'col' }, 'BEST'),
      h('th.num', { scope: 'col', title: 'Ranked rating (peak in tooltip)' }, 'RATING'))),
    h('tbody', rows.map((s) => h('tr',
      h('th', { scope: 'row' }, gameLabel(s.gameType)),
      h('td.num', s.played + s.botPlayed + s.soloPlayed),
      h('td.num', s.played ? `${s.wins}-${s.losses}-${s.draws}` : '—'),
      h('td.num', pct(s.wins, s.played)),
      h('td.num', s.bestStreak || '—'),
      h('td.num', s.botPlayed ? `${s.botWins}/${s.botPlayed}` : '—'),
      h('td.num', s.best != null ? h('span', { title: s.score ? s.score.label : '' }, fmtScore(s.best, s.score)) : '—'),
      h('td.num', s.rating != null
        ? h('span.stat-rating', { title: `Peak ${s.peak || s.rating} · ${s.ratedGames || 0} ranked game${s.ratedGames === 1 ? '' : 's'}` }, tierBadge(s.tier, s.rating), ` ${s.rating}`)
        : '—'))))));
}

// Final standings from past seasons (archived by the server at each rollover).
function seasonsList(seasons, gameLabel) {
  return h('ol.season-list', seasons.map((s) => h('li.season-row',
    h('span.season-id', `SEASON ${s.season.slice(1)}`),
    h('a.season-game', { href: `/leaderboards/${s.gameType}`, 'data-link': true }, gameLabel(s.gameType)),
    h('span.season-rank', `#${s.rank}`, h('span.muted', ` of ${s.of}`)),
    h('span.season-tier', tierBadge(s.tier, s.rating), h('span.muted', ` ${s.rating}`)))));
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
  const { user, stats, matches, seasons = [], progress, achievements = [] } = data;
  const t = summaryCards(stats);
  const isMe = me && me.username === user.username;
  mount.replaceChildren(h('article.profile',
    h('header.profile-head',
      avatarEl(user.avatar, 88),
      h('div.profile-id',
        h('h1.profile-name', user.username),
        h('p.muted', `LEVEL ${user.level} · joined ${fmtDate(user.createdAt)}`),
        progress ? xpBar(progress) : null,
        isMe ? h('p.profile-you', 'This is you. Other players see this page too.') : null,
        me && !isMe ? relationButtons(user.username) : null)),
    h('dl.profile-kpis',
      kpi('MATCHES', t.total),
      kpi('VS PEOPLE', t.pvp),
      kpi('WIN RATE', pct(t.wins, t.pvp)),
      kpi('BEST STREAK', t.best || '—'),
      kpi('FAVOURITE', t.fav ? gameLabel(t.fav.gameType) : '—')),
    me && !isMe ? headToHead(me.username, user.username, gameLabel) : null,
    h('section.profile-section',
      h('h2.panel-title', '> STATS BY GAME'),
      stats.length ? statsTable(stats, gameLabel) : h('p.muted.empty', isMe ? 'Finish a game and your stats show up here.' : 'No games played yet.')),
    achievements.length ? h('section.profile-section',
      h('h2.panel-title', '> ACHIEVEMENTS ', h('span.muted.ach-count', `${achievements.filter((a) => a.at).length} / ${achievements.length}`)),
      achievementGrid(achievements)) : null,
    seasons.length ? h('section.profile-section',
      h('h2.panel-title', '> PAST SEASONS'),
      seasonsList(seasons, gameLabel)) : null,
    h('section.profile-section',
      h('h2.panel-title', '> RECENT MATCHES'),
      matches.length
        ? h('ol.match-list', matches.map((m) => matchRow(m, user.username, gameLabel)))
        : h('p.muted.empty', 'No matches yet.'))));
  return user.username;
}

// "You vs them": filled in after the profile renders; hidden when you've never played each other.
function headToHead(mine, theirs, gameLabel) {
  const box = h('section.profile-section.h2h', { hidden: true });
  fetch(`/api/h2h/${encodeURIComponent(mine)}/${encodeURIComponent(theirs)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.games.length) return;
    const tot = d.games.reduce((t, g) => ({ a: t.a + g.a, b: t.b + g.b, d: t.d + g.draws }), { a: 0, b: 0, d: 0 });
    const lead = tot.a > tot.b ? 'You lead' : tot.b > tot.a ? `${theirs} leads` : 'All square';
    box.append(
      h('h2.panel-title', `> YOU VS ${theirs.toUpperCase()}`),
      h('div.h2h-score', { 'aria-label': `You ${tot.a}, ${theirs} ${tot.b}, ${tot.d} draws` },
        h('span.h2h-n.h2h-me', String(tot.a)), h('span.h2h-sep', '–'), h('span.h2h-n', String(tot.b)),
        h('span.muted.h2h-lead', `${lead}${tot.d ? ` · ${tot.d} draw${tot.d > 1 ? 's' : ''}` : ''}`)),
      h('div.table-wrap', h('table.stats-table',
        h('thead', h('tr', h('th', { scope: 'col' }, 'GAME'), h('th.num', { scope: 'col' }, 'PLAYED'), h('th.num', { scope: 'col' }, 'YOU'), h('th.num', { scope: 'col' }, 'THEM'), h('th.num', { scope: 'col' }, 'DRAWS'))),
        h('tbody', d.games.map((g) => h('tr', h('th', { scope: 'row' }, gameLabel(g.gameType)), h('td.num', g.played),
          h(`td.num${g.a > g.b ? '.h2h-win' : ''}`, String(g.a)), h(`td.num${g.b > g.a ? '.h2h-loss' : ''}`, String(g.b)), h('td.num', g.draws || '—')))))),
      d.matches.length ? h('ol.match-list', d.matches.slice(0, 8).map((m) => matchRow({ ...m, me: { won: m.winner === 'a', draw: m.winner === null, place: m.winner === 'a' ? 0 : 1 } }, mine, gameLabel))) : null);
    box.hidden = false;
  }).catch(() => {});
  return box;
}

function xpBar({ level, into, need }) {
  return h('div.xp', { role: 'progressbar', 'aria-label': `Level ${level} progress`, 'aria-valuemin': '0', 'aria-valuemax': String(need), 'aria-valuenow': String(into) },
    h('div.xp-track', h('div.xp-fill', { style: `width:${Math.min(100, (into / need) * 100).toFixed(1)}%` })),
    h('span.xp-label', `${into} / ${need} XP to level ${level + 1}`));
}

// Unlocked newest first; locked ones fold away under a toggle so the profile stays short.
function achievementGrid(list) {
  const got = list.filter((a) => a.at).sort((a, b) => b.at - a.at);
  const locked = list.filter((a) => !a.at);
  return h('div',
    got.length ? achTiles(got) : h('p.muted.empty', 'None unlocked yet. Finish a game to earn the first one.'),
    locked.length ? h('details.ach-locked', h('summary', `Show ${locked.length} locked`), achTiles(locked)) : null);
}

function achTiles(list) {
  return h('ul.ach-grid', list.map((a) => h(`li.ach${a.at ? '.got' : ''}`, { title: a.at ? `Unlocked ${fmtDate(a.at)}` : 'Locked' },
    h('span.ach-icon', { 'aria-hidden': 'true' }, a.at ? '★' : '☆'),
    h('div', h('b.ach-name', a.name), h('span.ach-desc', a.desc)),
    h('span.sr-only', a.at ? ' (unlocked)' : ' (locked)'))));
}

function kpi(label, value) {
  return h('div.kpi', h('dt', label), h('dd', String(value)));
}
