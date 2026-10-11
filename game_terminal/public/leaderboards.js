// /leaderboards[/<game>]?scope=all|season|friends&by=rating|wins|best — per-game ladders from
// GET /api/leaderboard/<game>. Ranked games default to rating, score games to best, others to wins.
import { h, timeAgo, fmtDate } from './ui.js';
import { avatarEl } from './avatars.js';
import { fmtScore, tierBadge } from './profile.js';
import { onSocialChange } from './friends.js';

const METRIC = { rating: 'RATING', wins: 'WINS', best: 'BEST' };
const SCOPES = [['all', 'ALL-TIME'], ['season', 'THIS SEASON'], ['friends', 'FRIENDS']];

let cfg = null; // { games, season } from /api/config, fetched once if auth didn't bring it

function metricsOf(g) { return [g.rated && 'rating', g.score && 'best', 'wins'].filter(Boolean); }

export async function renderLeaderboards(mount, gameType, { gameLabel, auth, me, friends }) {
  if (!cfg) {
    cfg = auth && auth.games ? auth : await fetch('/api/config').then((r) => r.json()).catch(() => ({ games: {} }));
  }
  const games = cfg.games || {};
  const types = Object.keys(games).sort((a, b) => gameLabel(a).localeCompare(gameLabel(b)));
  if (!types.length) {
    mount.replaceChildren(h('div.profile', h('p.error', 'Couldn\'t load leaderboards. Check your connection and try again.')));
    return;
  }
  const q = new URLSearchParams(location.search);
  const view = {
    game: games[gameType] ? gameType : (types.find((t) => t === 'chess') || types.find((t) => games[t].rated) || types[0]),
    scope: SCOPES.some(([s]) => s === q.get('scope')) ? q.get('scope') : 'all',
    by: q.get('by'),
  };
  // Signed-in state may still be on its way (the page re-renders when it lands): keep ?scope=friends in the URL.
  const keepFriends = view.scope === 'friends' && !me;
  if (keepFriends) view.scope = 'all';

  const select = h('select.set-select.lb-game', { 'aria-label': 'Game', onchange: () => { view.game = select.value; view.by = null; load(); } },
    h('optgroup', { label: 'Ranked' }, types.filter((t) => games[t].rated).map((t) => h('option', { value: t }, gameLabel(t)))),
    h('optgroup', { label: 'Other games' }, types.filter((t) => !games[t].rated).map((t) => h('option', { value: t }, gameLabel(t)))));
  const scopeTabs = h('div.adm-tabs', { role: 'tablist', 'aria-label': 'Period' });
  const metricTabs = h('div.adm-tabs', { role: 'tablist', 'aria-label': 'Ranked by' });
  const body = h('div.lb-body');
  const note = h('p.muted.lb-note');
  const season = cfg.season;
  const daysLeft = season ? Math.max(0, Math.ceil((season.end - Date.now()) / 86400000)) : null;

  mount.replaceChildren(h('article.profile.lb',
    h('header.lb-head',
      h('div', h('h1.page-title', 'LEADERBOARDS'),
        season ? h('p.muted.lb-season', `Season ${season.n} · ends ${fmtDate(season.end)} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`) : null),
      h('label.lb-pick', h('span.muted', 'GAME'), select)),
    h('div.lb-controls', scopeTabs, metricTabs),
    body, note));

  function tabs(el, items, current, set) {
    el.replaceChildren(...items.map(([key, label]) => h('button.adm-tab', {
      type: 'button', role: 'tab', 'aria-selected': String(key === current), onclick: () => { set(key); load(); },
    }, label)));
  }

  async function load() {
    const g = games[view.game];
    const metrics = metricsOf(g);
    if (!metrics.includes(view.by)) view.by = metrics[0];
    select.value = view.game;
    tabs(scopeTabs, SCOPES.filter(([s]) => s !== 'friends' || me), view.scope, (s) => { view.scope = s; });
    tabs(metricTabs, metrics.map((m) => [m, m === 'best' && g.score ? g.score.label.toUpperCase() : METRIC[m]]), view.by, (m) => { view.by = m; });
    metricTabs.hidden = metrics.length < 2;
    const scopeParam = keepFriends && view.scope === 'all' ? 'friends' : view.scope;
    const params = new URLSearchParams({ ...(scopeParam !== 'all' ? { scope: scopeParam } : {}), ...(view.by !== metrics[0] ? { by: view.by } : {}) });
    history.replaceState(null, '', `/leaderboards/${view.game}${params.size ? `?${params}` : ''}`);
    document.title = `${gameLabel(view.game)} leaderboard — Game Terminal`;

    const api = new URLSearchParams({ by: view.by, scope: view.scope === 'season' ? 'season' : 'all' });
    if (view.scope === 'friends') api.set('names', (shownNames = [me.username, ...friends()].join(',')));
    body.replaceChildren(h('p.muted.loading', 'Loading…'));
    note.textContent = '';
    const key = `${view.game}|${view.scope}|${view.by}`;
    let d;
    try {
      const res = await fetch(`/api/leaderboard/${view.game}?${api}`);
      if (!res.ok) throw new Error(res.status);
      d = await res.json();
    } catch {
      if (key === `${view.game}|${view.scope}|${view.by}`) body.replaceChildren(h('p.error', 'Couldn\'t load this leaderboard. Try again in a moment.'));
      return;
    }
    if (key !== `${view.game}|${view.scope}|${view.by}` || !mount.contains(body)) return; // a newer pick won
    body.replaceChildren(d.rows.length ? table(d, g) : empty(g));
    note.textContent = d.rows.length ? `${d.total.toLocaleString()} ${view.by === 'rating' ? 'ranked ' : ''}player${d.total === 1 ? '' : 's'} · updated ${timeAgo(d.updatedAt)}${view.by === 'rating' ? ' · ratings move only in RANKED games' : ''}` : '';
  }

  function empty(g) {
    const what = view.by === 'rating' ? 'Nobody has played a ranked game' : 'Nobody is on this board';
    const when = view.scope === 'season' ? ' this season' : '';
    return h('div.lb-empty',
      h('p', view.scope === 'friends' ? 'None of your friends are on this board yet.' : `${what}${when} yet.`),
      h('p.muted', view.by === 'rating' ? 'Pick this game on the home screen and hit ★ RANKED. Be the first name up here.' : 'Play a game while signed in to claim the top spot.'),
      h('a.btn-primary', { href: '/', 'data-link': true }, g.rated ? 'PLAY RANKED' : 'PLAY'));
  }

  function table(d, g) {
    const label = view.by === 'best' && g.score ? g.score.label.toUpperCase() : METRIC[view.by];
    const fmt = (v) => (view.by === 'best' ? fmtScore(v, g.score) : view.by === 'rating' ? String(Math.round(v)) : v.toLocaleString());
    return h('div.table-wrap', h('table.stats-table.lb-table',
      h('thead', h('tr',
        h('th.num.lb-rank', { scope: 'col' }, '#'), h('th', { scope: 'col' }, 'PLAYER'),
        g.rated ? h('th', { scope: 'col' }, 'TIER') : null,
        h('th.num', { scope: 'col' }, label),
        view.by !== 'best' ? h('th.num.lb-wl', { scope: 'col', title: 'Wins / games vs. people' }, view.scope === 'season' ? 'SEASON W / GP' : 'W / GP') : null)),
      h('tbody', d.rows.map((r) => h(`tr${me && r.username === me.username ? '.lb-me' : ''}${r.rank <= 3 ? `.lb-top${r.rank}` : ''}`,
        h('td.num.lb-rank', r.rank <= 3 ? h('span.lb-medal', { 'aria-label': `Rank ${r.rank}` }, String(r.rank)) : String(r.rank)),
        h('th', { scope: 'row' }, h('a.lb-player', { href: `/u/${encodeURIComponent(r.username)}`, 'data-link': true },
          avatarEl(r.avatar, 28), h('span.lb-name', r.username), h('span.muted.lb-lv', `LV ${r.level}`))),
        g.rated ? h('td', r.tier ? tierBadge(r.tier, r.rating) : h('span.muted', '—')) : null,
        h('td.num.lb-val', fmt(r.value)),
        view.by !== 'best' ? h('td.num.lb-wl', `${r.wins || 0} / ${r.played || 0}`) : null)))));
  }

  // The friends list arrives over the socket, possibly after this page rendered.
  let shownNames = '';
  const off = onSocialChange(() => {
    if (!mount.contains(body)) { off(); return; }
    if (view.scope === 'friends' && [me.username, ...friends()].join(',') !== shownNames) load();
  });
  load();
}
