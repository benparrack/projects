// Mines: a 5x5 board hiding 1-24 mines. Turn tiles for gems, each one raising the multiplier; cash
// out whenever, or lose the bet on a mine. Auto mode picks a set of tiles once and replays that bet.
// Server plugin: ../../../server/games/mines.js

import { sfx } from '../sfx.js';
import { el, btn, money, fmtX, store, REJECT, shell, tabs, field, select, numberInput, amountField, autoFields, autoRunner, statsCard, feedCard, balanceLine, celebrate, fairButton, floats, hotkey, shake } from '../originals.js';

const TILES = 25;
const SPEEDS = { normal: 900, fast: 450, turbo: 150 };
const GEM = '<svg viewBox="0 0 64 64"><defs><linearGradient id="mg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b7ffd9"/><stop offset=".5" stop-color="#2ee07d"/><stop offset="1" stop-color="#0a8a48"/></linearGradient></defs>'
  + '<path d="M18 10h28l12 14-26 32L6 24z" fill="url(#mg1)"/><path d="M6 24h52L32 56z" fill="#0f9f53" opacity=".55"/><path d="M18 10l6 14h16l6-14M24 24l8 32 8-32" fill="none" stroke="#eafff3" stroke-width="1.6" opacity=".7"/>'
  + '<path d="M20 13l-4 8" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>';
const BOMB = '<svg viewBox="0 0 64 64"><circle cx="30" cy="38" r="20" fill="#2a1630"/><circle cx="30" cy="38" r="20" fill="url(#mb1)"/><defs><radialGradient id="mb1" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ff8a9b"/><stop offset=".35" stop-color="#e0244a"/><stop offset="1" stop-color="#4a0716"/></radialGradient></defs>'
  + '<rect x="38" y="12" width="10" height="10" rx="2" transform="rotate(40 43 17)" fill="#55607a"/><path d="M46 12q6-8 12-4" stroke="#ffc94a" stroke-width="3" fill="none" stroke-linecap="round"/>'
  + '<circle cx="58" cy="8" r="3.5" fill="#fff6a8"/><circle cx="22" cy="30" r="5" fill="#fff" opacity=".55"/></svg>';

const CSS = `
.mn-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 14px 10px; }
.mn-ladder { display: flex; gap: 5px; width: 100%; max-width: 440px; overflow: hidden; }
.mn-ladder span { flex: 1 0 0; min-width: 0; text-align: center; font: 700 12px system-ui, sans-serif; padding: 5px 0; border-radius: 7px; background: var(--input); color: var(--muted); border: 1px solid var(--line); transition: all .2s; }
.mn-ladder span.now { background: rgba(39,224,124,.15); color: var(--win); border-color: var(--win); }
.mn-ladder span small { display: block; font-size: 9.5px; opacity: .7; font-weight: 600; }
.mn-board { display: grid; grid-template-columns: repeat(5, 1fr); grid-template-rows: repeat(5, 1fr); gap: 8px; width: 100%; max-width: 440px; aspect-ratio: 1; }
.og .mn-tile { position: relative; aspect-ratio: 1; min-height: 0; border: 0; border-radius: 10px; padding: 0; background: linear-gradient(180deg, #2f3a74, #232c5c); box-shadow: 0 5px 0 #151b3d, inset 0 1px 0 rgba(255,255,255,.12);
  transition: transform .1s, box-shadow .1s, background .15s; display: flex; align-items: center; justify-content: center; }
.mn-tile:not(:disabled):hover { transform: translateY(-3px); background: linear-gradient(180deg, #3b4892, #2b3570); box-shadow: 0 8px 0 #151b3d, 0 0 18px rgba(91,124,255,.35), inset 0 1px 0 rgba(255,255,255,.18); }
.mn-tile:not(:disabled):active { transform: translateY(3px); box-shadow: 0 2px 0 #151b3d; }
.og .mn-tile:disabled { opacity: 1; cursor: default; }
.mn-tile svg { width: 62%; height: 62%; }
.mn-tile.gem, .mn-tile.mine { background: #0c1130; box-shadow: inset 0 0 0 2px rgba(255,255,255,.04), 0 2px 0 #070a1c; transform: translateY(4px); }
.mn-tile.gem svg, .mn-tile.mine svg { animation: mn-pop .35s cubic-bezier(.2,1.6,.4,1); filter: drop-shadow(0 0 10px rgba(39,224,124,.55)); }
.mn-tile.mine svg { filter: drop-shadow(0 0 12px rgba(255,75,99,.7)); }
.mn-tile.mine.hit { background: radial-gradient(circle, rgba(255,75,99,.55), #2a0a16 70%); }
.mn-tile.dim svg { opacity: .32; filter: none; animation: mn-fade .3s ease-out; }
.mn-tile.dim { transform: translateY(4px) scale(.94); }
.mn-tile.sel { background: linear-gradient(180deg, #7b5cff, #5537d8); box-shadow: 0 5px 0 #2f1d85, 0 0 16px rgba(154,92,255,.5); }
.mn-over { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 5; }
.mn-over div { background: rgba(10,14,32,.92); border: 2px solid var(--win); border-radius: 14px; padding: 12px 26px; text-align: center; box-shadow: 0 0 34px rgba(39,224,124,.4); animation: mn-in .3s cubic-bezier(.2,1.5,.4,1); }
.mn-over b { display: block; font-size: 30px; color: var(--win); font-weight: 900; }
.mn-over span { font-size: 14px; font-weight: 700; }
.mn-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.mn-info div { background: var(--input); border-radius: 8px; padding: 6px 8px; font-size: 11px; color: var(--muted); border: 1px solid var(--line); }
.mn-info b { display: block; color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums; }
.mn-info b.w { color: var(--win); }
@keyframes mn-pop { from { transform: scale(.2) rotate(-25deg); opacity: 0; } }
@keyframes mn-fade { from { opacity: 0; } }
@keyframes mn-in { from { transform: scale(.5); opacity: 0; } }
`;

