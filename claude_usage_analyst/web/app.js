"use strict";
/* Claude Usage Analyst: single-page dashboard. No dependencies. */

const $ = (s, el = document) => el.querySelector(s);
const main = $("#main");
const tip = $("#tip");
const state = { data: null, limits: null, insights: null, tools: null, view: null, loadedAt: 0, sort: { key: "start", dir: -1 }, q: "" };

const COMP = [
  { key: "c_cr", label: "Cache reads", color: "var(--s1)" },
  { key: "c_cw", label: "Cache writes", color: "var(--s2)" },
  { key: "c_out", label: "Output", color: "var(--s3)" },
  { key: "c_in", label: "Fresh input", color: "var(--s4)" },
  { key: "c_bg", label: "Background calls", color: "var(--s5)" },
];
const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

// ------------------------------------------------------------------ format
const money = (x, d) => {
  if (x == null || isNaN(x)) return "–";
  const a = Math.abs(x);
  const dp = d != null ? d : a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return "$" + x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
const tok = (x) => {
  if (x == null) return "–";
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (x / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "K";
  return Math.round(x).toString();
};
const pct = (x, d = 0) => (x == null || isNaN(x) ? "–" : x.toFixed(d) + "%");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDay = (k) => new Date(k + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDT = (ts) => fmtDate(ts) + " " + fmtTime(ts);
const dur = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };
const ago = (ts) => { const s = Date.now() / 1000 - ts; if (s < 90) return "just now"; if (s < 3600) return Math.round(s / 60) + " min ago"; if (s < 86400) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " d ago"; };
const shortModel = (m) => (m || "?").replace("claude-", "").replace(/-\d{8}$/, "");

// ------------------------------------------------------------------ fetch
async function api(name) {
  const r = await fetch("/api/" + name, { cache: "no-store" });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

// ------------------------------------------------------------------ tooltip
function showTip(html, ev) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > innerHeight - 8) y = ev.clientY - h - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { tip.hidden = true; };
function bindTips(root) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mousemove", (e) => showTip(el.dataset.tip, e));
    el.addEventListener("mouseleave", hideTip);
  });
}
const tipRows = (title, rows) => `<div class="t">${esc(title)}</div>` + rows.map(([c, l, v]) => `<div class="row"><span>${c ? `<i style="background:${c}"></i>` : ""}${esc(l)}</span><b class="num">${v}</b></div>`).join("");

