// Standalone page glue: wires index.html's controls to a Player.
import { Player } from './player.js';
import { WIDTH, HEIGHT } from '../src/ppu.js';

const $ = (id) => document.getElementById(id);
const player = new Player({ canvas: $('screen') });
window.player = player; // handy for debugging from the console

// Bundled free homebrew (fetched by roms/fetch.sh; see README for credits/licenses).
const LIBRARY = [
  { file: 'ucity.gbc', name: 'µCity', by: 'Antonio Niño Díaz', note: 'city builder', cgb: true },
  { file: 'libbet.gb', name: 'Libbet and the Magic Floor', by: 'Damian Yerrick', note: 'puzzle' },
  { file: 'big2small.gb', name: 'Big2Small', by: 'mdsteele', note: 'puzzle', cgb: true },
  { file: 'tobudx.gb', name: 'Tobu Tobu Girl Deluxe', by: 'Tangram Games', note: 'arcade platformer', cgb: true },
  { file: 'porklike.gb', name: 'Porklike', by: 'binji', note: 'roguelike' },
  { file: 'shocklobster.gb', name: 'Shock Lobster', by: 'tbsp', note: 'action' },
  { file: 'geometrix.gbc', name: 'Geometrix', by: 'Antonio Niño Díaz', note: 'puzzle', cgb: true },
  { file: 'adjustris.gb', name: 'Adjustris', by: 'tbsp', note: 'falling blocks' },
  { file: '2048.gb', name: '2048', by: 'Sanqui', note: 'puzzle' },
];
const ROM_BASE = '../roms/homebrew/';

// ---------------- toast / status ----------------
let toastTimer;
player.addEventListener('toast', (e) => {
  const t = $('toast');
  t.textContent = e.detail;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
});
player.addEventListener('fps', (e) => { $('fps').textContent = `${e.detail} fps`; });
player.addEventListener('pausechange', (e) => {
  $('btn-pause').textContent = e.detail ? 'Resume' : 'Pause';
  const o = $('overlay');
  o.hidden = !e.detail;
  o.textContent = 'PAUSED';
});
player.addEventListener('romloaded', (e) => {
  const { title, cgb } = e.detail;
  $('status').textContent = `${title} — ${cgb ? 'Game Boy Color' : 'Game Boy'} mode`;
  $('drop-hint').hidden = true;
  $('power-led').classList.add('on');
  for (const id of ['btn-pause', 'btn-reset', 'btn-save', 'btn-load', 'btn-shot'])
    $(id).disabled = false;
  $('btn-export').disabled = !player.gb.cart.hasBattery();
  document.title = `${title} · Game Boy`;
  renderSlots();
});
player.addEventListener('stateschanged', renderSlots);
player.addEventListener('slotchange', renderSlots);

// ---------------- loading ROMs ----------------
async function loadBytes(bytes, name) {
  await player.initAudio();
  if (/\.zip$/i.test(name)) {
    const found = await unzipFirstRom(bytes);
    if (!found) { player.toast('No .gb/.gbc in that zip'); return; }
    ({ bytes, name } = found);
  }
  try { await player.loadRom(bytes, name); } catch { /* toast already shown */ }
  localStorage.setItem('gb.last', name);
}

async function loadLibrary(entry) {
  $('status').textContent = `Loading ${entry.name}…`;
  await player.initAudio(); // inside the click gesture
  const res = await fetch(ROM_BASE + entry.file);
  if (!res.ok) { $('status').textContent = `Couldn't fetch ${entry.file} (run roms/fetch.sh)`; return; }
  await loadBytes(new Uint8Array(await res.arrayBuffer()), entry.file);
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  e.target.value = '';
});

const wrap = $('screen-wrap');
for (const t of [document.body]) {
  t.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dragging'); });
  t.addEventListener('dragleave', (e) => { if (!e.relatedTarget) wrap.classList.remove('dragging'); });
  t.addEventListener('drop', async (e) => {
    e.preventDefault();
    wrap.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (f) await loadBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  });
}

// Minimal zip reader: finds the first .gb/.gbc entry (stored or deflated) via DecompressionStream.
async function unzipFirstRom(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  while (p + 30 < buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    const data = buf.subarray(start, start + csize);
    if (/\.gbc?$/i.test(name)) {
      if (method === 0) return { bytes: data.slice(), name };
      if (method === 8) {
        const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return { bytes: new Uint8Array(await new Response(ds).arrayBuffer()), name };
      }
    }
    p = start + csize;
  }
  return null;
}

