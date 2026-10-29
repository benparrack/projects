// Hand-rolled SVG diagrams: flow charts, sequence diagrams, the architecture map,
// the import graph (force layout) and the size treemap. No libraries, so they share the page's type and ink.
import { esc } from './md.js';

const MAXW = 860;
const textW = (s, px = 13) => String(s).length * px * 0.56;
const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

function arrowDef(id) {
  return `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-arrow" d="M0,1 L10,5 L0,9 z"/></marker></defs>`;
}

function wrap(s, max) {
  const words = String(s).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- flow: layered layout ----------

export function flow(d) {
  const nodes = d.nodes.map(n => ({ ...n }));
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const edges = d.edges.filter(e => byId[e.from] && byId[e.to]);
  // break cycles: edges that point back along a DFS are ignored for ranking
  const out = Object.fromEntries(nodes.map(n => [n.id, []]));
  edges.forEach(e => out[e.from].push(e));
  const state = {}, back = new Set();
  const dfs = id => {
    state[id] = 1;
    for (const e of out[id]) {
      if (state[e.to] === 1) back.add(e);
      else if (!state[e.to]) dfs(e.to);
    }
    state[id] = 2;
  };
  const indeg = Object.fromEntries(nodes.map(n => [n.id, 0]));
  edges.forEach(e => indeg[e.to]++);
  nodes.filter(n => !indeg[n.id]).forEach(n => !state[n.id] && dfs(n.id));
  nodes.forEach(n => !state[n.id] && dfs(n.id));
  const fwd = edges.filter(e => !back.has(e) && e.from !== e.to);
  nodes.forEach(n => (n.rank = 0));
  for (let k = 0; k < nodes.length; k++) {
    let changed = false;
    for (const e of fwd) if (byId[e.to].rank < byId[e.from].rank + 1) { byId[e.to].rank = byId[e.from].rank + 1; changed = true; }
    if (!changed) break;
  }
  // edges that skip ranks get a dummy waypoint in every rank they cross, so ordering keeps a lane
  // free for them and they never run behind a box
  const all = [...nodes], segs = [], chains = new Map();
  for (const e of fwd) {
    let prev = byId[e.from];
    const ch = [];
    for (let r = prev.rank + 1; r < byId[e.to].rank; r++) {
      const dm = { id: `\u0000${all.length}`, rank: r, dummy: true, label: '' };
      all.push(dm); byId[dm.id] = dm; ch.push(dm); segs.push([prev, dm]); prev = dm;
    }
    segs.push([prev, byId[e.to]]);
    chains.set(e, ch);
  }
  const ranks = [];
  all.forEach((n, i) => { n.order = i; (ranks[n.rank] ||= []).push(n); });
  for (let pass = 0; pass < 4; pass++) {
    for (const r of ranks) {
      if (!r) continue;
      for (const n of r) {
        const nb = segs.filter(([u, v]) => u === n || v === n).map(([u, v]) => (u === n ? v : u).order);
        n.bary = nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : n.order;
      }
      r.sort((a, b) => a.bary - b.bary).forEach((n, i) => (n.order = i));
    }
  }
  nodes.forEach(n => {
    n.w = Math.min(210, Math.max(96, Math.max(textW(n.label, 13), textW(n.note || '', 10.5)) + 28));
    n.h = n.note ? 50 : 36;
  });
  const R = ranks.filter(Boolean);
  const colW = Math.max(...nodes.map(n => n.w));
  const lr = R.length * colW + (R.length - 1) * 64 <= MAXW && Math.max(...R.map(r => r.length)) <= 5;
  all.forEach(n => { if (n.dummy) { n.w = lr ? colW : 14; n.h = lr ? 14 : 0; } });
  let W, H;
  if (lr) {
    const gap = Math.min(110, (MAXW - R.length * colW) / Math.max(1, R.length - 1));
    const colH = R.map(r => r.reduce((a, n) => a + n.h, 0) + (r.length - 1) * 26);
    H = Math.max(...colH) + 40;
    R.forEach((r, ri) => {
      let y = (H - colH[ri]) / 2;
      r.forEach(n => { n.x = 10 + ri * (colW + gap) + (colW - n.w) / 2; n.y = y; y += n.h + 26; });
    });
    W = 20 + R.length * colW + (R.length - 1) * gap;
  } else {
    const rowW = R.map(r => r.reduce((a, n) => a + n.w, 0) + (r.length - 1) * 28);
    W = Math.max(...rowW) + 20;
    let y = 10;
    R.forEach((r, ri) => {
      let x = (W - rowW[ri]) / 2;
      const rh = Math.max(...r.map(n => n.h));
      r.forEach(n => { if (n.dummy) n.h = rh; n.x = x; n.y = y + (rh - n.h) / 2; x += n.w + 28; });
      y += rh + 62;
    });
    H = y - 52;
  }
  // straighten each skip-rank lane: slide its dummies in line with the first one where the row has room
  const ax = lr ? 'y' : 'x', sz = lr ? 'h' : 'w';
  for (const ch of chains.values()) for (const m of ch.slice(1)) {
    const row = ranks[m.rank], i = row.indexOf(m), want = ch[0][ax];
    const lo = i > 0 ? row[i - 1][ax] + row[i - 1][sz] + 10 : -Infinity, hi = i < row.length - 1 ? row[i + 1][ax] - m[sz] - 10 : Infinity;
    m[ax] = Math.max(lo, Math.min(hi, want));
  }
  all.forEach(n => { n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; });
  const mk = `ar${++uid}`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(d.title)}">${arrowDef(mk)}`;
  const labels = [];
  const mid3 = (p, c, q) => 0.25 * p + 0.75 * c; // where a symmetric cubic bulge peaks, near enough for a label
  for (const e of edges) {
    const a = byId[e.from], b = byId[e.to];
    let p, mx, my;
    if (e.from === e.to) {
      const x = a.x + a.w, y = a.cy;
      p = `M${x},${y - 8} C${x + 40},${y - 30} ${x + 40},${y + 30} ${x},${y + 8}`; mx = x + 34; my = y;
    } else if (b.rank > a.rank) {
      // forward: smooth curve through each dummy, straight across the dummy's own rank
      const ch = chains.get(e) || [];
      const pts = lr
        ? [[a.x + a.w, a.cy], ...ch.flatMap(m => [[m.x, m.cy], [m.x + m.w, m.cy]]), [b.x, b.cy]]
        : [[a.cx, a.y + a.h], ...ch.flatMap(m => [[m.cx, m.y], [m.cx, m.y + m.h]]), [b.cx, b.y]];
      p = `M${pts[0]}`;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        p += lr ? ` C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}` : ` C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`;
        if (i + 2 < pts.length) p += ` L${pts[i + 2]}`;
      }
      mx = (pts[0][0] + pts[1][0]) / 2; my = (pts[0][1] + pts[1][1]) / 2;
    } else if (lr && a.rank === b.rank) {
      const down = b.y > a.y, y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h;
      p = `M${a.cx},${y1} L${b.cx},${y2}`; mx = a.cx + 10; my = (y1 + y2) / 2;
    } else if (lr) {
      // back edge: arc over the top
      const top = Math.min(a.y, b.y) - 30;
      p = `M${a.cx},${a.y} C${a.cx},${top} ${b.cx},${top} ${b.cx},${b.y}`;
      mx = (a.cx + b.cx) / 2; my = mid3(Math.min(a.y, b.y), top);
    } else {
      // back edge or same row: loop out to the right
      const x1 = a.x + a.w, x2 = b.x + b.w, out = Math.max(x1, x2) + 46;
      p = `M${x1},${a.cy} C${out},${a.cy} ${out},${b.cy} ${x2},${b.cy}`;
      mx = mid3(Math.max(x1, x2), out); my = (a.cy + b.cy) / 2;
    }
    svg += `<path class="dg-edge" d="${p}" marker-end="url(#${mk})"/>`;
    if (e.label) labels.push({ mx, my, t: e.label });
  }
  for (const l of labels) {
    const w = textW(l.t, 11) + 8;
    svg += `<rect class="dg-elabel-bg" x="${l.mx - w / 2}" y="${l.my - 9}" width="${w}" height="16" rx="2"/><text class="dg-elabel" x="${l.mx}" y="${l.my + 3}" text-anchor="middle">${esc(l.t)}</text>`;
  }
  for (const n of nodes) {
    const root = !edges.some(e => e.to === n.id && e.from !== n.id);
    svg += `<g class="dg-node${root ? ' root' : ''}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="3"/>` +
      `<text class="t" x="${n.x + n.w / 2}" y="${n.y + (n.note ? 21 : n.h / 2 + 4.5)}" text-anchor="middle">${esc(n.label)}</text>` +
      (n.note ? `<text class="s" x="${n.x + n.w / 2}" y="${n.y + 37}" text-anchor="middle">${esc(n.note.length > 30 ? n.note.slice(0, 29) + '…' : n.note)}</text>` : '') + '</g>';
  }
  // pad for back-edge loops that bulge outside
  const pad = 50;
  return svg.replace(`viewBox="0 0 ${W} ${H}" width="${W}"`, `viewBox="-6 ${-pad / 2} ${W + pad + 12} ${H + pad}" width="${W + pad + 12}"`) + '</svg>';
}