// ------------------------------------------------------------------ charts
/* Chart width in px for a fraction of the content column, so SVG text isn't stretched. */
function cw(frac) {
  const full = Math.min(main.clientWidth, 1320) - 48 - 38;
  const cols = innerWidth <= 900 ? 1 : frac;
  return Math.max(280, Math.round(cols === 1 ? full : full * cols - (1 - cols) * 16 - 38 * (1 - cols)));
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/* Stacked bars. cats: [{label, tipTitle, values:[..]}], series: [{label,color}] */
function stackedBars({ cats, series, height = 220, fmt = money, refLine = null, markers = null, w = 1 }) {
  const W = cw(w), H = height, L = 52, R = 8, T = 10, B = 26;
  const totals = cats.map((c) => c.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(refLine ? refLine.value * 1.08 : 0, ...totals, 0));
  const iw = W - L - R, ih = H - T - B;
  const bw = iw / Math.max(cats.length, 1);
  const barW = Math.max(2, Math.min(bw * 0.72, 38));
  const y = (v) => T + ih - (v / max) * ih;
  let g = `<g class="grid">`;
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4, yy = y(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  g += `</g>`;
  let bars = "", hov = "", labels = "";
  const every = Math.ceil(cats.length / 12);
  cats.forEach((c, i) => {
    const cx = L + bw * i + bw / 2;
    let acc = 0;
    const segs = c.values.map((v, si) => ({ v, si })).filter((s) => s.v > 0);
    segs.forEach((s, k) => {
      const y0 = y(acc), y1 = y(acc + s.v);
      acc += s.v;
      let h = y0 - y1;
      if (h < 0.5) return;
      const top = k === segs.length - 1;
      const gap = k > 0 ? 1.5 : 0; // 2px surface gap between stacked fills (viewBox units)
      h = Math.max(h - gap, 0.5);
      bars += top
        ? `<path d="${roundTop(cx - barW / 2, y1, barW, h, Math.min(4, barW / 2))}" fill="${series[s.si].color}"/>`
        : `<rect x="${cx - barW / 2}" y="${y1}" width="${barW}" height="${h}" fill="${series[s.si].color}"/>`;
    });
    if (markers && markers[i]) bars += `<text x="${cx}" y="${y(totals[i]) - 6}" text-anchor="middle" style="fill:var(--critical);font-weight:700">${markers[i]}</text>`;
    const rows = series.map((s, si) => [s.color, s.label, fmt(c.values[si])]).filter((r, si) => c.values[si] > 0).reverse();
    rows.push(["", "Total", fmt(totals[i])]);
    hov += `<rect class="hover-col" x="${L + bw * i}" y="${T}" width="${bw}" height="${ih}" data-tip="${esc(tipRows(c.tipTitle || c.label, rows) + (c.extra || ""))}"${c.href ? ` data-href="${c.href}"` : ""}/>`;
    if (i % every === 0) labels += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(c.label)}</text>`;
  });
  let ref = "";
  if (refLine) {
    const yy = y(refLine.value);
    ref = `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${W - R}" y="${yy - 6}" text-anchor="end" style="fill:var(--critical)">${esc(refLine.label)}</text>`;
  }
  const base = `<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}${bars}${base}${ref}${labels}${hov}</svg>`;
}
function roundTop(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* Line/area over time. series: [{points:[[t,v]...], color, label, area, dash}] */
function lineChart({ series, height = 220, fmt = tok, xfmt = fmtTime, xmin, xmax, ymax, refLine = null, vmarks = [], tipFn = null, w = 1 }) {
  const W = cw(w), H = height, L = 56, R = 10, T = 12, B = 26;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return `<div class="empty">No data</div>`;
  const x0 = xmin ?? Math.min(...all.map((p) => p[0])), x1 = xmax ?? Math.max(...all.map((p) => p[0]));
  const max = niceMax(ymax ?? Math.max(...all.map((p) => p[1]), refLine ? refLine.value * 1.05 : 0));
  const iw = W - L - R, ih = H - T - B;
  const X = (t) => L + ((t - x0) / Math.max(x1 - x0, 1)) * iw;
  const Y = (v) => T + ih - (Math.min(v, max) / max) * ih;
  let g = `<g class="grid">`;
  for (let i = 0; i <= 4; i++) { const v = (max * i) / 4; g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
  g += `</g>`;
  let xl = "";
  for (let i = 0; i <= 5; i++) { const t = x0 + ((x1 - x0) * i) / 5; xl += `<text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === 5 ? "end" : "middle"}">${esc(xfmt(t))}</text>`; }
  let paths = "";
  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join("");
    if (s.area) paths += `<path d="${d}L${X(s.points[s.points.length - 1][0]).toFixed(1)},${T + ih}L${X(s.points[0][0]).toFixed(1)},${T + ih}Z" fill="${s.color}" opacity=".16"/>`;
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke" ${s.dash ? 'stroke-dasharray="6 5"' : ""} stroke-linejoin="round"/>`;
  }
  let marks = "";
  const labelled = new Set();
  for (let m of vmarks) {
    if (m.label && labelled.has(m.label)) m = { ...m, label: "" };
    if (m.label) labelled.add(m.label);
    const xx = X(m.t);
    marks += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${T + ih}" stroke="${m.color || "var(--muted)"}" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`;
    if (m.label) marks += `<text x="${xx + 4}" y="${T + 10}" style="fill:${m.color || "var(--muted)"}">${esc(m.label)}</text>`;
  }
  let ref = "";
  if (refLine) ref = `<line x1="${L}" x2="${W - R}" y1="${Y(refLine.value)}" y2="${Y(refLine.value)}" stroke="var(--critical)" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/><text x="${W - R}" y="${Y(refLine.value) - 6}" text-anchor="end" style="fill:var(--critical)">${esc(refLine.label)}</text>`;
  const id = "lc" + Math.random().toString(36).slice(2, 8);
  const svg = `<svg class="chart" id="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}${paths}${marks}${ref}<line class="axis" x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}"/>${xl}<line class="xh" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="var(--ink-2)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/><rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" class="hit"/></svg>`;
  if (tipFn) queueMicrotask(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const hit = el.querySelector(".hit"), xh = el.querySelector(".xh");
    hit.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const t = x0 + ((((e.clientX - r.left) / r.width) * W - L) / iw) * (x1 - x0);
      const html = tipFn(t);
      if (!html) return hideTip();
      const xx = (((e.clientX - r.left) / r.width) * W).toFixed(1);
      xh.setAttribute("x1", xx); xh.setAttribute("x2", xx); xh.setAttribute("visibility", "visible");
      showTip(html, e);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); xh.setAttribute("visibility", "hidden"); });
  });
  return svg;
}
function nearest(points, t) {
  let lo = 0, hi = points.length - 1;
  if (hi < 0) return null;
  while (lo < hi) { const m = (lo + hi) >> 1; if (points[m][0] < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(points[lo - 1][0] - t) < Math.abs(points[lo][0] - t)) lo--;
  return lo;
}

function hbars(items, { fmt = money, max, sub = false } = {}) {
  const m = max ?? Math.max(...items.map((i) => i.value), 1e-9);
  return items.map((it) => `<div class="hbar${it.sub ? " sub" : ""}"${it.href ? ` style="cursor:pointer" data-href="${it.href}"` : ""}${it.tip ? ` data-tip="${esc(it.tip)}"` : ""}>
    <div class="lbl" title="${esc(it.label)}">${esc(it.label)}</div><div class="val">${fmt(it.value)}${it.note ? ` <span class="muted">${it.note}</span>` : ""}</div>
    <div class="track">${(it.parts || [{ value: it.value, color: it.color || "var(--s1)" }]).map((p) => `<b style="width:${(p.value / m) * 100}%;background:${p.color}"></b>`).join("")}</div></div>`).join("");
}
const legend = (items) => `<div class="legend">${items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join("")}</div>`;

// ------------------------------------------------------------------ filtering
function filteredRows() {
  const d = state.data;
  const days = +$("#range").value;
  const proj = $("#project").value;
  const pi = proj ? d.projects.indexOf(proj) : -1;
  let t0 = 0;
  if (days === 1) { const n = new Date(); n.setHours(0, 0, 0, 0); t0 = n / 1000; }
  else if (days) t0 = Date.now() / 1000 - days * 86400;
  return d.rows.filter((r) => r[0] >= t0 && (pi < 0 || r[2] === pi));
}
const C = { ts: 0, session: 1, project: 2, sub: 3, model: 4, in: 5, cw: 6, cr: 7, out: 8, c_in: 9, c_cw: 10, c_cr: 11, c_out: 12, subagent: 13, c_bg: 14 };
const rowCost = (r) => r[C.c_in] + r[C.c_cw] + r[C.c_cr] + r[C.c_out] + r[C.c_bg];

// ------------------------------------------------------------------ views
const views = {};

views.overview = function () {
  const d = state.data, rows = filteredRows();
  const total = rows.reduce((a, r) => a + rowCost(r), 0);
  const sess = new Set(rows.map((r) => r[C.session]));
  const cr = rows.reduce((a, r) => a + r[C.c_cr], 0);
  const out = rows.reduce((a, r) => a + r[C.out], 0);
  const t0 = rows.length ? rows[0][0] : 0;
  const prompts = Object.entries(d.prompts_by_day).filter(([k]) => rows.length && k >= dayKey(t0)).reduce((a, [, v]) => a + v, 0);
  // daily buckets
  const days = {};
  if (rows.length) {
    const start = new Date(rows[0][0] * 1000); start.setHours(12, 0, 0, 0);
    const end = new Date(); end.setHours(12, 0, 0, 0);
    for (let t = start; t <= end; t = new Date(t.getTime() + 86400000)) days[dayKey(t / 1000)] = null;
  }
  const mode = state.ovMode || "component";
  const projNames = d.projects;
  const projTotals = {};
  for (const r of rows) projTotals[r[C.project]] = (projTotals[r[C.project]] || 0) + rowCost(r);
  const topProj = Object.entries(projTotals).sort((a, b) => b[1] - a[1]).map(([k]) => +k);
  const projSeries = topProj.slice(0, 5).map((p, i) => ({ label: projNames[p], color: SERIES[i], p }));
  if (topProj.length > 5) projSeries.push({ label: "Other", color: "var(--muted)", other: true });
  const series = mode === "component" ? COMP : projSeries;
  for (const k in days) days[k] = new Array(series.length).fill(0);
  for (const r of rows) {
    const k = dayKey(r[0]);
    if (!days[k]) days[k] = new Array(series.length).fill(0);
    if (mode === "component") COMP.forEach((c, i) => (days[k][i] += r[C[c.key]]));
    else { let i = projSeries.findIndex((s) => s.p === r[C.project]); if (i < 0) i = projSeries.length - 1; days[k][i] += rowCost(r); }
  }
  const cats = Object.keys(days).sort().map((k) => ({ label: fmtDay(k), tipTitle: new Date(k + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), values: days[k] }));

  // projects + sub-projects
  const bySub = {};
  for (const r of rows) {
    const key = r[C.project] + "|" + r[C.sub];
    bySub[key] = (bySub[key] || 0) + rowCost(r);
  }
  const projItems = [];
  for (const p of topProj.slice(0, 6)) {
    projItems.push({ label: projNames[p], value: projTotals[p], color: "var(--s1)" });
    const subs = Object.entries(bySub).filter(([k, v]) => +k.split("|")[0] === p && d.subs[+k.split("|")[1]] && v >= projTotals[p] * 0.04).sort((a, b) => b[1] - a[1]).slice(0, 6);
    for (const [k, v] of subs) projItems.push({ label: d.subs[+k.split("|")[1]], value: v, sub: true, color: "var(--s1)" });
  }
  // models
  const byModel = {};
  for (const r of rows) byModel[r[C.model]] = (byModel[r[C.model]] || 0) + rowCost(r);
  const modelItems = Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([m, v], i) => ({ label: shortModel(d.models[m]), value: v, color: SERIES[i % 8] }));
  // heatmap hour x weekday
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const r of rows) { const dt = new Date(r[0] * 1000); heat[(dt.getDay() + 6) % 7][dt.getHours()] += rowCost(r); }
  const hmax = Math.max(...heat.flat(), 1e-9);
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let heatHtml = `<div class="heat"><div></div>${Array.from({ length: 24 }, (_, h) => `<div class="hl">${h % 3 === 0 ? h : ""}</div>`).join("")}`;
  heat.forEach((row, di) => {
    heatHtml += `<div>${wd[di]}</div>` + row.map((v, h) => `<div class="c" style="background:var(--seq-${v ? Math.min(6, 1 + Math.floor((v / hmax) * 5.99)) : 0})" data-tip="${esc(tipRows(`${wd[di]} ${h}:00–${h + 1}:00`, [["", "Cost", money(v)]]))}"></div>`).join("");
  });
  heatHtml += `</div>`;
  // top sessions
  const sessCost = {};
  for (const r of rows) sessCost[r[C.session]] = (sessCost[r[C.session]] || 0) + rowCost(r);
  const topSess = Object.entries(sessCost).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i, v]) => ({ s: d.sessions[i], v }));

  main.innerHTML = `
  <h1>Overview</h1><p class="sub">API-equivalent cost of your Claude Code usage across every project in <code>~/.claude</code>. You're on Pro, so this is what the same usage would cost on the API, not what you pay.</p>
  <div class="tiles">
    <div class="tile"><div class="k">Cost (API-equivalent)</div><div class="v">${money(total)}</div><div class="d">${rows.length.toLocaleString()} API requests</div></div>
    <div class="tile"><div class="k">Sessions</div><div class="v">${sess.size}</div><div class="d">${prompts} prompts typed</div></div>
    <div class="tile"><div class="k">Cost per prompt</div><div class="v">${money(prompts ? total / prompts : null)}</div><div class="d">${prompts ? (rows.length / prompts).toFixed(1) : "–"} requests per prompt</div></div>
    <div class="tile"><div class="k">Spent on cache reads</div><div class="v">${pct(total ? (cr / total) * 100 : null)}</div><div class="d">re-reading context each turn</div></div>
    <div class="tile"><div class="k">Output tokens</div><div class="v">${tok(out)}</div><div class="d">what drives your Pro limit</div></div>
  </div>
  <div class="card">
    <div class="card-h"><h2>Daily cost</h2>
      <div class="seg" id="ovmode"><button data-m="component" class="${mode === "component" ? "on" : ""}">By cost type</button><button data-m="project" class="${mode === "project" ? "on" : ""}">By project</button></div>
      <div class="right">${legend(series)}</div></div>
    ${cats.length ? stackedBars({ cats, series }) : `<div class="empty">No usage in this range</div>`}
  </div>
  <div class="grid g-main mt">
    <div class="card"><div class="card-h"><h2>Where it went</h2><span class="muted">project → sub-project (from the files each session touched)</span></div><div class="hbars">${hbars(projItems)}</div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-h"><h2>Models</h2></div><div class="hbars">${hbars(modelItems)}</div></div>
      <div class="card"><div class="card-h"><h2>When you use it</h2></div>${heatHtml}</div>
    </div>
  </div>
  <div class="card mt"><div class="card-h"><h2>Most expensive sessions</h2><a class="right muted" href="#/sessions">all sessions →</a></div>
    ${sessionTable(topSess.map((x) => ({ ...x.s, rangeCost: x.v })), { compact: true })}</div>`;
  $("#ovmode").onclick = (e) => { if (e.target.dataset.m) { state.ovMode = e.target.dataset.m; render(); } };
  bindTips(main);
  bindRows(main);
};

