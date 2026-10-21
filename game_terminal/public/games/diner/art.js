// Flat SVG for the restaurant: the storefront per tier at dusk (with owned upgrades drawn in) and the
// customers. Everything here is static markup; user text (the restaurant name) is set by the caller
// with textContent on .dn-sign-text, never interpolated.

// 24x24 ingredient and side icons: flat muted fills with a thin dark outline.
const ICONS = {
  lettuce: '<path d="M3 14q2-7 5-5q2-5 4-1q3-4 5 0q4-2 4 5q-2 4-9 4t-9-3z" fill="#8fae6a"/><path d="M8 15q4-3 8 0" fill="none"/>',
  tomato: '<circle cx="12" cy="12" r="8" fill="#c8553d"/><circle cx="12" cy="12" r="4" fill="#e08a72"/>',
  cheese: '<path d="M3 17l16-10l2 10z" fill="#e2b04a"/><circle cx="11" cy="14" r="1.3" fill="#b8892c" stroke="none"/><circle cx="16" cy="12" r="1" fill="#b8892c" stroke="none"/>',
  onion: '<circle cx="12" cy="12" r="8" fill="#e6dbe2"/><circle cx="12" cy="12" r="5" fill="#c9b2c4"/><circle cx="12" cy="12" r="2" fill="#e6dbe2"/>',
  pickles: '<ellipse cx="8" cy="12" rx="5" ry="6" fill="#8a9a4a"/><ellipse cx="16" cy="12" rx="5" ry="6" fill="#8a9a4a"/><circle cx="16" cy="12" r="1" fill="#5a6a2e" stroke="none"/>',
  bacon: '<path d="M3 9q3-3 6 0t6 0t6 0v5q-3 3-6 0t-6 0t-6 0z" fill="#a8483a"/><path d="M3 11.5q3-2 6 0t6 0t6 0" stroke="#e8b8a4" fill="none"/>',
  jalapeno: '<path d="M6 7q-2 8 5 12q6 2 8 0q-8-2-10-12z" fill="#4f7a3a"/><path d="M6 7q0-3 3-4" fill="none"/>',
  mushroom: '<path d="M3 13q0-8 9-8t9 8z" fill="#9c8573"/><path d="M9 13v6h6v-6" fill="#e8e0d4"/>',
  egg: '<path d="M4 12q0-7 7-7q4-2 7 2q4 5-1 10q-6 4-11 0q-2-2-2-5z" fill="#f2ead8"/><circle cx="12" cy="12" r="3.5" fill="#e0a23a"/>',
  avocado: '<path d="M12 3q-7 8-7 12a7 6 0 0 0 14 0q0-4-7-12z" fill="#5f7f3a"/><path d="M12 7q-4 5-4 8a4 4 0 0 0 8 0q0-3-4-8z" fill="#cdd58a" stroke="none"/><circle cx="12" cy="15" r="2.6" fill="#7a5a44"/>',
  fryer: '<path d="M7 9l2-6M10 9l1-7M13 9l1-6M16 9l1-5" stroke="#d9a446" stroke-width="2.2"/><path d="M5 9h14l-2 12h-10z" fill="#a8483a"/>',
  fountain: '<path d="M14 6l3-4" fill="none"/><path d="M6 7h12l-2 14h-8z" fill="#4f6f8a"/><path d="M6.6 11h10.8" fill="none"/>',
  shake: '<path d="M7 9q0-5 5-5t5 5z" fill="#efe6d6"/><circle cx="12" cy="3.5" r="1.4" fill="#a8483a" stroke-width="1"/><path d="M6 9h12l-3 12h-6z" fill="#d9b0a8"/>',
};
export const icon = (id) => svg(24, 24, `<g stroke="#1c1814" stroke-width="1.1">${ICONS[id]}</g>`, 'dn-ico');

const BRASS = '#c9a45c';
const svg = (w, h, body, cls = '') => {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="${cls}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" stroke="none" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  return t.content.firstChild;
};

