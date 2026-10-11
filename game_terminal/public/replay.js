// Replay viewer: /replay/<matchId>. Mounts the game's normal client read-only and feeds it
// the frames the server rebuilt from the stored moves list (GET /api/match/<id>/frames).
import { h, fmtDate } from './ui.js';

const SPEEDS = [0.5, 1, 2, 4];
const BASE_MS = 900;

export async function renderReplay(mount, id, { gameLabel }) {
  mount.replaceChildren(h('div.replay', h('p.muted.loading', 'Loading replay…')));
  let data;
  try {
    const res = await fetch(`/api/match/${encodeURIComponent(id)}/frames`);
    if (res.status === 404) {
      mount.replaceChildren(h('div.notfound',
        h('p.notfound-code', '404'), h('h1', 'REPLAY NOT FOUND'),
        h('p.muted', 'Only finished turn-based games have replays.'),
        h('a.btn-primary', { href: '/', 'data-link': true }, 'BACK TO GAMES')));
      return { title: 'Replay not found', cleanup() {} };
    }
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    mount.replaceChildren(h('div.replay', h('p.error', 'Couldn\'t load this replay. Check your connection and try again.')));
    return { title: 'Replay', cleanup() {} };
  }

  const { frames, players, gameType, endedAt } = data;
  const label = gameLabel(gameType);
  const board = h('div.replay-board.game-mount', { inert: true, 'aria-label': `${label} board` });
  const counter = h('span.replay-count', { 'aria-live': 'polite' });
  const scrub = h('input.replay-scrub', { type: 'range', min: 0, max: frames.length - 1, value: 0, 'aria-label': 'Move' });
  const playBtn = h('button.replay-btn.replay-play', { type: 'button' });
  const speedBtn = h('button.replay-btn', { type: 'button', title: 'Playback speed' });
  const btn = (text, title, fn) => h('button.replay-btn', { type: 'button', title, 'aria-label': title, onclick: fn }, text);

  const winners = players.filter((p) => p.place === 0);
  const outcome = players.length > 1 && winners.length === players.length ? 'Draw'
    : winners.length ? `${winners.map((p) => p.name).join(' & ')} won` : '';

  mount.replaceChildren(h('article.replay',
    h('header.replay-head',
      h('p.replay-kicker', '> REPLAY'),
      h('h1.replay-title', label),
      h('p.replay-players', players.flatMap((p, i) => [i ? h('span.muted', ' vs ') : null,
        p.bot ? h('span', 'BOT') : p.account ? h('a', { href: `/u/${encodeURIComponent(p.name)}`, 'data-link': true }, p.name) : h('span', p.name),
        p.place === 0 && winners.length < players.length ? h('span.replay-crown', { title: 'Winner' }, ' ★') : null])),
      h('p.muted.replay-meta', `${fmtDate(endedAt)} · ${outcome}`)),
    board,
    h('div.replay-controls', { role: 'toolbar', 'aria-label': 'Replay controls' },
      btn('⏮', 'First move', () => go(0)),
      btn('‹', 'Previous move', () => go(i - 1)),
      playBtn,
      btn('›', 'Next move', () => go(i + 1)),
      btn('⏭', 'Last move', () => go(frames.length - 1)),
      scrub, counter, speedBtn),
    h('p.muted.replay-hint', 'Keys: ← → step · space play/pause · Home/End jump')));

  let handle = null;
  try {
    const mod = await import(`./games/${gameType}/client.js`);
    handle = mod.mount(board, { sendAction() {}, getClientId: () => '__replay__', leaveRoom() {} });
  } catch (err) {
    console.error('replay: failed to load', gameType, err);
    board.textContent = `Couldn't load the ${label} board.`;
  }

  let i = 0;
  let speed = 1;
  let timer = null;
  function go(n) {
    i = Math.max(0, Math.min(frames.length - 1, n));
    if (handle && handle.applySnapshot) handle.applySnapshot(frames[i]);
    scrub.value = i;
    counter.textContent = `${i} / ${frames.length - 1}`;
    if (i === frames.length - 1) pause();
  }
  function play() {
    if (i === frames.length - 1) go(0);
    clearInterval(timer);
    timer = setInterval(() => go(i + 1), BASE_MS / speed);
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause');
  }
  function pause() {
    clearInterval(timer);
    timer = null;
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Play');
  }
  playBtn.addEventListener('click', () => (timer ? pause() : play()));
  speedBtn.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    speedBtn.textContent = `${speed}×`;
    if (timer) play();
  });
  speedBtn.textContent = '1×';
  scrub.addEventListener('input', () => { pause(); go(Number(scrub.value)); });
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') && e.target !== scrub) return;
    const k = { ArrowLeft: () => go(i - 1), ArrowRight: () => go(i + 1), Home: () => go(0), End: () => go(frames.length - 1), ' ': () => (timer ? pause() : play()) }[e.key];
    if (!k || e.target === scrub && e.key !== ' ') return;
    e.preventDefault();
    if (e.key !== ' ') pause();
    k();
  };
  document.addEventListener('keydown', onKey);
  pause();
  go(0);

  return {
    title: `${label} replay`,
    cleanup() {
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      if (handle && handle.unmount) handle.unmount();
    },
  };
}