function renderLibrary() {
  const ul = $('library');
  ul.innerHTML = '';
  for (const g of LIBRARY) {
    const li = document.createElement('li');
    li.innerHTML = `<div><div class="name"></div><div class="meta"></div></div><span class="tag ${g.cgb ? 'cgb' : ''}">${g.cgb ? 'GBC' : 'GB'}</span>`;
    li.querySelector('.name').textContent = g.name;
    li.querySelector('.meta').textContent = `${g.by} · ${g.note}`;
    li.addEventListener('click', () => loadLibrary(g));
    ul.appendChild(li);
  }
}

// ---------------- save states ----------------
async function renderSlots() {
  const box = $('slots');
  box.innerHTML = '';
  for (let s = 1; s <= 4; s++) {
    const d = document.createElement('div');
    d.className = 'slot' + (s === player.slot ? ' sel' : '');
    const c = document.createElement('canvas');
    c.width = WIDTH; c.height = HEIGHT;
    const label = document.createElement('div');
    label.textContent = `Slot ${s}`;
    d.append(c, label);
    d.addEventListener('click', () => { player.slot = s; renderSlots(); });
    box.appendChild(d);
    const info = await player.stateInfo(s);
    if (info) {
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(WIDTH, HEIGHT);
      new Uint32Array(img.data.buffer).set(info.thumb);
      ctx.putImageData(img, 0, 0);
      label.textContent = new Date(info.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
}

$('btn-save').onclick = () => player.saveState();
$('btn-load').onclick = () => player.loadState();
$('btn-shot').onclick = () => player.screenshot();
$('btn-pause').onclick = () => player.togglePause();
$('btn-reset').onclick = () => player.reset();

$('btn-export').onclick = () => {
  const data = player.exportBatterySave();
  if (!data) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data]));
  a.download = (player.romName || 'game').replace(/\.[^.]+$/, '') + '.sav';
  a.click();
};
$('import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f && player.gb) await player.importBatterySave(new Uint8Array(await f.arrayBuffer()));
  e.target.value = '';
});

// ---------------- options (persisted per browser) ----------------
const prefs = JSON.parse(localStorage.getItem('gb.prefs') || '{}');
const savePrefs = () => localStorage.setItem('gb.prefs', JSON.stringify(prefs));
function bindOpt(id, key, apply, prop = 'value') {
  const el = $(id);
  if (key in prefs) el[prop] = prefs[key];
  const run = () => { prefs[key] = el[prop]; savePrefs(); apply(el[prop]); };
  el.addEventListener(el.type === 'range' ? 'input' : 'change', run);
  apply(el[prop]);
}
bindOpt('volume', 'volume', (v) => player.setVolume(+v));
bindOpt('palette', 'palette', (v) => player.setPalette(v));
bindOpt('cc', 'cc', (v) => player.setColorCorrection(v), 'checked');
bindOpt('blend', 'blend', (v) => { player.lcdBlend = v; }, 'checked');
bindOpt('ffspeed', 'ff', (v) => { player.speed = +v; });

$('btn-full').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else wrap.requestFullscreen?.();
};

// ---------------- touch / mouse on the shell buttons ----------------
// Pointer events with capture-free hit testing, so sliding a thumb across the d-pad works.
const active = new Map(); // pointerId -> button name
function btnAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.dataset && el.dataset.btn ? el : null;
}
function setHeld(pid, el) {
  const prev = active.get(pid);
  const name = el ? el.dataset.btn : null;
  if (prev === name) return;
  if (prev) {
    player.setTouchButton(prev, false);
    document.querySelector(`[data-btn="${prev}"]`).classList.remove('held');
  }
  if (name) {
    player.setTouchButton(name, true);
    el.classList.add('held');
    active.set(pid, name);
    navigator.vibrate?.(8);
  } else active.delete(pid);
}
const touch = $('touch');
touch.addEventListener('pointerdown', (e) => {
  player.initAudio();
  setHeld(e.pointerId, btnAt(e.clientX, e.clientY));
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (active.has(e.pointerId)) setHeld(e.pointerId, btnAt(e.clientX, e.clientY));
});
for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, (e) => setHeld(e.pointerId, null));
touch.addEventListener('contextmenu', (e) => e.preventDefault());

// Any key press also unlocks audio (autoplay policy).
window.addEventListener('keydown', () => player.initAudio(), { once: true });

renderLibrary();
renderSlots();
