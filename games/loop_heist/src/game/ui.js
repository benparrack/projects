// Tiny DOM helpers and text formatting.
import { ROLES, TICK_RATE } from '../sim/constants.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

export const clear = (el) => el.replaceChildren();

export function fmtTime(ticks) {
  const s = Math.floor(ticks / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function eventClass(e) {
  return e.k === 'alarm' ? 'alarm' : e.k === 'paradox' ? 'paradox' : '';
}

export function describeEvent(e, sim) {
  const who = e.a >= 0 ? `${e.a + 1} ${ROLES[sim.crew[e.a]?.role]?.name ?? ''}` : '';
  switch (e.k) {
    case 'open': return `${who} opened door ${e.id}`;
    case 'close': return `${who} closed door ${e.id}`;
    case 'locked': return `${who} found door ${e.id} locked`;
    case 'blocked': return `${who} couldn't close door ${e.id}: someone's in it`;
    case 'key': return `${who} took keycard ${e.id}`;
    case 'loot': return `${who} grabbed the ${e.id}`;
    case 'drop': return `${who} dropped ${e.id}`;
    case 'escape': return `${who} reached the van`;
    case 'whistle': return `${who} whistled`;
    case 'takedown': return `${who} took down ${e.id}`;
    case 'body': return `${who} picked up ${e.id}`;
    case 'done:pick': return `${who} picked the lock on ${e.id}`;
    case 'done:power-off': return `${who} cut the power (${e.id})`;
    case 'done:power-on': return `${who} restored the power (${e.id})`;
    case 'done:hack': return `${who} hacked ${e.id}`;
    case 'done:vault': return `${who} cracked ${e.id}`;
    case 'paradox': return `PARADOX: ${who} ${e.id}`;
    case 'alarm': return `ALARM: ${e.id}`;
    case 'gate-open': return `gate ${e.id} slid open`;
    case 'gate-close': return `gate ${e.id} slammed shut`;
    case 'guard-door': { const [g, d] = e.id.split(':'); return `${g} opened door ${d}`; }
    case 'power-restored': { const [g, b] = e.id.split(':'); return `${g} fixed power box ${b}`; }
    default: return `${who} ${e.k} ${e.id}`;
  }
}