// Same formula as the server, to show the ladder ahead of time.
function multiplier(mines, k, edge = 0.02) {
  let m = 1 - edge;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - mines - i);
  return Math.round(m * 100) / 100;
}

export function mount(container, api) {
  const st = store('mines');
  let view = null;
  let game = null; // this player's public game from the server
  let mines = st.get('mines', 3);
  let mode = 'Manual';
  let serverBalance = 0;
  let seedsNow = null;
  let pending = false; // a request is out
  let runner = null;
  let autoTimer = null;
  let picked = new Set(st.get('tiles', [])); // auto mode's chosen tiles
  let overTimer = null;

  const { panel, stage, foot, below } = shell(container, CSS);

  // ---- panel ----
  const modeTabs = tabs(['Manual', 'Auto'], mode, (m) => { mode = m; if (game && game.over) game = null; renderBoard(); renderPanel(); });
  const balance = balanceLine();
  const amountSlot = el('div');
  let amount = null;
  const minesSel = select(Array.from({ length: 24 }, (_, i) => [i + 1, String(i + 1)]), mines, (v) => { mines = Number(v); st.set('mines', mines); if (picked.size > TILES - mines) { picked = new Set([...picked].slice(0, TILES - mines)); st.set('tiles', [...picked]); } renderLadder(); renderBoard(); renderPanel(); });
  const gemsBox = numberInput({ value: TILES - mines });
  gemsBox.input.readOnly = true;
  const setup = el('div', 'og-row2');
  setup.append(field('Mines', minesSel.el).el, field('Gems', gemsBox.el).el);
  const info = el('div', 'mn-info');
  const infoMult = el('b'); const infoWin = el('b', 'w');
  const i1 = el('div', null, 'Multiplier'); i1.append(infoMult);
  const i2 = el('div', null, 'Total profit'); i2.append(infoWin);
  info.append(i1, i2);
  const speed = select(Object.keys(SPEEDS).map((s) => [s, s[0].toUpperCase() + s.slice(1)]), st.get('speed', 'fast'), (v) => st.set('speed', v));
  const auto = autoFields(st);
  const autoBox = el('div', 'og-field');
  const clearSel = btn('og-bet ghost', 'Clear selection', () => { picked.clear(); st.set('tiles', []); renderBoard(); renderPanel(); });
  clearSel.style.height = '32px'; clearSel.style.fontSize = '13px';
  autoBox.append(field('Speed', speed.el).el, auto.el, clearSel);
  const betBtn = btn('og-bet', 'Bet', onMain);
  const randomBtn = btn('og-bet ghost', 'Pick random tile', randomPick);
  randomBtn.style.height = '34px'; randomBtn.style.fontSize = '13px';
  const msg = el('div', 'og-msg');
  const hint = el('div', 'og-hot');
  panel.append(modeTabs.el, balance.el, amountSlot, setup, info, autoBox, betBtn, randomBtn, msg, hint);

  // ---- stage ----
  const wrap = el('div', 'mn-wrap');
  const ladder = el('div', 'mn-ladder');
  const board = el('div', 'mn-board');
  const tiles = Array.from({ length: TILES }, (_, i) => {
    const t = btn('mn-tile', null, () => onTile(i));
    t.setAttribute('aria-label', `Tile ${i + 1}`);
    board.append(t);
    return t;
  });
  wrap.append(ladder, board);
  const fair = fairButton({
    seeds: () => seedsNow,
    rotate: (client) => api.sendAction({ kind: 'seed', client }),
    intro: 'Mines are placed when the game starts from HMAC-SHA256(server seed, "client seed:nonce:cursor"), 4 bytes per float. Mine i takes the floor(float_i × (25 − i))th of the tiles still free, counting row by row from the top left. Rotate the pair to reveal the server seed.',
    verify: {
      fields: [['server', 'Server seed'], ['hash', 'Server seed hash (optional)'], ['client', 'Client seed'], ['nonce', 'Nonce', '0'], ['mines', 'Mines', String(mines)]],
      async run(v) {
        const n = Number(v.mines);
        const f = await floats(v.server, v.client, Number(v.nonce), n);
        const free = Array.from({ length: TILES }, (_, i) => i);
        const out = f.map((x, i) => free.splice(Math.floor(x * (TILES - i)), 1)[0]);
        const grid = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (out.includes(r * 5 + c) ? 'X' : '.')).join(''));
        return `Mines on tiles ${out.map((t) => t + 1).sort((a, b) => a - b).join(', ')}\n${grid.join('\n')}`;
      },
    },
  });
  const footText = el('span', null, '98% RTP');
  foot.append(fair.el, el('span', 'og-spacer'), footText);
  stage.append(wrap, foot);
  const stats = statsCard();
  const feed = feedCard(() => api.getClientId());
  below.append(feed.el, stats.el);

  const live = () => game && !game.over;
  const curMines = () => (live() ? game.mines : mines);

  function renderLadder() {
    const m = curMines();
    const k = live() ? game.picks.length : 0;
    const gems = TILES - m;
    ladder.replaceChildren();
    const from = Math.max(1, Math.min(k, gems - 5));
    for (let i = from; i < from + 6 && i <= gems; i++) {
      const s = el('span', i === k ? 'now' : null, fmtX(multiplier(m, i)));
      s.append(el('small', null, `${i} gem${i > 1 ? 's' : ''}`));
      ladder.append(s);
    }
    gemsBox.set(gems);
    footText.textContent = `${m} mine${m > 1 ? 's' : ''} · max ${fmtX(multiplier(m, gems))} · 98% RTP`;
  }

  // Draws the board from `game` (live or finished) or the auto selection.
  function renderBoard(stagger) {
    const g = game;
    const mineSet = new Set((g && g.mineTiles) || []);
    const picks = new Set((g && g.picks) || []);
    tiles.forEach((t, i) => {
      let cls = 'mn-tile';
      let art = '';
      if (g && picks.has(i)) { cls += ' gem'; art = GEM; } else if (g && g.over) {
        art = mineSet.has(i) ? BOMB : GEM;
        cls += mineSet.has(i) ? ' mine' : ' gem';
        if (i === g.hit) cls += ' hit'; else cls += ' dim';
      } else if (mode === 'Auto' && picked.has(i) && !(g && !g.over)) cls += ' sel';
      if (t.className !== cls) {
        t.className = cls;
        t.innerHTML = art;
        const svg = t.firstChild;
        if (svg && stagger) svg.style.animationDelay = `${stagger(i)}ms`;
      }
      t.disabled = mode === 'Auto' ? !!runner || pending : !live() || pending;
    });
    renderLadder();
  }

  function renderPanel() {
    if (!view) return;
    if (!amount) { amount = amountField(st, view.limits, () => serverBalance); amountSlot.replaceChildren(amount.el); amount.onChange(renderPanel); }
    const isAuto = mode === 'Auto';
    const playing = live();
    modeTabs.lock(playing || !!runner);
    amount.disable(playing || !!runner);
    minesSel.disable(playing || !!runner);
    autoBox.style.display = isAuto ? '' : 'none';
    randomBtn.style.display = isAuto ? 'none' : '';
    auto.disable(!!runner);
    clearSel.disabled = !!runner || !picked.size;
    const k = playing ? game.picks.length : 0;
    const mult = playing && k ? game.mult : isAuto ? multiplier(mines, picked.size) : 1;
    const bet = playing ? game.bet : amount.get();
    infoMult.textContent = fmtX(mult);
    infoWin.textContent = `+${money(bet * mult - bet)}`;
    info.style.display = isAuto || playing ? '' : 'none';
    if (isAuto) {
      betBtn.className = runner ? 'og-bet stop' : 'og-bet';
      betBtn.replaceChildren(document.createTextNode(runner ? 'Stop Autobet' : 'Start Autobet'));
      if (runner) betBtn.append(el('small', null, `${runner.left === Infinity ? '∞' : runner.left} left · ${runner.net >= 0 ? '+' : ''}${money(runner.net)}`));
      betBtn.disabled = !runner && (!picked.size || serverBalance < amount.get());
      hint.textContent = picked.size ? `${picked.size} tile${picked.size > 1 ? 's' : ''} selected` : 'Click tiles on the board to choose them';
    } else if (playing) {
      betBtn.className = 'og-bet cash';
      betBtn.replaceChildren(document.createTextNode('Cash Out'), el('small', null, k ? money(game.bet * game.mult) : 'turn a tile first'));
      betBtn.disabled = !k || pending;
      randomBtn.disabled = pending;
      hint.textContent = k ? 'Space cashes out' : 'Pick tiles on the board';
    } else {
      betBtn.className = 'og-bet';
      betBtn.textContent = 'Bet';
      betBtn.disabled = pending || serverBalance < amount.get();
      randomBtn.disabled = true;
      hint.textContent = 'Space bets';
    }
  }

  function send(data) { pending = true; api.sendAction(data); renderBoard(); renderPanel(); }

  function onMain() {
    msg.textContent = '';
    if (mode === 'Auto') { if (runner) stopAuto(); else startAuto(); return; }
    if (live()) { if (game.picks.length) { send({ kind: 'cashout' }); } return; }
    clearOver();
    game = null;
    send({ kind: 'start', bet: amount.get(), mines });
    sfx.play('chips');
  }
  function onTile(i) {
    if (mode === 'Auto') {
      if (runner) return;
      if (picked.has(i)) picked.delete(i);
      else if (picked.size < TILES - mines) picked.add(i);
      else { msg.textContent = `Only ${TILES - mines} gems with ${mines} mines.`; return; }
      st.set('tiles', [...picked]);
      clearOver();
      if (game && game.over) game = null;
      sfx.play('click');
      renderBoard(); renderPanel();
      return;
    }
    if (!live() || pending || game.picks.includes(i)) return;
    tiles[i].style.transform = 'scale(.9)';
    setTimeout(() => { tiles[i].style.transform = ''; }, 120);
    send({ kind: 'pick', tile: i });
  }
  function randomPick() {
    if (!live() || pending) return;
    const free = tiles.map((_, i) => i).filter((i) => !game.picks.includes(i));
    onTile(free[Math.floor(Math.random() * free.length)]);
  }

  function clearOver() { clearTimeout(overTimer); stage.querySelectorAll('.mn-over').forEach((n) => n.remove()); }
  function showWin(g) {
    clearOver();
    const o = el('div', 'mn-over');
    const d = el('div');
    d.append(el('b', null, fmtX(g.mult)), el('span', null, `+${money(g.win - g.bet)}`));
    o.append(d);
    stage.append(o);
    overTimer = setTimeout(clearOver, runner ? 700 : 2400);
  }

  // A gem rings a little higher each time: the ladder you're climbing.
  const gemNote = (k, at = 0) => sfx.note(523 * 2 ** (Math.min(k, 24) / 12 * 1.4), { dur: 0.14, type: 'triangle', vol: 0.16, at });

  function onGame(d) {
    const prev = game;
    game = d.game;
    serverBalance = d.balance;
    seedsNow = d.seeds;
    pending = false;
    const g = game;
    const k = g.picks.length;
    if (g.auto) {
      // Whole bet settled at once: reveal the picked tiles in order, then the rest.
      const order = new Map(g.picks.map((t, i) => [t, i]));
      const fast = SPEEDS[speed.get()] < 400;
      renderBoard((i) => (order.has(i) ? order.get(i) * (fast ? 25 : 70) : (k + 1) * (fast ? 25 : 70)));
      if (g.hit != null) { sfx.play('crash'); shake(stage); } else { g.picks.forEach((_, i) => gemNote(i + 1, i * (fast ? 0.025 : 0.07))); }
    } else if (!g.over) {
      renderBoard();
      if (prev && k > prev.picks.length) gemNote(k);
      else sfx.play('select');
    } else {
      renderBoard((i) => (g.picks.includes(i) ? 0 : 120 + Math.abs(i - (g.hit ?? 12)) * 18));
      if (g.hit != null) { sfx.play('crash'); shake(stage); } else if (prev && k > prev.picks.length) gemNote(k);
    }
    if (g.over) {
      stats.add(g.bet, g.win - g.bet);
      if (g.win > 0) {
        if (g.mult >= 10) celebrate(stage, g.mult, g.win - g.bet);
        else { showWin(g); if (!runner) sfx.play('point'); }
      }
    }
    balance.set(serverBalance);
    renderPanel();
    if (runner && g.over) {
      const next = runner.next(g.win - g.bet, serverBalance);
      if (next == null) { stopAuto(runner.reason); return; }
      autoTimer = setTimeout(autoStep, SPEEDS[speed.get()]);
    }
  }

  function startAuto() {
    if (!picked.size) { msg.textContent = REJECT.bad_tiles; return; }
    runner = autoRunner(auto.read(), amount.get(), view.limits);
    autoStep();
  }
  function autoStep() {
    autoTimer = null;
    if (!runner) return;
    clearOver();
    send({ kind: 'auto', bet: runner.bet, mines, tiles: [...picked] });
  }
  function stopAuto(reason) {
    runner = null;
    clearTimeout(autoTimer); autoTimer = null;
    if (reason) { msg.className = 'og-msg info'; msg.textContent = reason; }
    renderBoard(); renderPanel();
  }

  const offKey = hotkey(() => (mode === 'Manual' && live() && !game.picks.length ? randomPick() : onMain()));

  return {
    applySnapshot(data) { if (data && data.kind === 'state' && data.seeds) this.applyEvent(data); },
    applyEvent(data) {
      if (!data) return;
      if (data.kind === 'state') {
        view = data;
        seedsNow = data.seeds;
        serverBalance = data.balance;
        game = data.game;
        balance.set(serverBalance);
        feed.set(data.feed);
        renderBoard(); renderPanel();
      } else if (data.kind === 'game') onGame(data);
      else if (data.kind === 'feed') feed.set(data.feed);
      else if (data.kind === 'seeds') { seedsNow = data.seeds; fair.reveal(data.prev); fair.open({ server: data.prev.server, hash: data.prev.hash, client: data.prev.client, nonce: String(Math.max(0, data.prev.nonces - 1)), mines: String(game ? game.mines : mines) }); }
      else if (data.kind === 'moveRejected') {
        pending = false;
        sfx.play('error');
        msg.className = 'og-msg'; msg.textContent = REJECT[data.reason] || data.reason;
        if (runner) stopAuto();
        renderBoard(); renderPanel();
      }
    },
    unmount() { offKey(); stopAuto(); clearOver(); container.innerHTML = ''; },
  };
}
