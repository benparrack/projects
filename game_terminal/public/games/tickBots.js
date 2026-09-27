// "+ ADD BOT" row for the real-time games (server side: server/games/tickBots.js). Bots are
// players whose clientId starts with 'bot-'. The row only rebuilds when the set of bots changes,
// so the difficulty <select> stays usable while tick updates stream in.
import { preferredLevel, levelSelect } from './botLevel.js';

const MAX_BOTS = 6;
const isBotId = (id) => typeof id === 'string' && id.startsWith('bot-');

export function createBotBar(api) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0';
  let lastKey = null;
  const btn = (text, css, title, onClick) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.title = title;
    b.style.cssText = `background:transparent;border-radius:4px;font:inherit;cursor:pointer;padding:3px 9px;${css}`;
    b.addEventListener('click', onClick);
    return b;
  };
  function update(players) {
    const bots = players.filter((p) => isBotId(p.clientId));
    const key = bots.map((p) => p.clientId).join('|');
    if (key === lastKey) return;
    lastKey = key;
    el.textContent = '';
    if (bots.length < MAX_BOTS) {
      el.appendChild(btn('+ ADD BOT', 'border:1px dashed #3ad7ff;color:#3ad7ff', 'Add a computer player', () => api.sendAction({ kind: 'addBot', level: preferredLevel() })));
      el.appendChild(levelSelect(preferredLevel()));
    }
    for (const b of bots) {
      el.appendChild(btn(`✕ ${b.nickname}`, 'border:1px solid #ff5a5a;color:#ff8a8a;font-size:.85em', 'Remove this bot', () => api.sendAction({ kind: 'removeBot', clientId: b.clientId })));
    }
  }
  return { el, update };
}
