// Today (briefing + reports + coach), Screener, candlestick Chart, broker linking, and shared helpers.
"use strict";

// ---------- shared helpers ----------
function md(text) {
  // Tiny markdown: headings, bullets, bold, italics, links. Input is escaped first.
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, "$1<i>$2</i>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
  let out = "", list = false;
  for (const raw of String(text || "").split("\n")) {
    const l = raw.trimEnd();
    const li = l.match(/^\s*[-*•]\s+(.*)/) || l.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { if (!list) { out += "<ul>"; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += "</ul>"; list = false; }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) out += `<h${Math.min(h[1].length + 2, 5)}>${inline(h[2])}</h${Math.min(h[1].length + 2, 5)}>`;
    else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

// Ask why before breaking a guardrail. Resolves to the reason, or null if the user backs off.
function overrideAsk(message) {
  return new Promise((resolve) => {
    openModal(`<h2 class="bad">Guardrail</h2>
      <div class="hint" style="border-left-color:var(--bad)">${esc(message.replace(/^GUARDRAIL:\s*/, ""))}</div>
      <label>If you still want to do this, write why. It's saved on the trade and shows up in your stats and coach notes.</label>
      <textarea id="ov-why" placeholder="at least 10 characters"></textarea>
      <div class="row" style="margin-top:12px"><button class="primary" id="ov-back">OK, I'll skip it</button><button class="danger" id="ov-go">Override and buy</button></div>`);
    $("#ov-back").onclick = () => { closeModal(); resolve(null); };
    $("#ov-go").onclick = () => {
      const why = $("#ov-why").value.trim();
      if (why.length < 10) return toast("Write at least a sentence.", true);
      closeModal(); resolve(why);
    };
  });
}

// POST a buy; if a guardrail blocks it, ask for a reason and retry once. Returns null if the user backed off.
async function buyPost(url, body) {
  try { return await POST(url, body); } catch (e) {
    if (!String(e.message).startsWith("GUARDRAIL:")) throw e;
    const why = await overrideAsk(e.message);
    if (!why) return null;
    return POST(url, Object.assign({}, body, { override: why }));
  }
}

async function newsPanel(el, ticker) {
  el.innerHTML = `<div class="small muted"><span class="spin"></span> Headlines…</div>`;
  let n;
  try { n = await GET(`/api/news/${encodeURIComponent(ticker)}`); } catch (e) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">News</h3>
      ${n.items.length ? (n.ai ? `<button class="sm" id="nw-ai">Summarise with Claude</button>` : `<span class="small muted">Add an Anthropic key in Settings for AI summaries</span>`) : ""}</div>
    <div id="nw-sum"></div>
    ${n.items.length ? `<ul class="news">${n.items.map((i) => `<li><a href="${esc(i.link || "#")}" target="_blank" rel="noopener">${esc(i.title)}</a>
      <span class="small muted">${esc(i.publisher)} · ${esc(i.time)}</span></li>`).join("")}</ul>` : `<p class="small muted">No recent headlines.</p>`}`;
  const b = $("#nw-ai", el);
  if (b) b.onclick = () => guard(async () => {
    const r = await POST(`/api/news/${encodeURIComponent(ticker)}/summary`);
    $("#nw-sum", el).innerHTML = `<div class="ai">${md(r.text)}<div class="small muted">Summary of the headlines below only. Not advice.</div></div>`;
  }, b);
}

// ---------- Today ----------
VIEWS.today = async function () {
  const t = await GET("/api/today");
  const b = t.briefing;
  const g = t.guardrails[S.acct] || { blocks: [] };
  const icon = { bad: "✕", warn: "!", info: "i" };
  $("#view").innerHTML = `
  ${g.blocks.length ? `<div class="verdict STOP"><div class="big">PAUSE</div><div>${g.blocks.map((x) => esc(x.text)).join("<br>")}</div></div>` : ""}
  <div class="grid g2">
    <div class="panel"><div class="row" style="justify-content:space-between"><h2>Today</h2><button class="sm" id="t-push">Send to phone</button></div>
      ${b.items.length ? `<ul class="flags">${b.items.map((i) => `<li class="${i.level}">${i.ticker ? `<a href="#chart?t=${encodeURIComponent(i.ticker)}">${esc(i.ticker)}</a> ` : ""}${esc(i.text.replace(i.ticker + " ", ""))}
        <span class="small muted">· ${esc(i.account)}</span></li>`).join("")}</ul>` : `<div class="empty small">Nothing needs attention. Stick to the plan.</div>`}
      ${b.signals.length ? `<h3>Lab signals (last 18h)</h3><p>${[...new Set(b.signals.map((s) => s.ticker))].map((tk) => `<a href="#check?t=${encodeURIComponent(tk)}">${esc(tk)}</a>`).join(" · ")}</p>` : ""}
      ${Object.keys(b.screens).length ? `<h3>Screener hits</h3>${Object.entries(b.screens).map(([n, tks]) => `<p><b>${esc(n)}:</b> ${tks.map((tk) => `<a href="#chart?t=${encodeURIComponent(tk)}">${esc(tk)}</a>`).join(" · ")}</p>`).join("")}` : ""}
      <p class="small muted">The briefing is pushed at ${esc(S.settings.briefing_time)} on weekdays (${esc(S.settings.timezone)}).</p>
    </div>
    <div class="panel"><h2>Discipline</h2>
      <div class="grid g3">
        <div class="card"><div class="k">Realized today</div><div class="v ${cls(g.day_pnl)}">${usd(g.day_pnl)}</div><div class="small muted">limit −${pct(S.settings.daily_loss_limit_pct, 0)} of account</div></div>
        <div class="card"><div class="k">This week</div><div class="v ${cls(g.week_pnl)}">${usd(g.week_pnl)}</div><div class="small muted">limit −${pct(S.settings.weekly_loss_limit_pct, 0)}</div></div>
        <div class="card"><div class="k">Losing streak</div><div class="v ${g.streak >= S.settings.max_loss_streak ? "bad" : ""}">${g.streak ?? 0}</div><div class="small muted">cooldown at ${S.settings.max_loss_streak}</div></div>
      </div>
      <h3>Journal coach</h3>
      <p class="small muted">Claude reads your closed trades, plans, exits and overrides and points out patterns in your process. It doesn't pick stocks.
        ${t.ai ? (S.settings.coach_weekly ? "Runs every Friday with the weekly report." : "") : "Needs an Anthropic API key (Settings)."}</p>
      <div class="row"><button id="t-coach" ${t.ai ? "" : "disabled"}>Review my trading now</button><button id="t-week">Make weekly report</button></div>
      <div id="t-coach-out"></div>
    </div>
  </div>
  <div class="panel"><h2>Reports</h2>
    ${t.reports.length ? `<table><tr><th>Date</th><th>Report</th><th>Summary</th><th></th></tr>${t.reports.map((r) => `<tr>
      <td>${date(r.ts)}</td><td>${esc(r.title)}</td><td class="small muted wrap">${esc(r.summary || "")}</td>
      <td><button class="sm" data-rep="${r.id}" data-kind="${r.kind}">Open</button> <button class="sm danger" data-rdel="${r.id}">×</button></td></tr>`).join("")}</table>`
      : `<div class="empty small">Weekly reports land here every Friday evening, with a push to your phone.</div>`}
  </div>`;
  $("#t-push").onclick = (e) => guard(async () => { await POST("/api/briefing/send"); toast("Sent."); }, e.target);
  $("#t-coach").onclick = (e) => guard(async () => {
    $("#t-coach-out").innerHTML = `<p class="small muted"><span class="spin"></span> Reading your journal…</p>`;
    try {
      const r = await POST(`/api/accounts/${S.acct}/coach`);
      $("#t-coach-out").innerHTML = `<div class="ai">${md(r.text)}</div>`;
    } catch (err) { $("#t-coach-out").innerHTML = ""; throw err; }
  }, e.target);
  $("#t-week").onclick = (e) => guard(async () => {
    const r = await POST(`/api/accounts/${S.acct}/weekly`);
    window.open(`/reports/${r.id}`, "_blank");
    route();
  }, e.target);
  $("#view").querySelectorAll("[data-rep]").forEach((b) => (b.onclick = () => guard(async () => {
    if (b.dataset.kind === "weekly") return window.open(`/reports/${b.dataset.rep}`, "_blank");
    const r = await GET(`/api/reports/${b.dataset.rep}`);
    openModal(`<h2>${esc(r.title)} <span class="small muted">${date(r.ts)}</span></h2><div class="ai">${md(r.body)}</div>`);
  }, b)));
  $("#view").querySelectorAll("[data-rdel]").forEach((b) => (b.onclick = () => guard(async () => {
    await api("DELETE", `/api/reports/${b.dataset.rdel}`); route();
  }, b)));
};

// ---------- Screener ----------
let scrMeta = null;
VIEWS.screener = async function () {
  const d = await GET("/api/screener");
  scrMeta = d;
  const presets = (labMeta || (labMeta = await GET("/api/lab/meta"))).presets;
  $("#view").innerHTML = `
  <div class="panel"><h2>Screener</h2>
    <div class="hint">Scan a whole market for stocks where a Lab rule fires on the last completed day. Saved screens run every weekday at
      ${esc(d.time)} and the hits show up in your morning briefing. A hit is a stock worth a look, not a buy signal: run it through
      the pre-trade check, and backtest the rule in the Lab first.</div>
    <div class="row" style="margin-bottom:10px"><span class="small muted">Rule from:</span>
      ${presets.map((p, i) => `<button class="sm" data-pre="${i}">${esc(p.name)}</button>`).join("")}</div>
    <div class="form">
      <div class="span6"><label>Rule (checked at the close)</label><input id="s-rule" placeholder="close > highest(high, 20) and volume > 1.5 * volume_avg(20)"></div>
      <div class="span2"><label>Universe</label><select id="s-uni">${Object.entries(d.universes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></div>
      <div><label>Min price</label><input id="s-px" type="number" step="any" value="5"></div>
      <div><label>Min $ volume/day (M)</label><input id="s-dv" type="number" step="any" value="20"></div>
      <div><label>Min ATR %</label><input id="s-atr" type="number" step="any" placeholder="any"></div>
      <div style="align-self:end"><button class="primary" id="s-run" style="width:100%">Scan now</button></div>
    </div>
  </div>
  <div id="s-out"></div>
  <div class="panel"><h2>Saved screens</h2>
    ${d.screens.length ? d.screens.map((s) => `<div class="card" style="margin-bottom:10px">
      <div class="row" style="justify-content:space-between"><div><b>${esc(s.name)}</b> <span class="small muted">${esc(d.universes[s.universe] || s.universe)}</span><br><code class="small">${esc(s.rule)}</code></div>
      <div class="row"><label class="small chk"><input type="checkbox" data-salert="${s.id}" ${s.alert ? "checked" : ""}> push hits</label>
        <button class="sm" data-srun="${s.id}">Run now</button> <button class="sm danger" data-sdel="${s.id}">×</button></div></div>
      <div class="small" style="margin-top:6px">${s.last_day ? `Last run ${esc(s.last_day)}: ${s.hits.length ? s.hits.map((h) => `<a href="#chart?t=${encodeURIComponent(h.ticker)}">${esc(h.ticker)}</a>`).join(" · ") : "no hits"}` : '<span class="muted">Not run yet.</span>'}</div>
    </div>`).join("") : `<div class="empty small">Run a scan, then save it to get it every evening.</div>`}
  </div>`;
  const spec = () => ({ rule: $("#s-rule").value, universe: $("#s-uni").value, min_price: $("#s-px").value,
    min_dollar_vol: $("#s-dv").value, min_atr_pct: $("#s-atr").value });
  $("#view").querySelectorAll("[data-pre]").forEach((b) => (b.onclick = () => { $("#s-rule").value = presets[b.dataset.pre].entry; }));
  $("#s-run").onclick = (e) => guard(async () => {
    $("#s-out").innerHTML = `<div class="panel empty"><span class="spin"></span> Scanning… the first S&amp;P 500 scan of the day downloads ~500 histories (about 30s).</div>`;
    try { renderHits(await POST("/api/screener/run", spec()), spec); } catch (err) { $("#s-out").innerHTML = ""; throw err; }
  }, e.target);
  $("#view").querySelectorAll("[data-srun]").forEach((b) => (b.onclick = () => guard(async () => { await POST(`/api/screener/${b.dataset.srun}/run`); route(); }, b)));
  $("#view").querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = () => guard(async () => { await api("DELETE", `/api/screener/${b.dataset.sdel}`); route(); }, b)));
  $("#view").querySelectorAll("[data-salert]").forEach((c) => (c.onchange = () => guard(() => PATCH(`/api/screener/${c.dataset.salert}`, { alert: c.checked }))));
};

function renderHits(r, spec) {
  $("#s-out").innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between">
      <h2>${r.hits.length} hit${r.hits.length === 1 ? "" : "s"} <span class="small muted">of ${r.scanned} scanned${r.errors ? `, ${r.errors} without data` : ""}</span></h2>
      <div class="row"><input id="s-name" placeholder="name" style="max-width:200px"><label class="small chk"><input type="checkbox" id="s-alert" checked> push hits</label><button id="s-save">Save screen</button></div></div>
    ${r.hits.length ? `<div class="tablewrap"><table><tr><th>Ticker</th><th>Name</th><th>Sector</th><th>Day</th><th class="num">Close</th><th class="num">Change</th><th class="num">ATR %</th><th class="num">$ vol/day</th><th></th></tr>
      ${r.hits.map((h) => `<tr><td><b>${esc(h.ticker)}</b></td><td class="small">${esc(h.name)}</td><td class="small muted">${esc(h.sector)}</td><td>${h.day}</td>
        <td class="num">${num(h.close)} ${h.currency !== "USD" ? `<span class="small muted">${h.currency}</span>` : ""}</td><td class="num ${cls(h.change_pct)}">${pct(h.change_pct, 1, true)}</td>
        <td class="num">${num(h.atr_pct, 1)}</td><td class="num">${usd(h.dollar_vol / 1e6, 0)}M</td>
        <td><a class="sm" href="#chart?t=${encodeURIComponent(h.ticker)}">chart</a> · <a class="sm" href="#check?t=${encodeURIComponent(h.ticker)}">check</a></td></tr>`).join("")}</table></div>`
      : `<div class="empty small">Nothing matched on the last close.</div>`}</div>`;
  $("#s-save").onclick = (e) => guard(async () => {
    await POST("/api/screener", Object.assign(spec(), { name: $("#s-name").value, alert: $("#s-alert").checked }));
    toast("Saved. It runs every weekday evening."); route();
  }, e.target);
}

// ---------- Chart ----------
VIEWS.chart = async function () {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const t = q.get("t") || "";
  $("#view").innerHTML = `<div class="panel"><div class="row" style="justify-content:space-between">
      <div class="row"><input id="ch-t" placeholder="ticker" value="${esc(t)}" style="max-width:160px"><button id="ch-go">Show</button></div>
      <div class="row" id="ch-range">${["3M", "6M", "1Y", "2Y"].map((r) => `<button class="sm" data-r="${r}">${r}</button>`).join("")}</div></div>
    <div id="ch-info" class="small muted" style="margin:8px 0;min-height:18px"></div>
    <div class="candlebox"><canvas id="ch-c"></canvas></div>
    <div class="small muted" style="margin-top:6px"><span style="color:#e6a23c">━</span> SMA 20 · <span style="color:#b07cff">━</span> SMA 50 · <span style="color:#8b95a3">━</span> SMA 200 ·
      <span class="good">▲</span> your buys · <span class="bad">▼</span> your sells · dashed lines: entry / stop / target of the open plan</div>
  </div>
  <div class="grid g2"><div class="panel" id="ch-plans"></div><div class="panel" id="ch-news"></div></div>`;
  $("#ch-go").onclick = () => { location.hash = `#chart?t=${encodeURIComponent($("#ch-t").value.trim())}`; };
  $("#ch-t").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#ch-go").click(); });
  if (!t) { $("#ch-info").textContent = "Type a ticker, or open a chart from Portfolio, Today or the Screener."; return; }
  const d = await GET(`/api/chart/${encodeURIComponent(t)}`);
  let range = "6M";
  try { range = localStorage.getItem("chartRange") || range; } catch (e) {}
  const draw = () => {
    $("#ch-range").querySelectorAll("button").forEach((b) => b.classList.toggle("primary", b.dataset.r === range));
    candleChart($("#ch-c"), d, range, $("#ch-info"));
  };
  $("#ch-range").querySelectorAll("button").forEach((b) => (b.onclick = () => { range = b.dataset.r; try { localStorage.setItem("chartRange", range); } catch (e) {} draw(); }));
  draw();
  window.onresize = () => { if (location.hash.startsWith("#chart")) draw(); };
  $("#ch-plans").innerHTML = `<h3 style="margin-top:0">Your plans on ${esc(d.ticker)}</h3>${d.plans.length ? `<table><tr><th>#</th><th>Status</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th>Saved</th></tr>
    ${d.plans.map((p) => `<tr class="click" data-id="${p.id}"><td>${p.id}</td><td><span class="pill ${p.status}">${p.status}</span></td><td class="num">${num(p.entry)}</td>
      <td class="num">${num(p.stop)}${p.initial_stop && p.stop > p.initial_stop ? ` <span class="small muted">from ${num(p.initial_stop)}</span>` : ""}</td><td class="num">${num(p.target)}</td><td>${date(p.created_at)}</td></tr>`).join("")}</table>`
    : `<p class="small muted">None. <a href="#check?t=${encodeURIComponent(d.ticker)}">Run a pre-trade check</a>.</p>`}`;
  $("#ch-plans").querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => planModal(tr.dataset.id)));
  newsPanel($("#ch-news"), d.ticker);
};

function sma(vals, n) {
  const out = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

function candleChart(cv, d, range, info) {
  const days = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 }[range] || 126;
  const all = d.bars, closes = all.map((b) => b.c);
  const ma = { 20: sma(closes, 20), 50: sma(closes, 50), 200: sma(closes, 200) };
  const i0 = Math.max(0, all.length - days), bars = all.slice(i0);
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const padR = 56, padT = 10, padB = 18, volH = H * 0.16, priceH = H - padT - padB - volH - 6;
  const plan = d.plans.find((p) => p.status === "open") || d.plans.find((p) => p.status === "planned");
  const levels = plan ? [["entry", plan.entry, "#8b95a3"], ["stop", plan.stop, "#e5534b"], ["target", plan.target, "#2fbf71"]]
    .concat(plan.initial_stop && plan.initial_stop < plan.stop ? [["first stop", plan.initial_stop, "rgba(229,83,75,.45)"]] : [])
    .filter((l) => isNum(l[1])) : [];
  let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
  levels.forEach((l) => { if (l[1] > lo * 0.85 && l[1] < hi * 1.15) { lo = Math.min(lo, l[1]); hi = Math.max(hi, l[1]); } });
  const pad = (hi - lo) * 0.05; lo -= pad; hi += pad;
  const vmax = Math.max(...bars.map((b) => b.v)) || 1;
  const cw = (W - padR) / bars.length;
  const X = (i) => i * cw + cw / 2, Y = (p) => padT + (hi - p) / (hi - lo) * priceH;
  const css = getComputedStyle(document.documentElement);
  const up = css.getPropertyValue("--good").trim(), dn = css.getPropertyValue("--bad").trim();
  const paint = (hover) => {
    g.clearRect(0, 0, W, H);
    g.font = "11px system-ui"; g.textBaseline = "middle";
    // grid + price axis
    g.strokeStyle = "#20262e"; g.fillStyle = "#8b95a3"; g.lineWidth = 1;
    for (let k = 0; k <= 5; k++) {
      const p = lo + (hi - lo) * k / 5, y = Y(p);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke();
      g.fillText(num(p), W - padR + 4, y);
    }
    // month labels
    let lastM = "";
    bars.forEach((b, i) => {
      const m = b.t.slice(0, 7);
      if (m !== lastM && i > 0) { g.fillText(b.t.slice(2, 7), X(i) - 14, H - 8); g.beginPath(); g.moveTo(X(i), padT); g.lineTo(X(i), padT + priceH); g.stroke(); }
      lastM = m;
    });
    // volume
    bars.forEach((b, i) => {
      g.fillStyle = b.c >= b.o ? "rgba(47,191,113,.35)" : "rgba(229,83,75,.35)";
      const h = b.v / vmax * volH;
      g.fillRect(X(i) - cw * 0.35, H - padB - h, Math.max(1, cw * 0.7), h);
    });
    // candles
    bars.forEach((b, i) => {
      const c = b.c >= b.o ? up : dn;
      g.strokeStyle = c; g.fillStyle = c;
      g.beginPath(); g.moveTo(X(i), Y(b.h)); g.lineTo(X(i), Y(b.l)); g.stroke();
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      g.fillRect(X(i) - cw * 0.35, y1, Math.max(1, cw * 0.7), Math.max(1, y2 - y1));
    });
    // moving averages
    [[20, "#e6a23c"], [50, "#b07cff"], [200, "#8b95a3"]].forEach(([n, col]) => {
      g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath();
      let on = false;
      bars.forEach((_, i) => { const v = ma[n][i0 + i]; if (v == null) return; on ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)); on = true; });
      g.stroke();
    });
    // plan levels
    g.setLineDash([5, 4]);
    levels.forEach(([name, p, col]) => {
      if (p < lo || p > hi) return;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(p)); g.lineTo(W - padR, Y(p)); g.stroke();
      g.fillStyle = col; g.fillText(`${name} ${num(p)}`, 4, Y(p) - 7);
    });
    g.setLineDash([]);
    // fills
    const idx = Object.fromEntries(bars.map((b, i) => [b.t, i]));
    d.trades.forEach((t) => {
      const i = idx[t.ts.slice(0, 10)];
      if (i === undefined) return;
      const b = bars[i], buy = t.side === "buy";
      const y = buy ? Y(b.l) + 12 : Y(b.h) - 12;
      g.fillStyle = buy ? up : dn; g.beginPath();
      if (buy) { g.moveTo(X(i), y - 7); g.lineTo(X(i) - 6, y + 4); g.lineTo(X(i) + 6, y + 4); }
      else { g.moveTo(X(i), y + 7); g.lineTo(X(i) - 6, y - 4); g.lineTo(X(i) + 6, y - 4); }
      g.fill();
    });
    // crosshair
    if (hover != null) {
      const b = bars[hover];
      g.strokeStyle = "rgba(230,233,238,.35)"; g.beginPath(); g.moveTo(X(hover), 0); g.lineTo(X(hover), H - padB); g.stroke();
      const chg = hover + i0 > 0 ? b.c / all[hover + i0 - 1].c - 1 : null;
      const fills = d.trades.filter((t) => t.ts.slice(0, 10) === b.t).map((t) => `${t.side} ${qty(t.qty)} @ ${num(t.price)}`).join(", ");
      info.innerHTML = `<b>${b.t}</b> O ${num(b.o)} H ${num(b.h)} L ${num(b.l)} C ${num(b.c)} <span class="${cls(chg)}">${pct(chg, 1, true)}</span> · vol ${(b.v / 1e6).toFixed(2)}M${fills ? ` · <b>${esc(fills)}</b>` : ""}`;
    } else {
      const b = bars[bars.length - 1];
      info.innerHTML = `<b>${esc(d.ticker)}</b> last close ${num(b.c)} on ${b.t}`;
    }
  };
  const pick = (ev) => {
    const r = cv.getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    return Math.max(0, Math.min(bars.length - 1, Math.floor(x / cw)));
  };
  cv.onmousemove = (e) => paint(pick(e));
  cv.ontouchmove = (e) => { paint(pick(e)); };
  cv.onmouseleave = () => paint(null);
  paint(null);
}

