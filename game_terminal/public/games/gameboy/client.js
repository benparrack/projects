// Game Boy / Game Boy Color — a real emulator (emu/, synced from the top-level gameboy/ project
// via gameboy/tools/sync-game-terminal.sh; edit it there, not here). Everyone plays locally;
// the room shows who's playing what, and you can WATCH anyone playing a bundled game.
// Server plugin: ../../../server/games/gameboy.js (explains the lockstep spectating scheme).
import { Player } from './emu/web/player.js';
import { encodeState, decodeState } from './emu/web/netstate.js';
import { sfx } from '../sfx.js';

const LIBRARY = [ // ids must match server/games/gameboy.js LIBRARY
  { id: 'ucity', file: 'ucity.gbc', name: 'µCITY', note: 'city builder · GBC' },
  { id: 'libbet', file: 'libbet.gb', name: 'LIBBET', note: 'puzzle · GB' },
  { id: 'big2small', file: 'big2small.gb', name: 'BIG2SMALL', note: 'puzzle · GBC' },
];
const ROM_BASE = new URL('./roms/', import.meta.url);
const FLUSH_MS = 50; // spectator input batches

const CSS = `
.gbx { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: flex-start; padding: 12px; width: 100%; }
.gbx-left { flex: 1 1 400px; max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.gbx-screen { position: relative; width: 100%; aspect-ratio: 160/144; border: 2px solid var(--border); background: #000; }
.gbx-screen canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
.gbx-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center;
  padding: 16px; background: #000c; color: var(--fg); pointer-events: none; }
.gbx-status { font-size: 0.85em; color: var(--fg-dim); min-height: 1.2em; text-align: center; }
.gbx-side { flex: 1 1 200px; max-width: 280px; display: flex; flex-direction: column; gap: 6px; font-size: 0.9em; }
.gbx-side h4 { margin: 10px 0 2px; color: var(--accent); font-weight: normal; }
.gbx-side button { width: 100%; text-align: left; padding: 6px 10px; }
.gbx-side button small { color: var(--fg-dim); display: block; font-size: 0.8em; }
.gbx-side button:hover small { color: #000; }
.gbx-row { display: flex; gap: 6px; }
.gbx-row button { text-align: center; }
.gbx-side label { display: flex; gap: 8px; align-items: center; }
.gbx-side select { background: #000; color: var(--fg); border: 1px solid var(--border); font-family: inherit; }
.gbx-side input[type=range] { flex: 1; accent-color: var(--fg); }
.gbx-who li { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 3px 0; }
.gbx-who button { width: auto; padding: 2px 8px; font-size: 0.8em; }
.gbx-who { list-style: none; margin: 0; padding: 0; }
.gbx-help { font-size: 0.75em; color: var(--fg-dim); line-height: 1.5; }
.gbx-pad { display: none; width: 100%; justify-content: space-between; align-items: center; user-select: none; touch-action: none; }
.gbx-pad .dp { display: grid; grid-template: repeat(3, 44px) / repeat(3, 44px); }
.gbx-pad button { padding: 0; touch-action: none; }
.gbx-pad .held { background: var(--fg-dim); }
.gbx-pad .ab { display: flex; gap: 12px; }
.gbx-pad .ab button { width: 58px; height: 58px; border-radius: 50%; }
.gbx-pad .ss { display: flex; flex-direction: column; gap: 8px; }
.gbx-pad .ss button { font-size: 0.7em; padding: 4px 8px; }
@media (pointer: coarse) { .gbx-pad { display: flex; } }
`;