// ---------- sequence ----------

export function sequence(d) {
  const ps = d.nodes;
  const col = Math.max(110, Math.min(170, (MAXW - 20) / ps.length));
  const idx = Object.fromEntries(ps.map((p, i) => [p.id, i]));
  const cx = i => 10 + col * i + col / 2;
  const head = 50, step = 46;
  const msgs = d.edges.filter(e => e.from in idx && e.to in idx);
  const H = head + 30 + msgs.length * step + 30;
  const W = col * ps.length + 20 + 40;
  const mk = `ar${++uid}`;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(d.title)}">${arrowDef(mk)}`;
  ps.forEach((p, i) => {
    const w = Math.min(col - 12, Math.max(80, textW(p.label, 12.5) + 20));
    svg += `<line class="dg-life" x1="${cx(i)}" y1="${head}" x2="${cx(i)}" y2="${H - 14}"/>`;
    svg += `<g class="dg-node root"><rect x="${cx(i) - w / 2}" y="6" width="${w}" height="${p.note ? 44 : 34}" rx="3"/>` +
      `<text class="t" x="${cx(i)}" y="${p.note ? 25 : 27}" text-anchor="middle">${esc(p.label)}</text>` +
      (p.note ? `<text class="s" x="${cx(i)}" y="40" text-anchor="middle">${esc(p.note.slice(0, 22))}</text>` : '') + '</g>';
  });
  msgs.forEach((m, k) => {
    const y = head + 40 + k * step, a = idx[m.from], b = idx[m.to];
    svg += `<text class="dg-step" x="${cx(Math.min(a, b)) - 8}" y="${y - 10}" text-anchor="end">${k + 1}</text>`;
    if (a === b) {
      svg += `<path class="dg-edge" d="M${cx(a)},${y - 6} h34 v16 h-32" marker-end="url(#${mk})"/>`;
      if (m.label) svg += `<text class="dg-elabel" x="${cx(a) + 40}" y="${y + 4}">${esc(m.label)}</text>`;
    } else {
      const x1 = cx(a) + (b > a ? 3 : -3), x2 = cx(b) + (b > a ? -3 : 3);
      svg += `<line class="dg-edge" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" marker-end="url(#${mk})"${b < a ? ' stroke-dasharray="5 4"' : ''}/>`;
      const maxc = Math.floor(Math.abs(cx(b) - cx(a)) / 6);
      const t = m.label && m.label.length > maxc ? m.label.slice(0, maxc - 1) + '…' : m.label;
      if (t) svg += `<text class="dg-elabel" x="${(cx(a) + cx(b)) / 2}" y="${y - 7}" text-anchor="middle"><title>${esc(m.label)}</title>${esc(t)}</text>`;
    }
  });
  return svg + '</svg>';
}