// ---------- accounts & broker linking (rendered inside Settings) ----------
async function accountsPanel(el) {
  const accts = await GET("/api/accounts");
  el.innerHTML = `<h2>Accounts &amp; broker links</h2>
    <div class="hint">Link a real account so fills show up by themselves. <b>Alpaca</b> syncs live through its API (read-only by default).
      Any other broker (Avanza, Nordnet, Interactive Brokers…): export your transactions as CSV and import them here. Re-importing the same
      file is safe; duplicates are skipped. Imported buys attach to a matching planned trade, or become "unplanned" trades in the journal.</div>
    <table><tr><th>Account</th><th>Mode</th><th>Link</th><th>Last sync</th><th></th></tr>
    ${accts.map((a) => `<tr><td><b>${esc(a.name)}</b></td><td>${a.mode}</td>
      <td>${a.broker === "alpaca" ? `Alpaca ${a.broker_info.paper ? "paper" : "live"} · key …${esc(a.broker_info.key_hint || "")}${a.broker_info.allow_orders ? " · can place orders" : " · read-only"}` : a.broker === "csv" ? "CSV imports" : '<span class="muted">manual</span>'}</td>
      <td class="small wrap">${a.synced_at ? date(a.synced_at) + " " + String(a.synced_at).slice(11, 16) : ""}<br><span class="muted">${esc(a.sync_status || "")}</span></td>
      <td>${a.mode === "real" ? `${a.broker === "alpaca" ? `<button class="sm primary" data-sync="${a.id}">Sync now</button> <button class="sm danger" data-unlink="${a.id}">Unlink</button>`
        : `<button class="sm" data-alp="${a.id}">Link Alpaca</button>`} <button class="sm" data-csv="${a.id}">Import CSV</button>` : '<span class="small muted">paper</span>'}</td></tr>`).join("")}</table>
    <div class="row" style="margin-top:12px"><input id="na-name" placeholder="new account name, e.g. Avanza ISK" style="max-width:260px">
      <select id="na-mode" style="max-width:140px"><option value="real">real</option><option value="paper">paper</option></select><button id="na-go">Add account</button></div>`;
  $("#na-go", el).onclick = (e) => guard(async () => {
    await POST("/api/accounts", { name: $("#na-name", el).value, mode: $("#na-mode", el).value });
    S.accounts = await GET("/api/accounts"); toast("Account added. Pick it in the top-right menu."); boot();
  }, e.target);
  el.querySelectorAll("[data-alp]").forEach((b) => (b.onclick = () => alpacaModal(+b.dataset.alp, el)));
  el.querySelectorAll("[data-csv]").forEach((b) => (b.onclick = () => csvModal(+b.dataset.csv, el)));
  el.querySelectorAll("[data-sync]").forEach((b) => (b.onclick = () => guard(async () => syncResult(+b.dataset.sync, await POST(`/api/accounts/${b.dataset.sync}/sync`), el), b)));
  el.querySelectorAll("[data-unlink]").forEach((b) => (b.onclick = () => guard(async () => {
    await api("DELETE", `/api/accounts/${b.dataset.unlink}/broker`); toast("Unlinked. Keys deleted; imported trades stay."); accountsPanel(el);
  }, b)));
}

