// Cartoon SVG for the restaurant: the storefront per tier (with owned upgrades drawn in) and the
// customers' faces. Everything here is static markup; user text (the restaurant name) is set by the
// caller with textContent on .dn-sign-text, never interpolated.

export const ICON = { lettuce: '🥬', tomato: '🍅', cheese: '🧀', onion: '🧅', pickles: '🥒', bacon: '🥓', jalapeno: '🌶️', mushroom: '🍄', egg: '🍳', avocado: '🥑' };

const INK = '#2b1d14';
const svg = (w, h, body, cls = '') => {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="${cls}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  return t.content.firstChild;
};

// Stripes for an awning between x0..x1, top y, height h.
function awning(x0, x1, y, h, a = '#e63946', b = '#fff') {
  const n = Math.max(4, Math.round((x1 - x0) / 22));
  const w = (x1 - x0) / n;
  let s = '';
  for (let i = 0; i < n; i++) {
    s += `<path d="M${x0 + i * w} ${y}h${w}v${h}q${-w / 2} 10 ${-w} 0z" fill="${i % 2 ? b : a}"/>`;
  }
  return s;
}
const win = (x, y, w, h, inner = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#bfe8ff"/>${inner}<path d="M${x + 8} ${y + h - 10}l${w * 0.35} ${-(h - 20)}" stroke="#fff" stroke-width="4" opacity=".7"/>`;
const flames = (x, y, n) => Array.from({ length: n }, (_, i) => `<path d="M${x + i * 16} ${y}q-6-10 0-18q2 8 6 4q4 8-6 14z" fill="#ff8c1a" stroke-width="2"/>`).join('');
const stools = (x, y, n) => Array.from({ length: n }, (_, i) => `<g stroke-width="2.5"><line x1="${x + i * 20}" y1="${y}" x2="${x + i * 20}" y2="${y + 16}"/><ellipse cx="${x + i * 20}" cy="${y}" rx="7" ry="3.5" fill="#e63946"/></g>`).join('');
const booth = (x, y) => `<rect x="${x}" y="${y}" width="26" height="16" rx="5" fill="#c0392b" stroke-width="2.5"/><rect x="${x + 5}" y="${y + 6}" width="16" height="6" rx="2" fill="#8b5a2b" stroke-width="2"/>`;
const sign = (x, y, w, h, fill = '#ffd23f', color = INK) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>
  <text class="dn-sign-text" x="${x + w / 2}" y="${y + h / 2 + 1}" text-anchor="middle" dominant-baseline="middle" stroke="none" fill="${color}" font-size="${Math.round(h * 0.55)}" font-weight="700"></text>`;
const burgerIcon = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-22 -2q0-20 22-20t22 20z" fill="#f4a63a"/><rect x="-24" y="-2" width="48" height="6" rx="3" fill="#6ab04c"/><rect x="-23" y="4" width="46" height="8" rx="4" fill="#7a4a2a"/><path d="M-22 12h44q0 10-22 10t-22-10z" fill="#f4a63a"/></g>`;
const billboard = (x, y) => `<line x1="${x + 30}" y1="${y + 40}" x2="${x + 30}" y2="190" stroke-width="5"/><rect x="${x}" y="${y}" width="60" height="42" rx="4" fill="#fff8e1"/>
  ${burgerIcon(x + 30, y + 20, 0.6)}<text x="${x + 30}" y="${y + 39}" text-anchor="middle" font-size="8" stroke="none" fill="#e63946" font-weight="700">EAT HERE!</text>`;

const sky = (w) => `<rect x="-5" y="-5" width="${w + 10}" height="200" fill="#8fd3ff" stroke="none"/><circle cx="${w - 40}" cy="34" r="18" fill="#ffe066" stroke="none"/>
  <g fill="#fff" stroke="none" opacity=".95"><ellipse cx="60" cy="36" rx="26" ry="10"/><ellipse cx="78" cy="30" rx="16" ry="10"/><ellipse cx="${w / 2 + 40}" cy="22" rx="22" ry="8"/></g>
  <rect x="-5" y="188" width="${w + 10}" height="40" fill="#7bc96f" stroke="none"/><rect x="-5" y="196" width="${w + 10}" height="30" fill="#9a9a9a" stroke="none"/>
  <g stroke="#fff" stroke-width="3" stroke-dasharray="14 12"><line x1="0" y1="211" x2="${w}" y2="211"/></g>`;

function truck(L) {
  return `${sky(400)}
  <rect x="110" y="70" width="190" height="105" rx="14" fill="#fff4d6"/>
  <path d="M300 95h40q14 0 18 18l6 40v22h-64z" fill="#fff4d6"/>${win(312, 103, 34, 32)}
  <rect x="130" y="88" width="120" height="50" rx="6" fill="#5a3b2a"/>${flames(150, 132, 1 + (L.grill || 0))}
  ${awning(124, 256, 78, 16)}
  <rect x="124" y="138" width="132" height="10" rx="3" fill="#c0c0c0"/>
  ${sign(140, 46, 130, 24)}
  <rect x="110" y="152" width="254" height="10" fill="#e63946"/>
  <circle cx="160" cy="180" r="18" fill="#444"/><circle cx="160" cy="180" r="7" fill="#ccc"/>
  <circle cx="320" cy="180" r="18" fill="#444"/><circle cx="320" cy="180" r="7" fill="#ccc"/>
  ${stools(70, 170, 1 + (L.seats || 0))}`;
}

function diner(L) {
  return `${sky(400)}
  <rect x="60" y="70" width="280" height="122" rx="10" fill="#eef4f7"/>
  <rect x="60" y="150" width="280" height="14" fill="#2bb5a3"/>
  ${win(78, 98, 70, 46, (L.booths ? booth(90, 124) : '') + flames(92, 116, 1 + (L.grill || 0)))}
  ${win(252, 98, 70, 46, (L.booths ? booth(272, 124) : '') + stools(266, 122, Math.min(3, 1 + (L.seats || 0))))}
  <rect x="172" y="104" width="56" height="88" rx="4" fill="#e63946"/><rect x="182" y="114" width="36" height="34" rx="4" fill="#bfe8ff"/><circle cx="218" cy="160" r="3" fill="${INK}"/>
  ${awning(64, 336, 84, 14)}
  ${sign(110, 36, 180, 30)}
  ${L.bell ? '<path d="M200 98q-8 0-8-8q0-8 8-8t8 8q0 8-8 8z" fill="#ffd23f" stroke-width="2"/>' : ''}`;
}

function restaurantArt(L) {
  return `${sky(400)}
  <rect x="50" y="56" width="300" height="136" fill="#c8553d"/>
  <g stroke="#a8432f" stroke-width="2" opacity=".6">${Array.from({ length: 6 }, (_, i) => `<line x1="50" y1="${72 + i * 20}" x2="350" y2="${72 + i * 20}"/>`).join('')}</g>
  <rect x="40" y="48" width="320" height="14" rx="4" fill="#5a3b2a"/>
  ${win(66, 74, 60, 40)}${win(274, 74, 60, 40)}
  ${win(66, 130, 74, 50, L.booths ? booth(76, 158) + booth(106, 158) : '')}${win(260, 130, 74, 50, flames(272, 166, 1 + (L.grill || 0)))}
  <rect x="166" y="112" width="68" height="80" rx="34" fill="#5a3b2a"/><rect x="176" y="122" width="48" height="70" rx="24" fill="#8b5a2b"/>
  <path d="M150 112h100l12 14h-124z" fill="#2c3e50"/>
  ${sign(120, 14, 160, 30, '#2c3e50', '#ffd23f')}`;
}

function franchise(L) {
  return `${sky(400)}
  ${burgerIcon(200, 40, 1.3)}
  <rect x="198" y="64" width="4" height="12" fill="${INK}"/>
  <rect x="30" y="76" width="340" height="116" rx="8" fill="#ffd23f"/>
  <rect x="30" y="76" width="340" height="22" fill="#e63946"/>
  ${[50, 120, 260, 320].map((x, i) => win(x, 110, 50, 44, i === 1 && L.booths ? booth(x + 12, 134) : i === 2 ? flames(x + 10, 146, Math.min(3, 1 + (L.grill || 0))) : '')).join('')}
  <rect x="180" y="118" width="40" height="74" rx="4" fill="#bfe8ff"/><line x1="200" y1="118" x2="200" y2="192"/>
  ${sign(110, 79, 180, 18, '#fff', '#e63946')}
  <text x="200" y="176" text-anchor="middle" stroke="none" fill="${INK}" font-size="9" font-weight="700" opacity=".7">OPEN 24/7</text>`;
}

const SCENES = [truck, diner, restaurantArt, franchise];

// The restaurant's front, drawn for its tier, with owned upgrades (billboard, booths, grills, seats) in it.
export function storefront(tier, levels, name) {
  const L = levels || {};
  const el = svg(400, 226, SCENES[Math.min(tier, SCENES.length - 1)](L) + (L.billboard ? billboard(345, 104) : ''), 'dn-scene');
  el.querySelector('.dn-sign-text').textContent = name;
  return el;
}

// A small one for the tier ladder.
export function tierThumb(tier, name) {
  const el = svg(400, 226, SCENES[tier]({}), 'dn-thumb');
  el.querySelector('.dn-sign-text').textContent = name;
  return el;
}

const SKIN = ['#ffd6b0', '#f1c27d', '#c68642', '#8d5524', '#ffdbac', '#e0ac69'];
const HAIR = ['#2b1d14', '#a0522d', '#f4d03f', '#d35400', '#7f8c8d', '#222', '#e84393'];
const SHIRT = ['#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#e74c3c', '#f1c40f'];

const MOUTH = { happy: 'M38 54q12 14 24 0', meh: 'M40 58h20', mad: 'M40 60q10-8 20 0' };
// Changes a drawn face's mood in place (the patience timer does this every frame).
export function setMood(el, mood) {
  el.querySelector('.dn-mouth').setAttribute('d', MOUTH[mood]);
  el.querySelector('.dn-brows').setAttribute('opacity', mood === 'mad' ? 1 : 0);
}

// A customer: id picks skin/hair/shirt, mood is 'happy' | 'meh' | 'mad' (and 'vip' adds sunglasses).
export function face(id, mood, extra = '') {
  const skin = SKIN[id % SKIN.length];
  const hair = HAIR[(id * 3) % HAIR.length];
  const shirt = SHIRT[(id * 5) % SHIRT.length];
  const style = id % 3;
  const hairD = style === 0 ? 'M22 34q0-22 28-22t28 22q-8-10-28-10t-28 10z' : style === 1 ? 'M20 40q-2-30 30-30t30 30q-4-6-8-14q-12 6-44 4q-4 6-8 10z' : 'M24 30q4-18 26-18t26 18l-4 4q-6-10-22-10t-22 10z';
  return svg(100, 100, `
    <path d="M18 100q0-22 32-22t32 22z" fill="${shirt}"/>
    <circle cx="50" cy="44" r="28" fill="${skin}"/>
    <path d="${hairD}" fill="${hair}"/>
    <path class="dn-brows" d="M34 34l10 4M66 34l-10 4" stroke-width="3" opacity="${mood === 'mad' ? 1 : 0}"/><circle cx="40" cy="44" r="3.5" fill="${INK}" stroke="none"/><circle cx="60" cy="44" r="3.5" fill="${INK}" stroke="none"/>
    <circle cx="33" cy="54" r="4" fill="#ff8a8a" stroke="none" opacity=".5"/><circle cx="67" cy="54" r="4" fill="#ff8a8a" stroke="none" opacity=".5"/>
    <path class="dn-mouth" d="${MOUTH[mood]}" fill="none"/>${extra}`, 'dn-facesvg');
}