export const diagram = d => (d.kind === 'sequence' ? sequence(d) : flow(d));

// ---------- architecture: components in layers ----------

export function architecture(components, edges, info) {
  const layers = [...new Set(components.map(c => c.layer))].sort((a, b) => a - b);
  const rowH = 96, gapY = 64, top = 8, left = 90;
  const usable = MAXW + 100 - left;
  const pos = {};
  // order each row by where its neighbours sit in the rows above, so edges run straight where they can
  const rows = layers.map(L => components.filter(c => c.layer === L));
  const nb = id => edges.flatMap(e => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  for (let pass = 0; pass < 2; pass++) for (let li = 1; li < rows.length; li++) {
    const idx = new Map(rows.slice(0, li).flatMap(r => r.map((c, i) => [c.id, (i + 0.5) / r.length])));
    const bc = c => { const v = nb(c.id).filter(id => idx.has(id)).map(id => idx.get(id)); return v.length ? v.reduce((a, b) => a + b) / v.length : null; };
    const keyed = rows[li].map((c, i) => [bc(c) ?? (i + 0.5) / rows[li].length, c]);
    rows[li] = keyed.sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  layers.forEach((L, li) => {
    const row = rows[li];
    const w = Math.min(230, (usable - (row.length - 1) * 22) / row.length);
    const total = row.length * w + (row.length - 1) * 22;
    row.forEach((c, i) => (pos[c.id] = { x: left + (usable - total) / 2 + i * (w + 22), y: top + li * (rowH + gapY), w, h: rowH }));
  });
  const W = left + usable + 10, H = top + layers.length * (rowH + gapY) - gapY + 12;
  const mk = `ar${++uid}`;
  let svg = `<svg class="arch" viewBox="0 0 ${W} ${H}" width="${W}">${arrowDef(mk)}`;
  layers.forEach((L, li) => {
    const y = top + li * (rowH + gapY);
    const name = li === 0 ? 'Surface' : li === layers.length - 1 ? 'Foundation' : li === 1 ? 'Core' : '';
    if (name) svg += `<text class="lyr" x="0" y="${y + 14}">${name}</text>`;
    if (li) svg += `<line class="lyr-rule" x1="0" x2="${W}" y1="${y - gapY / 2}" y2="${y - gapY / 2}"/>`;
  });
  const rowOf = id => layers.indexOf(components.find(c => c.id === id).layer);
  const es = edges.filter(e => pos[e.from] && pos[e.to] && e.from !== e.to).map(e => ({ ...e, a: pos[e.from], b: pos[e.to] }));
  // spread each box's endpoints along the side they leave/enter by, ordered by where the other end is
  const ports = new Map();
  const port = (box, side, other, e) => { const k = box.x + side; (ports.get(k) || ports.set(k, []).get(k)).push({ e, other, box }); };
  for (const e of es) {
    if (Math.abs(e.a.y - e.b.y) < 1) continue;
    const down = e.b.y > e.a.y;
    port(e.a, down ? 'b' : 't', e.b.x + e.b.w / 2, [e, 'x1']);
    port(e.b, down ? 't' : 'b', e.a.x + e.a.w / 2, [e, 'x2']);
  }
  for (const list of ports.values()) {
    list.sort((p, q) => p.other - q.other);
    list.forEach((p, i) => (p.e[0][p.e[1]] = p.box.x + p.box.w * ((i + 1) / (list.length + 1))));
  }
  const lbl = [], laneUse = { l: 0, r: 0 }, posts = [];
  for (const e of es) {
    const { a, b } = e;
    let p, mx, my, gap;
    if (Math.abs(a.y - b.y) < 1) {
      const right = b.x > a.x;
      const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x : b.x + b.w, y = a.y + a.h / 2;
      p = `M${x1},${y} L${x2},${y}`; mx = (x1 + x2) / 2; my = y - 12; gap = 'h' + y;
    } else {
      const down = b.y > a.y, x1 = e.x1, x2 = e.x2;
      const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y : b.y + b.h;
      const r1 = rowOf(e.from), r2 = rowOf(e.to), lo = Math.min(r1, r2), hi = Math.max(r1, r2);
      // boxes in rows the edge crosses; if a straight-ish curve would hit one, take a lane down the side
      const mid = Object.entries(pos).filter(([id]) => { const r = rowOf(id); return r > lo && r < hi; }).map(([, q]) => q);
      const hits = mid.some(q => { const t = (q.y + q.h / 2 - y1) / (y2 - y1), x = x1 + (x2 - x1) * t; return x > q.x - 8 && x < q.x + q.w + 8; });
      const sy = down ? 1 : -1, g1 = y1 + sy * gapY / 2, g2 = y2 - sy * gapY / 2;
      if (hits) {
        const minX = Math.min(...mid.map(q => q.x)), maxX = Math.max(...mid.map(q => q.x + q.w));
        const side = (x1 + x2) / 2 - minX < maxX - (x1 + x2) / 2 ? 'l' : 'r';
        const lx = side === 'l' ? minX - 18 - laneUse.l++ * 10 : maxX + 18 + laneUse.r++ * 10;
        const R = 8, dx1 = Math.sign(lx - x1) || 1, dx2 = Math.sign(x2 - lx) || 1;
        p = `M${x1},${y1} L${x1},${g1 - sy * R} Q${x1},${g1} ${x1 + dx1 * R},${g1} L${lx - dx1 * R},${g1} Q${lx},${g1} ${lx},${g1 + sy * R}` +
            ` L${lx},${g2 - sy * R} Q${lx},${g2} ${lx + dx2 * R},${g2} L${x2 - dx2 * R},${g2} Q${x2},${g2} ${x2},${g2 + sy * R} L${x2},${y2}`;
        mx = (x1 + lx) / 2; my = g1;
        for (let r = lo + 1; r < hi - 1; r++) posts.push({ gap: 'g' + Math.round(top + r * (rowH + gapY) + rowH + gapY / 2), mx: lx, w: 8, fixed: true });
      } else {
        const dy = (y2 - y1) / 2;
        p = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
        // label sits in the first gap after the source, where the curve crosses it
        const t = hi - lo === 1 ? 0.5 : 0.5 / (hi - lo);
        const bz = (u, p0, p1, p2, p3) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
        mx = bz(t, x1, x1, x2, x2); my = g1;
        if (hi - lo === 1) mx = bz(0.5, x1, x1, x2, x2);
      }
      gap = 'g' + Math.round(g1);
    }
    svg += `<path class="dg-edge" d="${p}" marker-end="url(#${mk})"/>`;
    if (e.label) { const t = e.label.length > 24 ? e.label.slice(0, 23) + '…' : e.label; lbl.push({ mx, my, gap, t, full: e.label, w: textW(t, 11) + 10 }); }
  }
  // labels sharing a gap get pushed apart sideways so none overlap
  const byGap = {};
  for (const l of [...lbl, ...posts]) (byGap[l.gap] ||= []).push(l);
  for (const row of Object.values(byGap)) {
    row.sort((p, q) => p.mx - q.mx);
    for (let k = 0; k < 40; k++) {
      let moved = false;
      for (let i = 1; i < row.length; i++) {
        const ov = row[i - 1].mx + row[i - 1].w / 2 + 4 - (row[i].mx - row[i].w / 2);
        if (ov <= 0) continue;
        const p = row[i - 1], q = row[i];
        if (p.fixed && q.fixed) continue;
        if (p.fixed) q.mx += ov; else if (q.fixed) p.mx -= ov; else { p.mx -= ov / 2; q.mx += ov / 2; }
        moved = true;
      }
      for (const l of row) if (!l.fixed) l.mx = Math.max(left + l.w / 2, Math.min(W - l.w / 2, l.mx));
      row.sort((p, q) => p.mx - q.mx);
      if (!moved) break;
    }
  }
  for (const l of lbl) {
    svg += `<g><title>${esc(l.full)}</title><rect class="dg-elabel-bg" x="${l.mx - l.w / 2}" y="${l.my - 9}" width="${l.w}" height="17" rx="2"/><text class="dg-elabel" x="${l.mx}" y="${l.my + 3.5}" text-anchor="middle">${esc(l.t)}</text></g>`;
  }
  components.forEach((c, i) => {
    const p = pos[c.id], s = info(c);
    const lines = wrap(c.summary, Math.floor((p.w - 24) / 6.1)).slice(0, 2);
    if (wrap(c.summary, Math.floor((p.w - 24) / 6.1)).length > 2) lines[1] = lines[1].replace(/\s*\S*$/, '') + '…';
    svg += `<g class="box" data-id="${esc(c.id)}" style="--c:var(--c${i % 8})"><title>${esc(c.name)}: ${esc(c.summary)}</title>` +
      `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="3"/><rect class="bar" x="${p.x}" y="${p.y}" width="${p.w}" height="4" rx="1"/>` +
      `<text class="t" x="${p.x + 12}" y="${p.y + 26}">${esc(c.name.length * 7.6 > p.w - 20 ? c.name.slice(0, Math.floor((p.w - 20) / 7.6)) + '…' : c.name)}</text>` +
      `<text class="s" x="${p.x + 12}" y="${p.y + 43}" style="font-family:var(--mono)">${s}</text>` +
      lines.map((l, k) => `<text class="s" x="${p.x + 12}" y="${p.y + 63 + k * 15}">${esc(l)}</text>`).join('') + '</g>';
  });
  return svg + '</svg>';
}

// ---------- import graph ----------

// d3-style force layout: 1/d charge, springs weakened at hubs, collision, and a gentle pull toward
// each node's group so parts of the system read as clusters. Mutates nodes' x/y.
// shortcut: O(n²) per tick, fine to ~800 files; switch to a quadtree (Barnes-Hut) beyond that.
export function forceLayout(nodes, links) {
  const N = nodes.length;
  if (!N) return;
  const groups = [...new Set(nodes.map(n => n.group))];
  const spread = 40 + Math.sqrt(N) * 22;
  groups.forEach((g, i) => {
    const a = (i / groups.length) * Math.PI * 2;
    nodes.filter(n => n.group === g).forEach((n, k) => {
      n.x = Math.cos(a) * spread + Math.cos(k * 2.4) * (8 + k * 4);
      n.y = Math.sin(a) * spread * 0.75 + Math.sin(k * 2.4) * (8 + k * 4);
      n.vx = n.vy = 0;
    });
  });
  const deg = new Map(nodes.map(n => [n, 0]));
  links.forEach(l => { deg.set(l.s, deg.get(l.s) + 1); deg.set(l.t, deg.get(l.t) + 1); });
  const ticks = 300, charge = 140 * Math.min(1, Math.sqrt(40 / N));
  for (let it = 0; it < ticks; it++) {
    const alpha = Math.max(0.02, 1 - it / ticks);
    for (let i = 0; i < N; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(25, dx * dx + dy * dy), d = Math.sqrt(d2);
        let f = (charge * alpha) / d2;
        const minD = a.r + b.r + 10;
        if (d < minD) f += ((minD - d) / d) * 0.5;
        dx *= f; dy *= f;
        a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 1;
      const rest = 46 + l.s.r + l.t.r;
      const k = ((d - rest) / d) * alpha * 0.5 / Math.min(deg.get(l.s), deg.get(l.t));
      l.s.vx += dx * k; l.s.vy += dy * k; l.t.vx -= dx * k; l.t.vy -= dy * k;
    }
    const cen = {};
    for (const n of nodes) { const c = (cen[n.group] ||= { x: 0, y: 0, k: 0 }); c.x += n.x; c.y += n.y; c.k++; }
    for (const n of nodes) {
      const c = cen[n.group];
      n.vx += (c.x / c.k - n.x) * 0.02 * alpha - n.x * 0.025 * alpha;
      n.vy += (c.y / c.k - n.y) * 0.02 * alpha - n.y * 0.04 * alpha;
      const v = Math.hypot(n.vx, n.vy), cap = v > 30 ? 30 / v : 1;
      n.x += (n.vx *= 0.6 * cap); n.y += (n.vy *= 0.6 * cap);
    }
  }
}

export function forceGraph(el, nodes, links, { onOpen, tip }) {
  const W = 1000, H = 700;
  const byId = new Map(nodes.map(n => [n.id, n]));
  links = links.filter(l => byId.has(l.source) && byId.has(l.target)).map(l => ({ s: byId.get(l.source), t: byId.get(l.target) }));
  forceLayout(nodes, links);
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const pad = 60;
  let vb = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  const svg = document.createElementNS(NS, 'svg');
  const mk = `ar${++uid}`;
  svg.innerHTML = `<defs><marker id="${mk}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="currentColor" opacity=".5"/></marker></defs>`;
  const gE = document.createElementNS(NS, 'g'), gN = document.createElementNS(NS, 'g');
  svg.append(gE, gN);
  for (const l of links) {
    const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.hypot(dx, dy) || 1;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('class', 'gedge');
    const x2 = l.t.x - (dx / d) * (l.t.r + 2), y2 = l.t.y - (dy / d) * (l.t.r + 2);
    const mx = (l.s.x + x2) / 2 - dy * 0.08, my = (l.s.y + y2) / 2 + dx * 0.08;
    p.setAttribute('d', `M${l.s.x},${l.s.y} Q${mx},${my} ${x2},${y2}`);
    p.setAttribute('marker-end', `url(#${mk})`);
    l.el = p;
    gE.append(p);
  }
  const big = [...nodes].sort((a, b) => b.r - a.r).slice(0, nodes.length <= 40 ? 40 : Math.round(nodes.length * 0.18));
  for (const n of nodes) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'gnode');
    g.innerHTML = `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.color}"/>` +
      `<text x="${n.x + n.r + 4}" y="${n.y}" dy=".35em" style="display:${big.includes(n) ? 'block' : 'none'}">${esc(n.label)}</text>`;
    n.el = g;
    g.addEventListener('mouseenter', ev => focus(n, ev));
    g.addEventListener('mouseleave', () => focus(null));
    g.addEventListener('click', () => !moved && onOpen(n));
    gN.append(g);
  }
  const tipEl = el.querySelector('.graph-tip');
  function focus(n, ev) {
    svg.classList.toggle('dim', !!n);
    nodes.forEach(m => { m.el.classList.remove('hot'); m.el.querySelector('text').style.display = big.includes(m) && !n ? 'block' : 'none'; });
    links.forEach(l => l.el.classList.remove('hot'));
    if (!n) { tipEl.style.opacity = 0; return; }
    n.el.classList.add('hot');
    n.el.querySelector('text').style.display = 'block';
    links.forEach(l => {
      if (l.s === n || l.t === n) {
        l.el.classList.add('hot');
        const o = l.s === n ? l.t : l.s;
        o.el.classList.add('hot');
        o.el.querySelector('text').style.display = 'block';
      }
    });
    tipEl.innerHTML = tip(n);
    const r = el.getBoundingClientRect();
    tipEl.style.left = Math.min(ev.clientX - r.left + 14, r.width - 310) + 'px';
    tipEl.style.top = ev.clientY - r.top + 14 + 'px';
    tipEl.style.opacity = 1;
  }
  // open zoomed in at most 1.6x, so a 10-file project fills the frame without turning into giant dots
  const ew = (el.clientWidth || W) / 1.6, eh = (el.clientHeight || H) / 1.6;
  if (vb.w < ew) { vb.x -= (ew - vb.w) / 2; vb.w = ew; }
  if (vb.h < eh) { vb.y -= (eh - vb.h) / 2; vb.h = eh; }
  const apply = () => {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const r = svg.getBoundingClientRect(), s = r.width ? Math.max(vb.w / r.width, vb.h / r.height) : 1;
    svg.style.setProperty('--s', s); // labels stay the same size on screen at any zoom
  };
  el.prepend(svg);
  apply();
  // pan + zoom
  let drag = null, moved = false;
  svg.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = svg.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
    const dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    vb.x = drag.vb.x - dx; vb.y = drag.vb.y - dy; apply();
  });
  window.addEventListener('pointerup', () => (drag = null));
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), k = Math.exp(e.deltaY * 0.0015);
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = (r.width * s - vb.w) / 2, oy = (r.height * s - vb.h) / 2;
    const px = vb.x - ox + (e.clientX - r.left) * s, py = vb.y - oy + (e.clientY - r.top) * s;
    vb = { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w: vb.w * k, h: vb.h * k };
    apply();
  }, { passive: false });
  return {
    filter(hidden) {
      nodes.forEach(n => (n.el.style.display = hidden.has(n.group) ? 'none' : ''));
      links.forEach(l => (l.el.style.display = hidden.has(l.s.group) || hidden.has(l.t.group) ? 'none' : ''));
    },
  };
}