export function mount(container, api) {
  if (!document.getElementById('gbx-style')) {
    const st = document.createElement('style');
    st.id = 'gbx-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'gbx';
  root.innerHTML = `
    <div class="gbx-left">
      <div class="gbx-screen"><canvas></canvas><div class="gbx-msg">PICK A GAME →<br><br>or open your own .gb / .gbc file</div></div>
      <div class="gbx-status"></div>
      <div class="gbx-pad">
        <div class="dp"><span></span><button data-btn="up">▲</button><span></span>
          <button data-btn="left">◀</button><span></span><button data-btn="right">▶</button>
          <span></span><button data-btn="down">▼</button><span></span></div>
        <div class="ss"><button data-btn="select">SELECT</button><button data-btn="start">START</button></div>
        <div class="ab"><button data-btn="b">B</button><button data-btn="a">A</button></div>
      </div>
    </div>
    <div class="gbx-side">
      <h4>&gt; LIBRARY (free homebrew)</h4>
      <div class="gbx-lib"></div>
      <label><button class="gbx-open" type="button">OPEN ROM FILE…</button><input type="file" accept=".gb,.gbc" hidden></label>
      <h4>&gt; IN THIS ROOM</h4>
      <ul class="gbx-who"></ul>
      <h4>&gt; OPTIONS</h4>
      <div class="gbx-row"><button data-act="pause">PAUSE</button><button data-act="reset">RESET</button><button data-act="full">FULL</button></div>
      <div class="gbx-row"><button data-act="save">SAVE ST</button><button data-act="load">LOAD ST</button></div>
      <label>VOL <input type="range" min="0" max="1" step="0.05" class="gbx-vol"></label>
      <label>DMG PALETTE <select class="gbx-pal"><option value="green">green</option><option value="pocket">pocket</option><option value="gray">gray</option></select></label>
      <div class="gbx-help">ARROWS/WASD move · X/K = A · Z/J = B · ENTER start · SHIFT select<br>
        hold SPACE fast-forward · hold R rewind · P pause · F5/F8 save/load state<br>
        Battery saves are kept in this browser.</div>
    </div>`;
  container.appendChild(root);
  const $ = (sel) => root.querySelector(sel);
  const canvas = $('canvas');
  const msgEl = $('.gbx-msg');
  const statusEl = $('.gbx-status');
  const player = new Player({ canvas });
  root.gbxPlayer = player; // debugging / tests: document.querySelector('.gbx').gbxPlayer

  const prefs = (() => { try { return JSON.parse(localStorage.getItem('gbx.prefs') || '{}'); } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem('gbx.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } };
  $('.gbx-vol').value = prefs.vol ?? 0.7;
  $('.gbx-pal').value = prefs.pal || 'green';
  player.setVolume(+$('.gbx-vol').value);
  player.setPalette($('.gbx-pal').value);
  $('.gbx-vol').oninput = (e) => { prefs.vol = +e.target.value; player.setVolume(prefs.vol); savePrefs(); };
  $('.gbx-pal').onchange = (e) => { prefs.pal = e.target.value; player.setPalette(prefs.pal); savePrefs(); };

  function showMsg(text) { msgEl.hidden = !text; msgEl.innerHTML = text || ''; }
  player.addEventListener('toast', (e) => { statusEl.textContent = e.detail; });
  player.addEventListener('pausechange', (e) => { showMsg(e.detail ? 'PAUSED' : ''); $('[data-act=pause]').textContent = e.detail ? 'RESUME' : 'PAUSE'; });

  // ---------------- state ----------------
  let roster = [];
  let myLib = null;          // library id I'm playing (null = custom ROM / nothing)
  let myWatchers = 0;
  let watching = null;       // clientId I'm spectating
  let watchLib = null;       // lib currently loaded for spectating
  let preKeyInputs = [];     // 'inp' batches that arrived while a keyframe was still decoding
  let decoding = false;
  let pendingInputs = [];
  let keyInFlight = false;
  let destroyed = false;
  const romCache = new Map();

  async function fetchLib(entry) {
    if (!romCache.has(entry.id)) {
      const res = await fetch(new URL(entry.file, ROM_BASE));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      romCache.set(entry.id, new Uint8Array(await res.arrayBuffer()));
    }
    return romCache.get(entry.id).slice();
  }

  // ---------------- playing ----------------
  async function play(bytes, name, lib) {
    stopWatching(false);
    await player.initAudio();
    try {
      await player.loadRom(bytes, name);
    } catch (e) {
      statusEl.textContent = `CAN'T LOAD: ${e.message}`;
      return;
    }
    myLib = lib;
    pendingInputs = [];
    const title = player.gb.cart.header.title || name;
    showMsg('');
    statusEl.textContent = `PLAYING ${title} (${player.gb.cgb ? 'GBC' : 'GB'} MODE)`;
    api.sendAction({ kind: 'playing', lib, title });
    if (myWatchers && lib) sendKey(); // anyone already watching follows me to the new game
  }

  // Streaming to spectators: capture the keyframe synchronously, gzip it async, and hold input
  // batches until it's sent so a watcher never sees inputs from before its keyframe.
  async function sendKey() {
    if (!myLib || !player.gb || player.remote || keyInFlight) return;
    keyInFlight = true;
    const k = player.keyframe();
    pendingInputs = pendingInputs.filter(([f]) => f >= k.frame);
    try {
      const state = await encodeState(k.state);
      if (!destroyed) api.sendAction({ kind: 'key', state, frame: k.frame, mask: k.mask });
    } finally { keyInFlight = false; }
  }
  player.onInput = (f, m) => { if (myWatchers) pendingInputs.push([f, m]); };
  player.addEventListener('discontinuity', () => { if (myWatchers) { pendingInputs = []; sendKey(); } });

  const flushTimer = setInterval(() => {
    if (!myWatchers || !myLib || !player.gb || player.remote || keyInFlight) return;
    const batch = pendingInputs.splice(0, 256);
    api.sendAction({ kind: 'inp', i: batch, upTo: player.frameCount });
  }, FLUSH_MS);

  // ---------------- watching ----------------
  function watch(target) {
    if (player.gb && !player.remote) {
      player.setPaused(true); // flushes my battery save
      player.remote = { upTo: player.frameCount, inputs: new Map() }; // frozen until their keyframe
    }
    watching = target;
    watchLib = null;
    myLib = null;
    preKeyInputs = [];
    api.sendAction({ kind: 'watch', target });
    const p = roster.find((r) => r.clientId === target);
    showMsg(`CONNECTING TO ${p ? escapeHtml(p.nickname) : '…'}`);
    statusEl.textContent = '';
    player.initAudio();
    renderWho();
  }

  function stopWatching(tell = true, why = '') {
    if (!watching) return;
    watching = null;
    player.stopRemote();
    player.gb = null;
    player.clearScreen();
    if (tell) api.sendAction({ kind: 'watch', target: null });
    showMsg(why || 'PICK A GAME →');
    statusEl.textContent = '';
    renderWho();
  }

  async function onKey(d) {
    if (d.from !== watching) return;
    const entry = LIBRARY.find((e) => e.id === d.lib);
    if (!entry) return;
    decoding = true;
    try {
      if (watchLib !== d.lib || !player.gb) {
        const bytes = await fetchLib(entry);
        player.remote = { upTo: 0, inputs: new Map() }; // keep it frozen and save-less while loading
        await player.loadRom(bytes, entry.file);
        watchLib = d.lib;
      }
      const state = await decodeState(d.state);
      if (d.from !== watching) return;
      player.startRemote({ state, frame: d.frame, mask: d.mask });
      for (const b of preKeyInputs) player.pushRemote(b.i, b.upTo);
      preKeyInputs = [];
      const p = roster.find((r) => r.clientId === watching);
      showMsg('');
      statusEl.textContent = `WATCHING ${p ? p.nickname : ''} — ${p && p.title ? p.title : ''}`;
    } catch (e) {
      console.error('gameboy: keyframe failed', e);
      stopWatching(true, 'STREAM FAILED');
    } finally { decoding = false; }
  }

  function onInp(d) {
    if (d.from !== watching) return;
    if (decoding || !player.remote) { preKeyInputs.push(d); return; }
    player.pushRemote(d.i, d.upTo);
  }

  // ---------------- roster ----------------
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

  function renderWho() {
    const me = api.getClientId();
    const ul = $('.gbx-who');
    ul.innerHTML = '';
    for (const p of roster) {
      const li = document.createElement('li');
      const what = p.title ? `${p.title}${p.lib ? '' : ' (own ROM)'}` : p.watching ? 'watching' : 'idle';
      li.innerHTML = `<span>${escapeHtml(p.nickname)}${p.clientId === me ? ' (you)' : ''}<br><small style="color:var(--fg-dim)">${escapeHtml(what)}${p.watchers ? ` · ${p.watchers} 👁` : ''}</small></span>`;
      if (p.clientId !== me && p.lib) {
        const b = document.createElement('button');
        b.textContent = watching === p.clientId ? 'STOP' : 'WATCH';
        b.onclick = () => (watching === p.clientId ? stopWatching() : watch(p.clientId));
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
  }

  function applyRosterView(view) {
    roster = view.players || [];
    const me = roster.find((p) => p.clientId === api.getClientId());
    const before = myWatchers;
    myWatchers = me ? me.watchers : 0;
    if (!before && myWatchers) pendingInputs = [];
    if (watching) {
      const t = roster.find((p) => p.clientId === watching);
      if (!t) stopWatching(false, 'THEY LEFT THE ROOM');
      else if (!t.lib) stopWatching(true, `${escapeHtml(t.nickname)} STOPPED (or opened a custom ROM, which can't be watched)`);
      else if (watchLib && t.lib !== watchLib) { watchLib = null; showMsg('LOADING THEIR NEW GAME…'); } // next keyframe reloads
    }
    renderWho();
  }

  // ---------------- UI wiring ----------------
  for (const entry of LIBRARY) {
    const b = document.createElement('button');
    b.innerHTML = `${entry.name}<small>${entry.note}</small>`;
    b.onclick = async () => {
      sfx.play?.('click');
      player.initAudio(); // inside the gesture
      statusEl.textContent = 'LOADING…';
      try { await play(await fetchLib(entry), entry.file, entry.id); } catch (e) { statusEl.textContent = `LOAD FAILED: ${e.message}`; }
    };
    $('.gbx-lib').appendChild(b);
  }
  const fileInput = $('input[type=file]');
  $('.gbx-open').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) await play(new Uint8Array(await f.arrayBuffer()), f.name, null);
  };
  root.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      if (watching && b.dataset.act !== 'full') return;
      switch (b.dataset.act) {
        case 'pause': player.togglePause(); break;
        case 'reset': player.reset(); break;
        case 'save': player.saveState(); break;
        case 'load': player.loadState(); break;
        case 'full': if (document.fullscreenElement) document.exitFullscreen(); else $('.gbx-screen').requestFullscreen?.(); break;
      }
    };
  });

  // Touch pad (shown on coarse pointers): slide-between-buttons via elementFromPoint.
  const held = new Map();
  const pad = $('.gbx-pad');
  const setHeld = (pid, el) => {
    const name = el && pad.contains(el) && el.dataset.btn ? el.dataset.btn : null;
    const prev = held.get(pid);
    if (prev === name) return;
    if (prev) { player.setTouchButton(prev, false); pad.querySelector(`[data-btn=${prev}]`).classList.remove('held'); }
    if (name) { player.setTouchButton(name, true); el.classList.add('held'); held.set(pid, name); } else held.delete(pid);
  };
  const onDown = (e) => { player.initAudio(); setHeld(e.pointerId, document.elementFromPoint(e.clientX, e.clientY)); e.preventDefault(); };
  const onMove = (e) => { if (held.has(e.pointerId)) setHeld(e.pointerId, document.elementFromPoint(e.clientX, e.clientY)); };
  const onUp = (e) => setHeld(e.pointerId, null);
  pad.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  return {
    applySnapshot(view) { if (view && view.kind === 'roster') applyRosterView(view); },
    applyEvent(d) {
      if (!d || destroyed) return;
      if (d.kind === 'roster') applyRosterView(d);
      else if (d.kind === 'needKey') { pendingInputs = []; sendKey(); }
      else if (d.kind === 'key') onKey(d);
      else if (d.kind === 'inp') onInp(d);
    },
    unmount() {
      destroyed = true;
      clearInterval(flushTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      player.destroy();
      root.remove();
    },
  };
}