function syncResult(aid, r, el) {
  openModal(`<h2>Synced with Alpaca</h2><p>${esc(r.status)}</p>
    ${r.notes && r.notes.length ? `<ul class="small">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${Math.abs(r.cash_diff) > 0.01 ? `<div class="hint">Alpaca's cash is ${usd(r.cash_diff)} ${r.cash_diff > 0 ? "more" : "less"} than the cockpit's
      (usually fees, interest or dividends the activity feed doesn't itemise). <button class="sm" id="cf-go">Add an adjustment of ${usd(r.cash_diff)}</button></div>` : ""}
    ${Object.keys(r.mismatch || {}).length ? `<div class="hint" style="border-left-color:var(--warn)">Positions differ from Alpaca. Trades made before the sync window, or
      corporate actions (splits), can cause this.</div>` : ""}
    <button onclick="closeModal()">Close</button>`);
  const cf = $("#cf-go");
  if (cf) cf.onclick = (e) => guard(async () => { await POST(`/api/accounts/${aid}/cash_fix`, { amount: r.cash_diff }); toast("Adjusted."); closeModal(); refreshHeader(); }, e.target);
  if (el) accountsPanel(el);
  refreshHeader();
}

function alpacaModal(aid, el) {
  openModal(`<h2>Link Alpaca</h2>
    <div class="hint">In Alpaca: <b>Home → API Keys → Generate</b> (use the Paper Trading dashboard for paper keys). Keys are stored only in
      this computer's database and never sent to the browser again. Every alert scan pulls new fills, deposits and positions.</div>
    <div class="form"><div class="span3"><label>API key ID</label><input id="al-k" autocomplete="off"></div>
      <div class="span3"><label>Secret key</label><input id="al-s" type="password" autocomplete="off"></div>
      <div class="span3"><label>Environment</label><select id="al-p"><option value="1">Paper (paper-api.alpaca.markets)</option><option value="0">Live money</option></select></div>
      <div class="span3"><label>Orders</label><select id="al-o"><option value="0">Read-only (just track)</option><option value="1">Allow "Send to Alpaca" bracket orders</option></select></div></div>
    <p class="small muted">With orders allowed, the plan window gets a button that places a bracket (entry + stop + target) for the planned share count,
      and trailing stops move the stop order for you. Nothing is ever sent without you clicking.</p>
    <button class="primary" id="al-go">Link and sync</button>`);
  $("#al-go").onclick = (e) => guard(async () => {
    const r = await POST(`/api/accounts/${aid}/alpaca`, { key_id: $("#al-k").value.trim(), secret: $("#al-s").value.trim(),
      paper: $("#al-p").value === "1", allow_orders: $("#al-o").value === "1" });
    syncResult(aid, r.sync, el);
  }, e.target);
}

function csvModal(aid, el) {
  openModal(`<h2>Import broker CSV</h2>
    <div class="hint"><b>Avanza:</b> Min ekonomi → Transaktioner → choose dates → Exportera (CSV).<br>
      <b>Nordnet:</b> Min sida → Transaktioner och notor → Exportera.<br>
      <b>Interactive Brokers:</b> Reports → Statements → Activity (CSV).<br>
      <b>Anything else:</b> a CSV with columns date, ticker/symbol, side (buy/sell), quantity, price, and optionally fees and currency.</div>
    <input type="file" id="csv-f" accept=".csv,.txt,text/csv"><div id="csv-out" style="margin-top:12px"></div>`);
  $("#csv-f").onchange = () => guard(async () => {
    const fd = new FormData(); fd.append("file", $("#csv-f").files[0]);
    $("#csv-out").innerHTML = `<span class="spin"></span> Reading and looking up tickers…`;
    const r = await fetch(`/api/accounts/${aid}/import/preview`, { method: "POST", body: fd });
    const p = await r.json();
    if (!r.ok) { $("#csv-out").innerHTML = ""; throw new Error(p.error); }
    const fresh = p.rows.filter((x) => !x.duplicate);
    const secs = Object.entries(p.securities);
    $("#csv-out").innerHTML = `<p>Detected <b>${esc(p.format)}</b>: ${p.rows.filter((x) => x.kind === "trade").length} trades, ${p.rows.filter((x) => x.kind === "cash").length} cash items,
      <b>${fresh.length}</b> new.${p.manual_trades ? ` <span class="warn">This account already has ${p.manual_trades} hand-entered fill(s); importing the same trades again would double them.</span>` : ""}</p>
      ${secs.length ? `<h3>Check the tickers</h3><p class="small muted">Yahoo symbols (Stockholm stocks end in .ST). Clear a box to skip that security.</p>
      <table>${secs.map(([k, s]) => `<tr><td class="small">${esc(s.name)} <span class="muted">${esc(s.isin || "")}</span></td><td><input data-sec="${esc(k)}" value="${esc(s.ticker)}" style="max-width:140px"></td></tr>`).join("")}</table>` : ""}
      <details><summary class="small muted">Rows</summary><div class="tablewrap" style="max-height:260px;overflow:auto"><table><tr><th>Date</th><th>Type</th><th>Security</th><th class="num">Qty</th><th class="num">Price / amount</th><th></th></tr>
      ${p.rows.map((x) => `<tr class="${x.duplicate ? "muted" : ""}"><td>${date(x.ts)}</td><td>${x.kind === "trade" ? x.side : "cash"}</td><td class="small">${esc(x.name || x.note || "")}</td>
        <td class="num">${x.qty != null ? qty(x.qty) : ""}</td><td class="num">${num(x.kind === "trade" ? x.price : x.amount)} ${esc(x.currency)}</td><td class="small">${x.duplicate ? "already imported" : ""}</td></tr>`).join("")}</table></div></details>
      <button class="primary" id="csv-go" style="margin-top:12px" ${fresh.length ? "" : "disabled"}>Import ${fresh.length} new row(s)</button>`;
    $("#csv-go").onclick = (e) => guard(async () => {
      const mapping = {};
      $("#csv-out").querySelectorAll("[data-sec]").forEach((i) => (mapping[i.dataset.sec] = i.value.trim()));
      const c = await POST(`/api/accounts/${aid}/import/commit`, { rows: fresh, mapping });
      openModal(`<h2>Imported</h2><p>${c.trades} trade(s), ${c.cash} cash item(s), ${c.duplicates} duplicate(s) skipped.</p>
        ${c.skipped.length ? `<h3>Skipped</h3><ul class="small">${c.skipped.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        <p class="small muted">Unplanned buys are in the Journal tagged "unplanned". Open them to add your thesis and review.</p><button onclick="closeModal()">Close</button>`);
      refreshHeader(); if (el) accountsPanel(el);
    }, e.target);
  });
}

// ---------- PWA ----------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