// ---------- treemap (squarified) ----------

function squarify(items, x, y, w, h, out) {
  items = items.filter(i => i.value > 0);
  const total = items.reduce((a, i) => a + i.value, 0);
  if (!items.length || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let row = [], rest = items.map(i => ({ ...i, area: i.value * scale }));
  const worst = (r, side) => {
    const s = r.reduce((a, i) => a + i.area, 0);
    return Math.max(...r.map(i => Math.max((side * side * i.area) / (s * s), (s * s) / (side * side * i.area))));
  };
  while (rest.length) {
    const side = Math.min(w, h), next = rest[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) { row.push(next); rest.shift(); continue; }
    ({ x, y, w, h } = lay(row, x, y, w, h, out));
    row = [];
  }
  if (row.length) lay(row, x, y, w, h, out);
  return out;
}
function lay(row, x, y, w, h, out) {
  const s = row.reduce((a, i) => a + i.area, 0);
  if (w >= h) {
    const cw = s / h; let yy = y;
    row.forEach(i => { const ih = i.area / cw; out.push({ ...i, x, y: yy, w: cw, h: ih }); yy += ih; });
    return { x: x + cw, y, w: w - cw, h };
  }
  const rh = s / w; let xx = x;
  row.forEach(i => { const iw = i.area / rh; out.push({ ...i, x: xx, y, w: iw, h: rh }); xx += iw; });
  return { x, y: y + rh, w, h: h - rh };
}

export function treemap(el, files, colorOf, hrefOf) {
  const W = el.clientWidth, H = el.clientHeight;
  const groups = {};
  files.forEach(f => {
    const parts = f.path.split('/');
    const g = parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : '(root)';
    (groups[g] ||= []).push(f);
  });
  const gs = Object.entries(groups).map(([name, fs]) => ({ name, fs, value: fs.reduce((a, f) => a + Math.max(1, f.loc), 0) })).sort((a, b) => b.value - a.value);
  let html = '';
  for (const g of squarify(gs, 0, 0, W, H, [])) {
    const head = g.h > 40 && g.w > 60 ? 15 : 0;
    if (head) html += `<div style="position:absolute;left:${g.x + 4}px;top:${g.y + 1}px;width:${g.w - 8}px;font:600 10px/14px var(--sans);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.name)}</div>`;
    const fs = g.fs.map(f => ({ f, value: Math.max(1, f.loc) })).sort((a, b) => b.value - a.value);
    for (const r of squarify(fs, g.x, g.y + head, g.w, g.h - head, [])) {
      const name = r.f.path.split('/').pop();
      const show = r.w > 50 && r.h > 22;
      html += `<a href="${hrefOf(r.f)}" title="${esc(r.f.path)} · ${r.f.loc} lines" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;background:color-mix(in srgb, ${colorOf(r.f)} 26%, var(--paper))">${show ? esc(name) + (r.h > 36 ? `<span>${r.f.loc}</span>` : '') : ''}</a>`;
    }
  }
  el.innerHTML = html;
}