// Lit window: warm glass, a mullion, and whatever is inside drawn over it.
const win = (x, y, w, h, inner = '', r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#d9a95a"/><rect x="${x}" y="${y}" width="${w}" height="${h * 0.45}" rx="${r}" fill="#e6bd74"/>${inner}
  <rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" rx="${r + 1}" fill="none" stroke="#1a1714" stroke-width="3"/>`;
// Grill glow seen through a window: one ember per grill.
const flames = (x, y, n) => Array.from({ length: n }, (_, i) => `<ellipse cx="${x + i * 14}" cy="${y}" rx="5" ry="3" fill="#b8492c"/><ellipse cx="${x + i * 14}" cy="${y - 1}" rx="2.5" ry="1.5" fill="#f0a050"/>`).join('');
const stools = (x, y, n) => Array.from({ length: n }, (_, i) => `<rect x="${x + i * 18 - 1}" y="${y}" width="2" height="14" fill="#1a1714"/><rect x="${x + i * 18 - 6}" y="${y - 2}" width="12" height="4" rx="2" fill="#6b2f2a"/>`).join('');
const booth = (x, y) => `<rect x="${x}" y="${y}" width="24" height="14" rx="2" fill="#5a2a26"/><rect x="${x + 5}" y="${y + 5}" width="14" height="4" fill="#3a2a20"/>`;
// Name plate: dark panel, brass serif lettering.
const sign = (x, y, w, h, fill = '#1a1714') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${BRASS}" stroke-width="1"/>
  <text class="dn-sign-text" x="${x + w / 2}" y="${y + h / 2 + 1}" text-anchor="middle" dominant-baseline="middle" fill="${BRASS}" font-family="Georgia, serif" letter-spacing="1" font-size="${Math.round(h * 0.5)}"></text>`;
const awning = (x0, x1, y, h, a = '#6b2f2a', b = '#d8cfbf') => {
  const n = Math.max(4, Math.round((x1 - x0) / 18));
  const w = (x1 - x0) / n;
  return Array.from({ length: n }, (_, i) => `<path d="M${x0 + i * w} ${y}h${w}v${h}h${-w}z" fill="${i % 2 ? b : a}"/>`).join('') + `<rect x="${x0}" y="${y + h}" width="${x1 - x0}" height="3" fill="#1a1714" opacity=".5"/>`;
};
const billboard = (x, y) => `<rect x="${x + 28}" y="${y + 40}" width="4" height="${190 - y - 40}" fill="#1a1714"/><rect x="${x}" y="${y}" width="60" height="42" fill="#e8dfcf" stroke="#1a1714" stroke-width="3"/>
  <text x="${x + 30}" y="${y + 18}" text-anchor="middle" font-size="9" fill="#1a1714" font-family="Georgia, serif">Burgers</text><text x="${x + 30}" y="${y + 31}" text-anchor="middle" font-size="7" fill="#6b2f2a" letter-spacing="1">NEXT EXIT</text>`;

// Dusk street: sky, a far skyline, the pavement and the road.
const street = (w) => `<rect x="-5" y="-5" width="${w + 10}" height="200" fill="#232a38"/><rect x="-5" y="80" width="${w + 10}" height="120" fill="#2b2f3c"/>
  <g fill="#1f2430">${[[0, 40, 50], [42, 70, 30], [96, 30, 60], [330, 50, 40], [372, 26, 70]].map(([x, wd, hgt]) => `<rect x="${x}" y="${200 - hgt - 70}" width="${wd}" height="${hgt + 70}"/>`).join('')}</g>
  <rect x="-5" y="188" width="${w + 10}" height="10" fill="#3a3530"/><rect x="-5" y="198" width="${w + 10}" height="30" fill="#1c1a18"/>
  <g stroke="#4a453e" stroke-width="2" stroke-dasharray="16 14"><line x1="0" y1="212" x2="${w}" y2="212"/></g>`;

function truck(L) {
  return `${street(400)}
  <rect x="110" y="72" width="190" height="104" rx="6" fill="#d8d2c4"/>
  <path d="M300 96h38q12 0 16 14l8 40v26h-62z" fill="#cfc8b8"/>${win(312, 104, 32, 28)}
  ${win(130, 92, 120, 44, flames(150, 128, 1 + (L.grill || 0)))}
  ${awning(124, 256, 80, 10)}
  <rect x="124" y="138" width="132" height="6" fill="#8e877a"/>
  ${sign(140, 50, 130, 22)}
  <rect x="110" y="156" width="252" height="6" fill="#6b2f2a"/>
  <circle cx="160" cy="180" r="16" fill="#151311"/><circle cx="160" cy="180" r="6" fill="#5a544c"/>
  <circle cx="318" cy="180" r="16" fill="#151311"/><circle cx="318" cy="180" r="6" fill="#5a544c"/>
  ${stools(70, 174, 1 + (L.seats || 0))}`;
}

function diner(L) {
  return `${street(400)}
  <rect x="60" y="72" width="280" height="118" rx="4" fill="#9aa1a4"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="60" y="${80 + i * 6}" width="280" height="2" fill="#b4babd"/>`).join('')}
  <rect x="60" y="152" width="280" height="10" fill="#33504d"/>
  ${win(78, 100, 70, 44, (L.booths ? booth(90, 126) : '') + flames(96, 120, 1 + (L.grill || 0)))}
  ${win(252, 100, 70, 44, (L.booths ? booth(272, 126) : '') + stools(266, 126, Math.min(3, 1 + (L.seats || 0))))}
  ${win(174, 108, 52, 82, '', 1)}<rect x="199" y="108" width="2" height="82" fill="#1a1714"/>
  ${awning(66, 334, 88, 8, '#33504d', '#b4babd')}
  ${sign(110, 40, 180, 28)}
  ${L.bell ? `<circle cx="232" cy="120" r="4" fill="${BRASS}"/>` : ''}`;
}

