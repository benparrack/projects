// "Your games" on the menu: play-by-turns games with friends (server/asyncGames.js), your move first.
import { h, modal, timeAgo } from './ui.js';

export function renderTurns(mount, games, { gameLabel, join, remove }) {
  if (!games || !games.length) { mount.replaceChildren(); return; }
  const mine = games.filter((g) => g.yourTurn).length;
  const confirmRemove = (g) => {
    const m = modal('REMOVE GAME');
    m.body.append(
      h('p', `Remove your ${gameLabel(g.gameType)} game with ${g.opponent}? It's deleted for both of you.`),
      h('div.turns-confirm',
        h('button.btn-sm', { type: 'button', onclick: () => m.close() }, 'KEEP'),
        h('button.btn-sm.danger', { type: 'button', onclick: () => { m.close(); remove(g.code); } }, 'REMOVE')));
  };
  mount.replaceChildren(h('section.turns-card', { 'aria-labelledby': 'turns-title' },
    h('div.turns-head',
      h('h2#turns-title.turns-title', '♟ YOUR GAMES'),
      mine ? h('span.turns-badge', `${mine} YOUR MOVE`) : null,
      h('span.muted.turns-hint', 'Played by turns. Move whenever you like.')),
    h('ul.turns-rows', games.map((g) => {
      const status = g.over ? h('span.turns-status.over', 'FINISHED') : g.yourTurn ? h('span.turns-status.mine', '● YOUR TURN') : h('span.turns-status', 'THEIR TURN');
      return h(`li.turns-row${g.yourTurn ? '.mine' : ''}`,
        status,
        h('span.turns-game', gameLabel(g.gameType), h('span.muted', ` vs ${g.opponent}`)),
        h('span.muted.turns-when', timeAgo(g.updatedAt)),
        h('button.btn-sm', { type: 'button', 'aria-label': `Open ${gameLabel(g.gameType)} vs ${g.opponent}`, onclick: () => join(g.code) }, g.yourTurn ? 'PLAY' : 'VIEW'),
        h('button.turns-remove', { type: 'button', title: 'Remove game', 'aria-label': `Remove ${gameLabel(g.gameType)} vs ${g.opponent}`, onclick: () => confirmRemove(g) }, '✕'));
    }))));
}