function sessionTable(list, { compact = false } = {}) {
  if (!list.length) return `<div class="empty">No sessions</div>`;
  const cols = [
    ["title", "Session"], ["start", "Started"], ["prompts", "Prompts", "r"], ["requests", "Requests", "r"],
    ["peak_ctx", "Peak context", "r"], ["waste", "Avoidable", "r"], ["cost", "Cost", "r"],
  ];
  const head = cols.map(([k, l, c]) => `<th class="${c || ""} ${compact ? "" : "sortable"}" data-k="${k}">${l}${!compact && state.sort.key === k ? (state.sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("");
  const body = list.map((s) => {
    const c = s.rangeCost ?? s.cost;
    const wastePct = s.cost ? (s.waste / s.cost) * 100 : 0;
    const pill = s.waste >= 0.5 ? `<span class="pill ${wastePct > 35 ? "bad" : "warn"}">${money(s.waste)}</span>` : `<span class="muted">${money(s.waste)}</span>`;
    return `<tr class="click" data-href="#/session/${s.id}">
      <td><div class="t1">${esc(s.title)}</div><div class="t2">${esc(s.project)}${s.sub ? " / " + esc(s.sub) : ""}${s.subagents ? ` · ${s.subagents} subagents` : ""}${s.compactions ? ` · ${s.compactions} compactions` : ""}${s.limit_hits ? ` · <span style="color:var(--critical)">hit limit</span>` : ""}</div></td>
      <td class="num">${fmtDT(s.start)}<div class="t2">${dur(s.end - s.start)}</div></td>
      <td class="r num">${s.prompts}</td><td class="r num">${s.requests}</td>
      <td class="r num">${tok(s.peak_ctx)}</td><td class="r">${pill}</td>
      <td class="r num"><b>${money(c)}</b>${s.rangeCost != null && Math.abs(s.rangeCost - s.cost) > 0.01 ? `<div class="t2">${money(s.cost)} total</div>` : ""}</td></tr>`;
  }).join("");
  return `<div class="tbl-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function bindRows(root) {
  root.querySelectorAll("[data-href]").forEach((el) => el.addEventListener("click", () => { hideTip(); location.hash = el.dataset.href; }));
}

views.sessions = function () {
  const d = state.data, rows = filteredRows();
  const inRange = new Set(rows.map((r) => r[C.session]));
  const rc = {};
  for (const r of rows) rc[r[C.session]] = (rc[r[C.session]] || 0) + rowCost(r);
  let list = d.sessions.map((s, i) => ({ ...s, rangeCost: rc[i] })).filter((s, i) => inRange.has(i));
  const q = state.q.toLowerCase();
  if (q) list = list.filter((s) => (s.title + " " + s.project + " " + (s.sub || "") + " " + (s.branch || "")).toLowerCase().includes(q));
  const { key, dir } = state.sort;
  list.sort((a, b) => { const va = key === "cost" ? a.rangeCost : a[key], vb = key === "cost" ? b.rangeCost : b[key]; return (typeof va === "string" ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * dir; });
  main.innerHTML = `<h1>Sessions</h1><p class="sub">Every Claude Code session in range. Click one to see where its cost built up, turn by turn.</p>
    <div class="toolbar"><input type="text" class="search" id="q" placeholder="Search title, project, sub-project…" value="${esc(state.q)}"><span class="muted">${list.length} sessions · ${money(list.reduce((a, s) => a + (s.rangeCost || 0), 0))}</span></div>
    <div class="card">${sessionTable(list)}</div>`;
  const qi = $("#q");
  qi.oninput = () => { state.q = qi.value; const pos = qi.selectionStart; views.sessions(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  main.querySelectorAll("th.sortable").forEach((th) => th.onclick = () => {
    const k = th.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === "title" ? 1 : -1 }; views.sessions();
  });
  bindRows(main);
};

views.session = async function (id) {
  main.innerHTML = `<div class="loading">Loading session…</div>`;
  let s;
  try { s = await api("session/" + encodeURIComponent(id)); } catch (e) { main.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (state.view !== "session") return;
  const sm = s.summary;
  const mainReqs = s.requests.filter((r) => !r.agent);
  const ctxPts = mainReqs.map((r) => [r.ts, r.ctx]);
  let cum = 0;
  const cumPts = s.requests.map((r) => [r.ts, (cum += r.cost)]);
  const vmarks = s.compactions.map((c) => ({ t: c.ts, label: "compact", color: "var(--s3)" }))
    .concat(s.limit_hits.map((h) => ({ t: h.ts, label: "limit hit", color: "var(--critical)" })))
    .concat(s.findings.filter((f) => f.kind === "compact_late" || f.kind === "clear_on_switch").slice(0, 6).map((f) => ({ t: f.ts, label: f.kind === "compact_late" ? "compact here?" : "/clear here?", color: "var(--s2)" })));
  const x0 = s.requests.length ? s.requests[0].ts : 0, x1 = s.requests.length ? s.requests[s.requests.length - 1].ts : 1;
  const spanFmt = (t) => (x1 - x0 > 86400 ? fmtDT(t) : fmtTime(t));
  const ctxChart = lineChart({
    series: [{ points: ctxPts, color: "var(--s1)", area: true, label: "Context" }],
    xmin: x0, xmax: x1, vmarks, xfmt: spanFmt, height: 240,
    tipFn: (t) => {
      const i = nearest(ctxPts, t); if (i == null) return null;
      const r = mainReqs[i];
      return tipRows(fmtDT(r.ts) + (r.sub ? " · " + r.sub : ""), [["var(--s1)", "Context", tok(r.ctx)], ["", "Cache read", tok(r.cr)], ["", "Cache write", tok(r.cw)], ["", "Output", tok(r.out)], ["", "Cost", money(r.cost, 3)]]) + (r.tools.length ? `<div class="muted" style="margin-top:4px">${esc(r.tools.join(", "))}</div>` : "") + (r.text ? `<div style="margin-top:4px">${esc(r.text.slice(0, 140))}</div>` : "");
    },
  });
  const cumChart = lineChart({ w: 0.66, series: [{ points: cumPts, color: "var(--s2)", label: "Cumulative cost" }], xmin: x0, xmax: x1, fmt: (v) => money(v, 0), xfmt: spanFmt, height: 160,
    tipFn: (t) => { const i = nearest(cumPts, t); return i == null ? null : tipRows(fmtDT(cumPts[i][0]), [["var(--s2)", "Spent so far", money(cumPts[i][1])]]); } });

  // group requests into turns by prompt (main thread)
  const prompts = s.prompts.filter((p) => !p.agent);
  const turns = prompts.map((p, i) => ({ p, until: prompts[i + 1] ? prompts[i + 1].ts : Infinity, reqs: [], cost: 0, tools: {}, agents: 0 }));
  if (!turns.length || (s.requests[0] && s.requests[0].ts < turns[0].p.ts)) turns.unshift({ p: { ts: x0, text: "(session start)", kind: "task" }, until: turns[0] ? turns[0].p.ts : Infinity, reqs: [], cost: 0, tools: {}, agents: 0 });
  for (const r of s.requests) {
    let t = turns.find((t) => r.ts >= t.p.ts && r.ts < t.until) || turns[turns.length - 1];
    t.reqs.push(r); t.cost += r.cost;
    if (r.agent) t.agents++;
    for (const n of r.tools) t.tools[n] = (t.tools[n] || 0) + 1;
  }
  const maxTurn = Math.max(...turns.map((t) => t.cost), 1e-9);
  const turnHtml = turns.map((t) => {
    const reply = [...t.reqs].reverse().find((r) => r.text && !r.agent);
    const chips = Object.entries(t.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `<span class="pill">${esc(n)}${c > 1 ? " ×" + c : ""}</span>`).join("");
    return `<div class="turn"><div class="when">${fmtTime(t.p.ts)}</div>
      <div><div class="p ${t.p.kind !== "human" ? "task" : ""}">${t.p.kind === "notification" ? "↩ subagent: " : ""}${esc(t.p.text)}${t.p.len > t.p.text.length ? "…" : ""}</div>
      ${reply ? `<div class="reply">↳ ${esc(reply.text)}</div>` : ""}
      <div class="meta">${t.reqs.length} requests${t.agents ? ` (${t.agents} in subagents)` : ""} ${chips ? `<span class="chips" style="display:inline-flex;margin-left:6px">${chips}</span>` : ""}</div></div>
      <div class="cost">${money(t.cost)}<div class="costbar" style="width:${(t.cost / maxTurn) * 100}%"></div></div></div>`;
  }).join("");

  const bigTools = [...s.tools].sort((a, b) => b.tax - a.tax).slice(0, 12);
  const findings = s.findings.map((f) => `<div class="finding"><div><b>${esc(s.advice[f.kind] || f.kind)}</b> <span class="muted">${fmtDT(f.ts)}${f.agent ? " · subagent" : ""}</span><div class="ink2">${esc(f.detail)}</div></div><span class="amt">${money(f.savings)}</span></div>`).join("");
  const comp = [["c_cr", "Cache reads"], ["c_cw", "Cache writes"], ["c_out", "Output"], ["c_in", "Fresh input"], ["c_bg", "Background"]];
  main.innerHTML = `<a class="back" href="#/sessions">← Sessions</a>
    <h1 style="margin-top:6px">${esc(sm.title)}</h1>
    <p class="sub">${esc(sm.project)}${sm.sub ? " / <b>" + esc(sm.sub) + "</b>" : ""} · ${fmtDT(sm.start)} → ${dayKey(sm.start) === dayKey(sm.end) ? fmtTime(sm.end) : fmtDT(sm.end)} (${dur(sm.end - sm.start)})${sm.branch ? ` · <code>${esc(sm.branch)}</code>` : ""} · <span class="mono muted">${esc(sm.id)}</span></p>
    <div class="tiles">
      <div class="tile"><div class="k">Cost</div><div class="v">${money(sm.cost)}</div><div class="d">${sm.cc_cost ? "Claude Code reported " + money(sm.cc_cost) : "API-equivalent"}</div></div>
      <div class="tile"><div class="k">Prompts / requests</div><div class="v">${sm.prompts} / ${sm.requests}</div><div class="d">${sm.prompts ? (sm.requests / sm.prompts).toFixed(1) : "–"} requests per prompt</div></div>
      <div class="tile"><div class="k">Peak context</div><div class="v">${tok(sm.peak_ctx)}</div><div class="d">${sm.compactions} compactions</div></div>
      <div class="tile"><div class="k">Subagents</div><div class="v">${sm.subagents}</div><div class="d">${money(sm.subagent_cost)} of the cost</div></div>
      <div class="tile"><div class="k">Avoidable (est.)</div><div class="v" style="color:${sm.waste > 1 ? "var(--critical)" : "inherit"}">${money(sm.waste)}</div><div class="d">${pct(sm.cost ? (sm.waste / sm.cost) * 100 : 0)} of this session</div></div>
      ${sm.lines_added != null ? `<div class="tile"><div class="k">Lines changed</div><div class="v">+${sm.lines_added.toLocaleString()}</div><div class="d">−${(sm.lines_removed || 0).toLocaleString()} · ${sm.lines_added ? money((sm.cost / sm.lines_added) * 100) : "–"} per 100 lines</div></div>` : ""}
    </div>
    <div class="card"><div class="card-h"><h2>Context size per request</h2><span class="muted">every request re-reads this much, so the area under the curve is what you pay for</span>
      <div class="right">${legend([{ label: "Main-thread context", color: "var(--s1)" }, { label: "Compaction", color: "var(--s3)" }, { label: "Suggested /compact or /clear", color: "var(--s2)" }])}</div></div>${ctxChart}</div>
    <div class="grid g-main mt">
      <div class="card"><div class="card-h"><h2>Cumulative cost</h2></div>${cumChart}
        <div class="hbars mt">${hbars([{ label: "Cost breakdown", value: sm.cost, parts: comp.map(([k], i) => ({ value: sm[k] || 0, color: SERIES[i] })) }])}</div>
        <div style="margin-top:8px">${legend(comp.map(([k, l], i) => ({ label: `${l} ${money(sm[k] || 0)}`, color: SERIES[i] })))}</div></div>
      <div class="card"><div class="card-h"><h2>What would have been cheaper</h2></div>${findings || `<div class="muted">Nothing notable. This session was run efficiently.</div>`}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h2>Heaviest tool results</h2><span class="muted">≈ tokens × turns carried</span></div>
        <div class="tbl-wrap"><table><thead><tr><th>Tool</th><th class="r">Result</th><th class="r">Carried</th><th class="r">Cost</th></tr></thead><tbody>
        ${bigTools.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.agent ? ' <span class="pill">subagent</span>' : ""}<div class="t2 mono" style="word-break:break-all">${esc(t.target)}</div></td><td class="r num">${tok(t.tokens)}</td><td class="r num">${t.carried}×</td><td class="r num">${money(t.tax)}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Subagents</h2></div>${s.agents.length ? `<div class="tbl-wrap"><table><thead><tr><th>Agent</th><th class="r">Requests</th><th class="r">Peak ctx</th><th class="r">Cost</th></tr></thead><tbody>
        ${s.agents.sort((a, b) => b.cost - a.cost).map((a) => `<tr><td><b>${esc(a.type || "agent")}</b><div class="t2">${esc(a.desc || a.id)}</div></td><td class="r num">${a.requests}</td><td class="r num">${tok(a.peak_ctx)}</td><td class="r num">${money(a.cost)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="muted">No subagents in this session.</div>`}</div>
    </div>
    <div class="card mt"><div class="card-h"><h2>Conversation</h2><span class="muted">each prompt and everything it triggered</span></div>${turnHtml}</div>`;
  bindTips(main);
};

views.limits = function () {
  const L = state.limits;
  const cal = L.calibration, cur = L.current, wk = L.weekly;
  const lim = cal.block_limit;
  let gauge;
  if (cur && cur.active) {
    const p = cur.pct ?? 0, pp = cur.projected_pct ?? 0, live = cur.source === "live";
    const lim = cur.limit;
    const cls = p >= 90 ? "st-bad" : p >= 70 || pp >= 100 ? "st-warn" : "st-good";
    const color = p >= 90 ? "var(--critical)" : p >= 70 ? "var(--serious)" : "var(--good)";
    const b = cur.block;
    const pts = cur.timeline;
    let proj = [];
    if (cur.rate_per_hour > 0) {
      const endT = cur.eta_limit ? cur.eta_limit : b.end;
      proj = [[L.now, b.units], [endT, cur.eta_limit ? lim : cur.projected]];
    }
    const chart = lineChart({
      series: [{ points: pts, color: "var(--s1)", area: true, label: "Used" }, { points: proj.length ? [[pts.length ? pts[pts.length - 1][0] : L.now, b.units], ...proj.slice(1)] : [], color: "var(--s1)", dash: true, label: "Projection" }],
      xmin: b.start, xmax: b.end, ymax: Math.max((lim || 0) * 1.1, Math.min(cur.projected, (lim || cur.projected) * 1.1), b.units) * 1.02, height: 200, w: 0.8,
      refLine: lim ? { value: lim, label: live ? "limit" : "est. limit" } : null, vmarks: [{ t: L.now, label: "now", color: "var(--ink-2)" }],
      tipFn: (t) => { const i = nearest(pts, t); return i == null ? null : tipRows(fmtTime(pts[i][0]), [["var(--s1)", "Used", tok(pts[i][1]) + " units"], ["", "of limit", lim ? pct((pts[i][1] / lim) * 100) : "–"]]); },
    });
    gauge = `<div class="gauge-wrap"><div class="gauge">
        <div class="status ${cls}">${p >= 100 ? "Limit reached" : p >= 90 ? "Nearly out" : pp >= 100 ? "On pace to hit the limit" : "Plenty left"}</div>
        <div class="big">${pct(p)}</div><div class="muted">${live ? `of your 5-hour limit · <span class="pill good" title="Fetched from the same Anthropic endpoint /usage uses${cur.live_stale ? " (last good value; the latest fetch failed)" : ""}">live${cur.live_stale ? " · stale" : ""}</span>` : "of your estimated 5-hour limit"}</div>
        <div class="meter mt"><b class="proj" style="width:${Math.min(pp, 100)}%;background:${color}"></b><b style="width:${Math.min(p, 100)}%;background:${color}"></b></div>
        <dl class="kv mt">
          <dt>Resets in</dt><dd><b>${dur(cur.remaining_s)}</b> at ${fmtTime(L.now + cur.remaining_s)}</dd>
          <dt>Burn rate</dt><dd>${cur.rate_per_hour ? tok(cur.rate_per_hour) + " units/h · " + money(cur.cost_rate_per_hour) + "/h" : "idle"}</dd>
          <dt>At this pace</dt><dd>${cur.eta_limit ? `<b style="color:var(--critical)">limit at ${fmtTime(cur.eta_limit)}</b>` : `ends at ~${pct(pp)}`}</dd>
          <dt>Window cost</dt><dd>${money(b.cost)} API-equivalent</dd>
        </dl>
        ${live ? "" : `<p class="muted mt" style="font-size:12.5px;margin-bottom:0">${L.live && L.live.error ? `Live usage unavailable: ${esc(L.live.error)}. ` : ""}Showing the estimate.</p>`}
        <form id="calib" class="mt" style="display:${live ? "none" : "flex"};gap:6px;align-items:center;flex-wrap:wrap">
          <span class="muted" style="font-size:12.5px">/usage says</span>
          <input type="number" id="calpct" min="1" max="100" step="1" style="width:70px" placeholder="%">
          <button type="submit">Calibrate</button><span id="calmsg" class="muted" style="font-size:12px"></span>
        </form></div>
      <div>${chart}</div></div>
      <h3 class="mt">In this window</h3>
      <div class="hbars">${hbars(cur.sessions.map((s) => ({ label: (s.live ? "● " : "") + s.title, value: s.units, note: s.project, href: "#/session/" + s.id, color: s.live ? "var(--s1)" : "var(--seq-3)" })), { fmt: (v) => (lim ? pct((v / lim) * 100, 1) : tok(v)), max: lim || undefined })}</div>`;
  } else {
    gauge = `<div class="status st-idle">No active window</div><p class="muted">Your next message starts a fresh 5-hour window${cur ? ` (the last one ended ${ago(cur.block.end)})` : ""}.</p>`;
  }
  const blocks = L.blocks.slice(-40);
  const cats = blocks.map((b) => ({ label: fmtDate(b.start), tipTitle: `${fmtDT(b.start)} → ${fmtTime(b.end)}`, values: [b.units], href: null,
    extra: `<div class="muted" style="margin-top:4px">${money(b.cost)} API-eq · ${b.requests} requests${b.hit_ts ? `<br><b style="color:var(--critical)">Hit the limit at ${fmtTime(b.hit_ts)}</b>` : ""}</div>` }));
  const hist = stackedBars({ w: 0.5, cats, series: [{ label: "Usage units", color: "var(--s1)" }], fmt: tok, refLine: lim ? { value: lim, label: "est. limit" } : null, markers: blocks.map((b) => (b.hit_ts ? "✕" : "")) });
  const dayCats = wk.daily_units.map((v, i) => { const t = L.now - (13 - i) * 86400; return { label: fmtDate(t), tipTitle: "24h ending " + fmtDT(t), values: [v] }; });
  const samples = cal.samples.map((s) => `<tr><td>${fmtDT(s.hit_ts)}</td><td class="r num">${tok(s.units_at_hit)}</td><td class="r num">${money(s.cost_at_hit)}</td><td class="r">${s.clean ? '<span class="pill good">used</span>' : `<span class="pill" title="Window began ${s.untracked_lead_min} min before your first local request, so some usage happened elsewhere (claude.ai?)">lower bound</span>`}</td></tr>`).join("");
  main.innerHTML = `<h1>Limits</h1><p class="sub">Pro plan limits reset every 5 hours from your first message. Claude.ai chats share the same limit, but only Claude Code usage is visible here.</p>
    <div class="card">${gauge}</div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-h"><h2>Recent 5-hour windows</h2><span class="muted">✕ = hit the limit</span></div>${hist}</div>
      <div class="card"><div class="card-h"><h2>Last 14 days</h2><span class="muted">rolling 7d: ${tok(wk.units)} units (${wk.blocks_equiv ? wk.blocks_equiv.toFixed(1) + "× a full window" : "–"}) · ${money(wk.cost)}</span></div>
        ${stackedBars({ w: 0.5, cats: dayCats, series: [{ label: "Usage units", color: "var(--s1)" }], fmt: tok, refLine: wk.limit ? { value: wk.limit / 7, label: "weekly limit ÷ 7" } : null })}
        ${wk.live ? `<p>Weekly limit: <b>${pct(wk.live.pct)}</b> used <span class="pill good">live</span> · resets ${fmtDT(wk.live.resets_at)}</p>` : wk.limit ? `<p>Weekly: <b>${pct(wk.pct)}</b> of your ${tok(wk.limit)}-unit weekly budget.</p>` : `<p class="muted">No weekly limit set. Add one in <a href="#/settings">Settings</a> if you've been told your weekly cap.</p>`}</div>
    </div>
    <div class="card mt"><div class="card-h"><h2>How the limit is estimated</h2><span class="pill ${cal.source === "calibrated" ? "good" : ""}">${cal.source}</span></div>
      <div class="grid g2"><div>
        <p class="ink2" style="margin-top:0">Anthropic doesn't publish Pro limits in tokens, so this learns yours from the times you actually hit it.
        Dollar cost turned out to be a poor predictor: your limit hits ranged from ${money(Math.min(...cal.samples.map((s) => s.cost_at_hit || 1e9)))} to ${money(Math.max(0, ...cal.samples.map((s) => s.cost_at_hit || 0)))}.
        What fits is a <b>usage unit</b>:</p>
        <p class="note"><b>units = output tokens + ${cal.alpha} × (fresh input + cache-write tokens)${cal.beta ? ` + ${cal.beta} × cache reads` : ""}</b>, ${Object.keys(cal.weights || {}).length ? "with model weights fit from your /usage readings (" + Object.entries(cal.weights).map(([f, w]) => `${esc(f)} ${w.toFixed(2)}× Sonnet`).join(", ") + ")." : "with every model counted equally until a /usage reading says otherwise."}
        ${cal.spread ? `Across your ${cal.clean_hits} clean limit hits this lands within <b>${pct((cal.spread - 1) * 100)}</b> of the same number, and no window that stayed under the limit exceeds it.` : ""}
        Estimated limit: <b>${lim ? tok(lim) + " units" : "unknown"}</b> per 5 hours${cal.source === "manual" ? " (set manually)" : ""}. It refits automatically every time you hit the limit again.</p>
      </div><div><div class="tbl-wrap"><table><thead><tr><th>Limit hit</th><th class="r">Units</th><th class="r">API-eq $</th><th class="r"></th></tr></thead><tbody>${samples || `<tr><td colspan="4" class="muted">No limit hits recorded yet</td></tr>`}</tbody></table></div>
      ${(cal.readings || []).length ? `<div class="tbl-wrap mt"><table><thead><tr><th>/usage reading</th><th class="r">Said</th><th class="r">Model now says</th><th>Models</th></tr></thead><tbody>${cal.readings.slice().reverse().map((r) => `<tr><td>${fmtDT(r.ts)}</td><td class="r num">${pct(r.pct)}${r.auto ? ' <span class="muted" title="recorded automatically from the live endpoint">auto</span>' : ""}</td><td class="r num">${pct(r.predicted)}</td><td>${r.families.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="muted" style="font-size:12.5px">${L.live && L.live.ok ? "The current % comes live from Anthropic, so this estimate only drives past windows and the fallback. Each window's live reading is saved above as calibration automatically. " : ""}Manual calibration: run <code>/usage</code> in Claude Code and enter the "current session" % above (or <code>claude-usage calibrate 44</code>), ideally after a stretch on a model you haven't calibrated yet.</p></div></div>
    </div>`;
  bindTips(main);
  bindRows(main);
  const f = $("#calib");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const v = +$("#calpct").value;
    if (!(v > 0 && v <= 100)) { $("#calmsg").textContent = "enter 1–100"; return; }
    $("#calmsg").textContent = "saving…";
    const r = await fetch("/api/calibrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pct: v }) });
    const j = await r.json();
    if (j.error) { $("#calmsg").textContent = j.error; return; }
    await load(true);
    render();
  };
};

views.insights = function () {
  const I = state.insights, h = I.habits;
  const recs = I.recommendations.map((r) => `<div class="rec"><div class="rec-h"><h2>${esc(r.title)}</h2><span class="muted">${r.count} cases in ${r.sessions} sessions</span><span class="save">≈${money(r.savings)}</span></div>
    <p>${esc(r.advice)}</p>
    <details ${r === I.recommendations[0] ? "open" : ""}><summary>Biggest examples</summary><div class="ex mt">${r.examples.map((e) => `<span class="num"><b>${money(e.savings)}</b></span><a href="#/session/${e.session}"><span class="ext">${esc(e.title)}</span><div class="exd">${esc(e.detail)} · ${fmtDT(e.ts)}</div></a>`).join("")}</div></details></div>`).join("");
  const models = Object.entries(h.models).sort((a, b) => b[1] - a[1]);
  const tot = I.total_cost || 1;
  main.innerHTML = `<h1>Insights</h1><p class="sub">Simulations over your real sessions: what the same work would have cost with better context habits. Savings are conservative estimates in API-equivalent dollars (each simulated /compact keeps ~30K tokens of summary and re-read files). On Pro they mean more work before hitting limits.</p>
    <div class="grid g-main">
      <div class="card"><h3>Potentially avoidable</h3><div class="hero-num">${money(I.total_savings)}</div><div class="muted">${pct((I.total_savings / tot) * 100)} of ${money(I.total_cost)} all-time. The big one is almost always context that grew too long.</div>
        <div class="hbars mt">${hbars(I.recommendations.map((r, i) => ({ label: r.title, value: r.savings, color: SERIES[i % 8] })))}</div></div>
      <div class="card"><h3>Your habits</h3><dl class="kv">
        <dt>Cost that's cache reads</dt><dd><b>${pct(h.cache_read_share * 100)}</b> <span class="muted">(re-reading context each turn)</span></dd>
        <dt>Requests per prompt</dt><dd><b>${h.requests_per_prompt.toFixed(1)}</b> <span class="muted">(autonomous tool loops)</span></dd>
        <dt>Cost per prompt</dt><dd><b>${money(h.cost_per_prompt)}</b></dd>
        <dt>Top 5 sessions</dt><dd><b>${pct(h.top5_share * 100)}</b> of all spend</dd>
        <dt>Subagent share</dt><dd><b>${pct(h.subagent_share * 100)}</b></dd>
        <dt>Long sessions, never compacted</dt><dd><b>${h.long_sessions_no_compact}</b> of ${h.sessions} <span class="muted">(200+ requests)</span></dd>
        <dt>Compactions, all time</dt><dd><b>${h.compactions}</b></dd>
        <dt>Models</dt><dd>${models.map(([m, v]) => `${esc(shortModel(m))} ${pct((v / tot) * 100)}`).join(" · ")}</dd>
      </dl></div>
    </div>
    <div class="mt">${recs || `<div class="card muted">No waste patterns found. Nice.</div>`}</div>`;
};

views.tools = function () {
  const T = state.tools;
  const maxTax = Math.max(...T.tools.map((t) => t.tax), 1e-9);
  main.innerHTML = `<h1>Tools</h1><p class="sub">What tool calls cost after they return: each result sits in context and is re-read on every later turn, so "carried cost" is that result's share of cache reads.</p>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>By tool</h2></div><div class="tbl-wrap"><table><thead><tr><th>Tool</th><th class="r">Calls</th><th class="r">Errors</th><th class="r">Result tokens</th><th class="r">Carried cost</th></tr></thead><tbody>
      ${T.tools.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="costbar" style="margin-left:0;width:${(t.tax / maxTax) * 100}%"></div></td><td class="r num">${t.calls.toLocaleString()}</td><td class="r num">${t.errors ? `${t.errors} <span class="muted">(${pct((t.errors / t.calls) * 100)})</span>` : "0"}</td><td class="r num">${tok(t.tokens)}</td><td class="r num">${money(t.tax)}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Most expensive targets</h2><span class="muted">files and commands</span></div><div class="tbl-wrap"><table><thead><tr><th>Target</th><th class="r">Calls</th><th class="r">Tokens</th><th class="r">Carried</th></tr></thead><tbody>
      ${T.targets.slice(0, 30).map((t) => `<tr><td><span class="pill">${esc(t.tool)}</span> <span class="mono" style="word-break:break-all">${esc(t.target)}</span></td><td class="r num">${t.calls}</td><td class="r num">${tok(t.tokens)}</td><td class="r num">${money(t.tax)}</td></tr>`).join("")}
      </tbody></table></div></div>
    </div>`;
};

views.settings = async function () {
  const S = await api("settings");
  const s = S.settings, cal = S.calibration;
  main.innerHTML = `<h1>Settings</h1><p class="sub">Saved to <code>~/.config/claude-usage/settings.json</code>.</p>
    <div class="card"><div class="form">
      <label for="blk">5-hour limit (usage units)</label><div><input type="number" id="blk" placeholder="auto: ${cal.estimate ? Math.round(cal.estimate) : "not calibrated yet"}" value="${s.block_limit_units ?? ""}"><div class="help">Leave empty to calibrate automatically from your limit hits (currently ${cal.estimate ? tok(cal.estimate) : "none"}). Your biggest window so far used ${tok(cal.peak_block)}.</div></div>
      <label for="wk">Weekly limit (usage units)</label><div><input type="number" id="wk" placeholder="not set" value="${s.weekly_limit_units ?? ""}"><div class="help">Optional. Pro also has a weekly cap; if you hit it, note the rolling 7-day units on the Limits page and enter them here.</div></div>
      <label for="thr">"Compact by" threshold (tokens)</label><div><input type="number" id="thr" value="${s.compact_threshold}"><div class="help">Insights assume you'd /compact once context passes this size. Lower = more aggressive advice.</div></div>
      <label for="ntf">Desktop notifications</label><div><label style="font-weight:400"><input type="checkbox" id="ntf" ${s.notify ? "checked" : ""}> Notify at 80% and 95% of the 5-hour limit while the dashboard server is running</label></div>
      <div></div><div><button class="primary" id="save">Save</button> <span id="saved" class="muted"></span></div>
    </div></div>`;
  $("#save").onclick = async () => {
    const body = { block_limit_units: $("#blk").value || null, weekly_limit_units: $("#wk").value || null, compact_threshold: $("#thr").value || null, notify: $("#ntf").checked };
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    $("#saved").textContent = "Saved. Recomputing…";
    await load(true);
    $("#saved").textContent = "Saved ✓";
  };
};

// ------------------------------------------------------------------ routing / loading
async function load(force = false) {
  const live = $("#live");
  try {
    const [data, limits, insights, tools] = await Promise.all([api("data"), api("limits"), api("insights"), api("tools")]);
    const changed = !state.data || data.generated !== state.data.generated || force;
    state.data = data; state.limits = limits; state.insights = insights; state.tools = tools;
    state.loadedAt = Date.now();
    live.classList.remove("stale"); live.classList.remove("pulse"); void live.offsetWidth; live.classList.add("pulse");
    const sel = $("#project"), cur = sel.value;
    sel.innerHTML = `<option value="">All projects</option>` + data.projects.map((p) => `<option ${p === cur ? "selected" : ""}>${esc(p)}</option>`).join("");
    return changed;
  } catch (e) {
    live.classList.add("stale");
    if (!state.data) main.innerHTML = `<div class="err">Couldn't load data: ${esc(e.message)}</div>`;
    return false;
  }
}

function render() {
  hideTip();
  const [, view, arg] = (location.hash || "#/overview").split("/");
  state.view = view || "overview";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === state.view || (state.view === "session" && a.dataset.view === "sessions")));
  const fn = views[state.view] || views.overview;
  if (!state.data) return;
  const y = scrollY;
  fn(arg ? decodeURIComponent(arg) : undefined);
  if (state._keepScroll) scrollTo(0, y);
  state._keepScroll = false;
}

function initTheme() {
  const saved = (() => { try { return localStorage.getItem("cu-theme"); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").onclick = () => {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cu-theme", next); } catch {}
    render();
  };
}

(async function init() {
  initTheme();
  try { const r = localStorage.getItem("cu-range"); if (r) $("#range").value = r; } catch {}
  $("#range").onchange = () => { try { localStorage.setItem("cu-range", $("#range").value); } catch {} render(); };
  $("#project").onchange = render;
  let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (state.view !== "session" && state.view !== "settings") { state._keepScroll = true; render(); } }, 200); });
  addEventListener("hashchange", () => { scrollTo(0, 0); render(); });
  await load();
  render();
  // live refresh: limits view every 15s, everything else every 60s (only re-render when data changed)
  setInterval(async () => {
    if (document.hidden) return;
    const every = state.view === "limits" ? 15000 : 60000;
    if (Date.now() - state.loadedAt < every - 500) return;
    const changed = await load();
    if ((changed || state.view === "limits") && state.view !== "settings" && state.view !== "session" && !document.activeElement.matches("input")) { state._keepScroll = true; render(); }
  }, 5000);
})();