function restaurantArt(L) {
  return `${street(400)}
  <rect x="50" y="56" width="300" height="134" fill="#5e3328"/>
  <g fill="#4e2a21">${Array.from({ length: 6 }, (_, i) => `<rect x="50" y="${70 + i * 20}" width="300" height="2"/>`).join('')}</g>
  <rect x="44" y="50" width="312" height="10" fill="#1f1a17"/>
  ${win(68, 76, 56, 38)}${win(276, 76, 56, 38)}
  ${win(66, 132, 74, 48, L.booths ? booth(76, 160) + booth(106, 160) : '')}${win(260, 132, 74, 48, flames(274, 166, 1 + (L.grill || 0)))}
  <path d="M168 190v-50a32 32 0 0 1 64 0v50z" fill="#1f1a17"/><path d="M176 190v-48a24 24 0 0 1 48 0v48z" fill="#d9a95a"/><rect x="199" y="118" width="2" height="72" fill="#1f1a17"/>
  ${awning(150, 250, 112, 8, '#2f4a3a', '#2f4a3a')}
  ${sign(120, 18, 160, 28)}`;
}

function franchise(L) {
  return `${street(400)}
  <rect x="30" y="70" width="340" height="120" fill="#2b2f36"/>
  <rect x="30" y="70" width="340" height="24" fill="#1a1714"/>
  ${[44, 118, 262, 316].map((x, i) => win(x, 108, i === 3 ? 40 : 64, 56, i === 1 && L.booths ? booth(x + 18, 138) : i === 2 ? flames(x + 14, 152, Math.min(3, 1 + (L.grill || 0))) : '', 0)).join('')}
  ${win(194, 112, 50, 78, '', 0)}<rect x="218" y="112" width="2" height="78" fill="#2b2f36"/>
  ${sign(110, 73, 180, 18, '#1a1714')}
  <rect x="12" y="52" width="4" height="138" fill="#1a1714"/><circle cx="14" cy="44" r="11" fill="#1a1714" stroke="${BRASS}" stroke-width="2"/>
  <text x="200" y="104" text-anchor="middle" fill="${BRASS}" font-size="7" letter-spacing="2" opacity=".8">OPEN LATE</text>`;
}

const SCENES = [truck, diner, restaurantArt, franchise];

// The restaurant's front, drawn for its tier, with owned upgrades (billboard, booths, grills, seats) in it.
export function storefront(tier, levels, name) {
  const L = levels || {};
  const el = svg(400, 226, SCENES[Math.min(tier, SCENES.length - 1)](L) + (L.billboard ? billboard(336, 104) : ''), 'dn-scene');
  el.querySelector('.dn-sign-text').textContent = name;
  return el;
}

// A small one for the tier ladder.
export function tierThumb(tier, name) {
  const el = svg(400, 226, SCENES[tier]({}), 'dn-thumb');
  el.querySelector('.dn-sign-text').textContent = name;
  return el;
}

const SKIN = ['#f0c8a4', '#d9a679', '#b07a52', '#7a5038', '#e8bd94', '#c58f62'];
const HAIR = ['#2a211c', '#5b3a26', '#9a7a4a', '#3b3b3b', '#7a6a5a', '#1c1c1c', '#6b2f2a'];
const SHIRT = ['#3f5a6b', '#6b4a3a', '#4a5a45', '#5a4a6b', '#7a3a32', '#8a7a5a'];

const MOUTH = { happy: 'M43 58q7 4 14 0', meh: 'M43 58h14', mad: 'M43 60q7-4 14 0' };
// Special customers' accessories, drawn over face().
export const HAT = {
  critic: '<path d="M22 30h56v3h-56z" fill="#1c1c20"/><path d="M32 30q2-16 18-16t18 16z" fill="#1c1c20"/><rect x="32" y="26" width="36" height="3" fill="#c9a45c"/>',
  celebrity: '<path d="M30 42h17v6q0 5-8 5t-9-6zM53 42h17v5q-1 6-9 6t-8-5z" fill="#141414"/><path d="M47 44h6" stroke="#141414" stroke-width="2"/>',
  kid: '<path d="M26 32q2-18 24-18t24 18z" fill="#6b2f2a"/><path d="M26 32h34v4h-34z" fill="#5a2622"/>',
};

// Changes a drawn face's mood in place (the patience timer does this every frame).
export function setMood(el, mood) {
  el.querySelector('.dn-mouth').setAttribute('d', MOUTH[mood]);
}

// A customer: id picks skin/hair/shirt, mood is 'happy' | 'meh' | 'mad'.
export function face(id, mood, extra = '') {
  const skin = SKIN[id % SKIN.length];
  const hair = HAIR[(id * 3) % HAIR.length];
  const shirt = SHIRT[(id * 5) % SHIRT.length];
  const style = id % 3;
  const hairD = style === 0 ? 'M24 40q0-26 26-26t26 26q-6-14-26-14t-26 14z' : style === 1 ? 'M22 46q-2-32 28-32t28 32q-4-8-6-16q-14 6-44 2q-2 6-6 14z' : 'M26 36q4-20 24-20t24 20l-3 3q-6-12-21-12t-21 12z';
  return svg(100, 100, `
    <path d="M16 100q0-24 34-24t34 24z" fill="${shirt}"/><rect x="44" y="64" width="12" height="14" fill="${skin}"/>
    <circle cx="50" cy="44" r="24" fill="${skin}"/>
    <path d="${hairD}" fill="${hair}"/>
    <circle cx="41" cy="46" r="2" fill="#1c1814"/><circle cx="59" cy="46" r="2" fill="#1c1814"/>
    <path class="dn-mouth" d="${MOUTH[mood]}" fill="none" stroke="#1c1814" stroke-width="2"/>${extra}`, 'dn-facesvg');
}
