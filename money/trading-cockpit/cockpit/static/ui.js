// Home dashboard, command palette, ticker quick-view drawer, market clocks, theme, keyboard shortcuts, live refresh.
"use strict";

// ---------- small visual helpers ----------
let _sparkId = 0;
// Area sparkline as inline SVG. Colour follows the trend unless given.
function spark(vals, opts = {}) {
  vals = (vals || []).filter(isNum);
  if (vals.length < 2) return "";
  const w = 200, h = opts.h || 38, lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - lo) / span) * (h - 8)]);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
  const col = opts.color || (vals[vals.length - 1] >= vals[0] ? "var(--good)" : "var(--bad)");
  const id = "sg" + ++_sparkId;
  return `<svg class="${opts.cls || "spark"}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${col};stop-opacity:.28"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs>
    <path class="a" d="${line}L${w} ${h}L0 ${h}Z" fill="url(#${id})"/><path class="l" d="${line}" style="stroke:${col}" vector-effect="non-scaling-stroke"/></svg>`;
}

// Where the price sits between stop, entry and target.
function progBar(stop, entry, target, price) {
  if (![stop, entry, price].every(isNum)) return "";
  const tgt = isNum(target) ? target : entry + 2 * (entry - stop);
  const lo = Math.min(stop, price), hi = Math.max(tgt, price), span = hi - lo || 1;
  const at = (x) => Math.max(0, Math.min(100, ((x - lo) / span) * 100));
  const state = price >= entry ? "good" : "bad";
  return `<div class="prog-wrap"><div class="prog" style="--e:${at(entry)}%">
    <div class="track"></div>
    <div class="tick" style="left:${at(stop)}%"></div><div class="tick" style="left:${at(entry)}%"></div>${isNum(target) ? `<div class="tick" style="left:${at(tgt)}%"></div>` : ""}
    <div class="now ${state}" style="left:${at(price)}%" title="now ${num(price)}"></div>
    <span class="lbl" style="left:${Math.max(6, at(stop))}%">${num(stop)}</span>${isNum(target) ? `<span class="lbl" style="left:${Math.min(94, at(tgt))}%">${num(tgt)}</span>` : ""}
  </div></div>`;
}

const tkLink = (t) => `<a class="tk" data-tk="${esc(t)}" href="#chart?t=${encodeURIComponent(t)}">${esc(t)}</a>`;
const delta = (x, d = 1) => `<span class="delta ${cls(x)}">${pct(x, d, true)}</span>`;
function dateBadge(iso, soon) {
  const d = new Date(iso + "T12:00:00");
  return `<span class="datebadge ${soon ? "soon" : ""}"><small>${d.toLocaleString(undefined, { month: "short" })}</small><b>${d.getDate()}</b></span>`;
}

// ---------- Home ----------
VIEWS.today = async function () {
  const [t, st, cv] = await Promise.all([GET("/api/today"), GET(`/api/accounts/${S.acct}/state`), GET(`/api/accounts/${S.acct}/curve`)]);
  const b = t.briefing, g = t.guardrails[S.acct] || { blocks: [] }, s = S.settings;
  const open = st.plans.filter((p) => p.status === "open"), planned = st.plans.filter((p) => p.status === "planned");
  const dayPnl = st.positions.reduce((a, p) => a + (isNum(p.value) && isNum(p.day_change_pct) ? p.value - p.value / (1 + p.day_change_pct) : 0), 0);
  const openPnl = open.reduce((a, p) => a + (p.unrealized || 0), 0);
  const vsSpy = isNum(cv.value) && isNum(cv.spy) ? cv.value - cv.spy : null;
  const heatUse = s.max_heat_pct ? st.heat_pct / s.max_heat_pct : 0;
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const limD = s.daily_loss_limit_pct * st.equity, limW = s.weekly_loss_limit_pct * st.equity;
  const lossUse = (x, lim) => (lim > 0 && x < 0 ? Math.min(1, -x / lim) : 0);
  const meter = (u) => `<div class="meter"><i class="${u >= 1 ? "bad" : u >= 0.6 ? "warn" : ""}" style="width:${Math.max(2, u * 100)}%"></i></div>`;
  const ico = { bad: "✕", warn: "!", info: "i", ok: "✓" };
  $("#view").innerHTML = `
  ${g.blocks.length ? `<div class="verdict STOP"><div class="big">PAUSE</div><div>${g.blocks.map((x) => esc(x.text)).join("<br>")}</div></div>` : ""}
  <div class="ph" style="margin-bottom:16px"><div><div style="font-size:22px;font-weight:700;letter-spacing:-.5px">${greet}.</div>
    <div class="muted small">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · ${esc(acct()?.name || "")} account${acct()?.broker ? ` · synced via ${esc(acct().broker === "alpaca" ? "Alpaca" : "CSV")}` : ""}</div></div>
    <div class="row"><a class="btn" href="#alerts">Watchlist</a><a class="btn primary" href="#check">+ New trade</a></div></div>
  <div class="kpis">
    <div class="kpi hero"><div class="k">Account value</div><div class="v">${usd(st.equity)}</div>
      <div class="s"><span class="${cls(st.total_pnl)}">${usd(st.total_pnl)}</span> all time${st.deposits ? ` · ${pct(st.total_pnl / st.deposits, 1, true)}` : ""}</div>
      ${spark(cv.points.map((p) => p.value), { color: "var(--accent)" })}</div>
    <div class="kpi"><div class="k">Today</div><div class="v ${cls(dayPnl)}">${usd(dayPnl)}</div><div class="s">${pct(st.equity ? dayPnl / st.equity : null, 2, true)} of account · holdings' move today</div></div>
    <div class="kpi"><div class="k">Open P/L</div><div class="v ${cls(openPnl)}">${usd(openPnl)}</div><div class="s">${open.length} open trade${open.length === 1 ? "" : "s"}${planned.length ? ` · ${planned.length} planned` : ""}</div></div>
    <div class="kpi"><div class="k">vs. S&amp;P 500</div><div class="v ${cls(vsSpy)}">${usd(vsSpy)}</div><div class="s">same deposits in SPY: ${usd(cv.spy, 0)}</div></div>
    <div class="kpi"><div class="k">Open risk</div><div class="v ${heatUse > 1 ? "warn" : ""}">${usd(st.heat)}</div>
      <div class="s">${pct(st.heat_pct, 1)} of ${pct(s.max_heat_pct, 0)} limit</div>${meter(heatUse)}</div>
  </div>
  <div class="split">
    <div class="stack">
      <div class="panel"><div class="ph"><h2>Open positions</h2><a class="btn sm" href="#portfolio">All positions →</a></div>
        ${open.length ? `<div class="poslist">${open.map((p) => `<div class="pos" data-tk="${esc(p.ticker)}">
            <div class="t">${esc(p.ticker)} ${p.trail_json ? '<span class="pill open" title="trailing / scale-out rules active">auto</span>' : ""}<small>${qty(p.qty_open)} sh @ ${num(p.avg_entry)}${p.setup ? " · " + esc(p.setup) : ""} · day ${p.hold_days ?? 0}/${p.hold_days_plan ?? "—"}</small></div>
            ${progBar(p.stop, p.avg_entry, p.target, p.price)}
            <div class="r"><b class="${cls(p.unrealized)}">${usd(p.unrealized)}</b><span class="small muted">${num(p.price)}</span></div>
            <div class="r rm"><b class="${cls(p.r_multiple)}">${rmult(p.r_multiple)}</b><span class="small muted">${pct(p.to_stop_pct, 1)} to stop</span></div>
          </div>`).join("")}</div>`
          : `<div class="empty">No open trades. <a href="#check">Plan one</a> or keep your powder dry.</div>`}
        ${planned.length ? `<h3>Waiting to buy</h3><div class="chips">${planned.map((p) => `<span class="chip" data-tk="${esc(p.ticker)}"><b>${esc(p.ticker)}</b> <small>entry ${num(p.entry)}${isNum(p.price) ? ` · now ${num(p.price)}` : ""}</small></span>`).join("")}</div>` : ""}
      </div>
      <div class="panel"><div class="ph"><h2>Account vs. S&amp;P 500</h2><span class="small muted">max drawdown ${pct(cv.max_drawdown, 1)}</span></div>
        ${cv.points.length > 1 ? `<div class="chartbox"><canvas id="h-curve"></canvas></div>` : `<div class="empty small">Fills in after your first trading day.</div>`}</div>
      <div class="panel"><div class="ph"><h2>Reports &amp; coach</h2><div class="row"><button class="sm" id="t-week">Weekly report</button>
          <button class="sm" id="t-coach" ${t.ai ? "" : 'disabled title="Needs an Anthropic API key (Settings)"'}>Review my trading</button></div></div>
        <div id="t-coach-out"></div>
        ${t.reports.length ? `<div class="tablewrap"><table>${t.reports.map((r) => `<tr><td class="muted">${date(r.ts)}</td><td><b>${esc(r.title)}</b><div class="small muted wrap" style="white-space:normal">${esc(r.summary || "")}</div></td>
          <td class="num"><button class="sm" data-rep="${r.id}" data-kind="${r.kind}">Open</button> <button class="sm ghost" data-rdel="${r.id}" title="Delete">✕</button></td></tr>`).join("")}</table></div>`
          : `<div class="empty small">Weekly reports land here every Friday evening${t.ai ? "" : ". The AI coach needs an Anthropic API key in Settings"}.</div>`}
      </div>
    </div>
    <div class="stack">
      <div class="panel"><div class="ph"><h2>Needs attention</h2><button class="sm ghost" id="t-push" title="Push this briefing to your phone">Send to phone</button></div>
        ${b.items.length ? `<ul class="feed">${b.items.map((i) => `<li><span class="ico ${i.level}">${ico[i.level] || "•"}</span><div class="body">${i.ticker ? tkLink(i.ticker) + " " : ""}${esc(i.text.replace(i.ticker + " ", ""))}
            <div class="small muted">${esc(i.account)}</div></div></li>`).join("")}</ul>` : `<div class="empty small">✓ Nothing needs attention. Stick to the plan.</div>`}
        ${b.signals.length ? `<h3>Lab signals (last 18h)</h3><div class="chips">${[...new Set(b.signals.map((x) => x.ticker))].map((tk) => `<span class="chip" data-tk="${esc(tk)}">${esc(tk)}</span>`).join("")}</div>` : ""}
        ${Object.keys(b.screens).length ? `<h3>Screener hits</h3>${Object.entries(b.screens).map(([n, tks]) => `<div class="small muted" style="margin:6px 0 4px">${esc(n)}</div><div class="chips">${tks.map((tk) => `<span class="chip" data-tk="${esc(tk)}">${esc(tk)}</span>`).join("")}</div>`).join("")}` : ""}
      </div>
      <div class="panel"><h2>Discipline</h2>
        <div class="row" style="justify-content:space-between"><span class="small">Realized today</span><b class="${cls(g.day_pnl)}">${usd(g.day_pnl)}</b></div>
        ${meter(lossUse(g.day_pnl, limD))}<div class="small muted" style="margin:4px 0 12px">limit −${usd(limD, 0)} (${pct(s.daily_loss_limit_pct, 0)})</div>
        <div class="row" style="justify-content:space-between"><span class="small">This week</span><b class="${cls(g.week_pnl)}">${usd(g.week_pnl)}</b></div>
        ${meter(lossUse(g.week_pnl, limW))}<div class="small muted" style="margin:4px 0 12px">limit −${usd(limW, 0)} (${pct(s.weekly_loss_limit_pct, 0)})</div>
        <div class="row" style="justify-content:space-between"><span class="small">Losing streak</span><b class="${(g.streak ?? 0) >= s.max_loss_streak ? "bad" : ""}">${g.streak ?? 0} <span class="muted small">/ ${s.max_loss_streak}</span></b></div>
      </div>
      <div class="panel"><div class="ph"><h2>Earnings ahead</h2><span class="small muted">next 30 days</span></div><div id="h-earn"><div class="skel" style="height:42px"></div></div></div>
      <div class="panel"><div class="ph"><h2>Watchlist</h2><a class="btn sm" href="#alerts">Manage</a></div><div id="h-watch"><div class="skel" style="height:42px"></div></div></div>
    </div>
  </div>`;
  if (cv.points.length > 1) lineChart("h-curve", cv.points.map((p) => p.t), [
    { label: "Your account", data: cv.points.map((p) => p.value), borderColor: cssv("--accent"), fill: "origin",
      backgroundColor: (c) => { const a = c.chart.chartArea; if (!a) return "transparent"; const gr = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
        gr.addColorStop(0, "rgba(91,140,255,.22)"); gr.addColorStop(1, "rgba(91,140,255,0)"); return gr; } },
    { label: "Same deposits in SPY", data: cv.points.map((p) => p.spy), borderColor: "#8b95a3", borderDash: [4, 3] },
  ], { scales: { x: { ticks: { color: "#8b95a3", maxTicksLimit: 6 }, grid: { display: false }, border: { display: false } },
               y: { ticks: { color: "#8b95a3", maxTicksLimit: 5 }, grid: { color: cssv("--grid") }, border: { display: false } } } });
  $("#t-push").onclick = (e) => guard(async () => { await POST("/api/briefing/send"); toast("Sent to your phone."); }, e.target);
  $("#t-coach").onclick = (e) => guard(async () => {
    $("#t-coach-out").innerHTML = `<p class="small muted"><span class="spin"></span> Reading your journal…</p>`;
    try { const r = await POST(`/api/accounts/${S.acct}/coach`); $("#t-coach-out").innerHTML = `<div class="ai">${md(r.text)}</div>`; }
    catch (err) { $("#t-coach-out").innerHTML = ""; throw err; }
  }, e.target);
  $("#t-week").onclick = (e) => guard(async () => { const r = await POST(`/api/accounts/${S.acct}/weekly`); window.open(`/reports/${r.id}`, "_blank"); route(true); }, e.target);
  $("#view").querySelectorAll("[data-rep]").forEach((x) => (x.onclick = () => guard(async () => {
    if (x.dataset.kind === "weekly") return window.open(`/reports/${x.dataset.rep}`, "_blank");
    const r = await GET(`/api/reports/${x.dataset.rep}`);
    openModal(`<h2>${esc(r.title)} <span class="small muted">${date(r.ts)}</span></h2><div class="ai">${md(r.body)}</div>`);
  }, x)));
  $("#view").querySelectorAll("[data-rdel]").forEach((x) => (x.onclick = () => guard(async () => { await api("DELETE", `/api/reports/${x.dataset.rdel}`); route(true); }, x)));
  homeAsync();
};

// Slow bits (earnings dates, watchlist quotes) load after the page is up.
async function homeAsync() {
  const view = $("#view").firstElementChild;
  GET(`/api/accounts/${S.acct}/upcoming`).then((rows) => {
    const el = $("#h-earn"); if (!el || !view.isConnected) return;
    el.innerHTML = rows.length ? rows.slice(0, 8).map((r) => `<div class="cal-row"><div class="row" style="gap:12px">${dateBadge(r.date, r.days <= 7)}
        <div>${tkLink(r.ticker)}<div class="small muted">${r.days === 0 ? "today" : r.days === 1 ? "tomorrow" : `in ${r.days} days`}</div></div></div>
        <span class="pill ${r.why === "holding" ? "open" : r.why === "planned" ? "planned" : ""}">${r.why}</span></div>`).join("")
      : `<div class="empty small">No earnings in the next 30 days for what you hold, plan or watch.</div>`;
  }).catch(() => { const el = $("#h-earn"); if (el) el.innerHTML = `<div class="empty small">Couldn't load earnings dates.</div>`; });
  GET("/api/watchlist/quotes").then((wq) => {
    const el = $("#h-watch"); if (!el || !view.isConnected) return;
    el.innerHTML = wq.length ? `<div class="tablewrap"><table>${wq.slice(0, 10).map((w) => `<tr class="click" data-tk="${esc(w.ticker)}"><td><b>${esc(w.ticker)}</b>
        <div class="small muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${esc(w.note || "")}</div></td>
        <td class="num">${num(w.price)}</td><td class="num">${delta(w.change_pct)}</td></tr>`).join("")}</table></div>`
      : `<div class="empty small">Add stocks you're watching: press <kbd>/</kbd> and search, then <b>Watch</b>.</div>`;
  }).catch(() => {});
}

// ---------- ticker quick-view drawer ----------
let drawerTicker = null;
async function openTicker(t) {
  t = String(t || "").trim().toUpperCase();
  if (!t) return;
  drawerTicker = t;
  closePalette();
  $("#drawer-bg").classList.remove("hidden");
  $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-body").innerHTML = `<div class="dr-head"><div style="flex:1"><div class="t">${esc(t)}</div><div class="skel" style="height:14px;width:60%;margin-top:6px"></div></div>
    <button class="ghost" onclick="closeDrawer()"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="skel" style="height:34px;width:40%;margin:12px 0"></div><div class="skel" style="height:150px"></div>`;
  let d;
  try { d = await GET(`/api/quick/${encodeURIComponent(t)}`); } catch (e) {
    if (drawerTicker === t) $("#drawer-body").innerHTML = `<div class="dr-head"><div class="t" style="flex:1">${esc(t)}</div><button class="ghost" onclick="closeDrawer()"><svg class="ic"><use href="#i-x"/></svg></button></div><p class="bad">${esc(e.message)}</p>`;
    return;
  }
  if (drawerTicker !== t) return;
  renderDrawer(d);
}

function renderDrawer(d) {
  const q = d.quote, cur = q.currency !== "USD" ? ` <span class="small muted">${esc(q.currency)}</span>` : "";
  const plan = d.plans.find((p) => p.status === "open") || d.plans[0];
  const closes = d.closes.map((c) => c.c);
  const pos52 = d.high_52w > d.low_52w ? (q.price - d.low_52w) / (d.high_52w - d.low_52w) : 0.5;
  const eDays = d.earnings ? Math.round((new Date(d.earnings + "T12:00:00") - new Date()) / 864e5) : null;
  $("#drawer-body").innerHTML = `
    <div class="dr-head"><div style="flex:1;min-width:0"><div class="t">${esc(d.ticker)}</div><div class="small muted">${esc(d.name)}${d.sector ? " · " + esc(d.sector) : ""}</div></div>
      <button class="ghost" onclick="closeDrawer()" title="Close (esc)"><svg class="ic"><use href="#i-x"/></svg></button></div>
    <div class="row" style="align-items:baseline"><div class="dr-price">${num(q.price)}${cur}</div>${delta(q.change_pct, 2)}<span class="small muted">${q.open ? "live" : "market closed"}</span></div>
    <div style="position:relative;height:150px;margin-top:10px" id="dr-chart">${drawerChart(closes, plan)}</div>
    <div class="small muted" style="display:flex;justify-content:space-between"><span>${esc(d.closes[0]?.t || "")}</span><span>6 months${plan ? ` · <span class="bad">stop</span> / <span class="good">target</span> of plan #${plan.id}` : ""}</span></div>
    <div class="dr-actions">
      <a class="btn primary" href="#check?t=${encodeURIComponent(d.ticker)}"><svg class="ic"><use href="#i-check"/></svg>Check</a>
      <a class="btn" href="#chart?t=${encodeURIComponent(d.ticker)}" data-nodrawer><svg class="ic"><use href="#i-candle"/></svg>Chart</a>
      <button id="dr-watch"><svg class="ic"><use href="#i-bell"/></svg>${d.watched ? "Unwatch" : "Watch"}</button>
      <button id="dr-alert"><svg class="ic"><use href="#i-bell"/></svg>Alert</button>
    </div>
    <div id="dr-alert-f" class="hidden" style="margin-bottom:14px"><div class="row"><select id="dr-ak" style="max-width:170px"><option value="price_above">Rises above</option><option value="price_below">Falls below</option><option value="move_pct">Moves ±% in a day</option></select>
      <input id="dr-av" type="number" step="any" value="${(+q.price).toFixed(2)}" style="max-width:110px"><button class="primary sm" id="dr-ago">Add</button></div></div>
    <div class="kv">
      <div class="card"><div class="k">52-week range</div><div class="range52"><i style="left:${(Math.max(0, Math.min(1, pos52)) * 100).toFixed(1)}%"></i></div>
        <div class="small muted" style="display:flex;justify-content:space-between"><span>${num(d.low_52w)}</span><span>${num(d.high_52w)}</span></div></div>
      <div class="card"><div class="k">From 52-week high</div><div class="v ${d.from_high < -0.2 ? "bad" : ""}">${pct(d.from_high, 1)}</div></div>
      <div class="card"><div class="k">Next earnings</div><div class="v" style="font-size:16px">${d.earnings ? esc(d.earnings) : "—"}</div>${isNum(eDays) && eDays >= 0 ? `<div class="small ${eDays <= 7 ? "warn" : "muted"}">in ${eDays} days</div>` : ""}</div>
      <div class="card"><div class="k">Watchlist</div><div class="v" style="font-size:16px">${d.watched ? "Watching" : "—"}</div>${d.watch_note ? `<div class="small muted">${esc(d.watch_note)}</div>` : ""}</div>
    </div>
    ${d.plans.length ? `<h3>Your plans</h3>${d.plans.map((p) => `<div class="cal-row click" data-plan="${p.id}" style="cursor:pointer"><div><span class="pill ${p.status}">${p.status}</span> <b>#${p.id}</b> <span class="small muted">${esc(p.account)}${p.setup ? " · " + esc(p.setup) : ""}</span></div>
      <span class="small mono">${num(p.stop)} / ${num(p.entry)} / ${num(p.target)}</span></div>`).join("")}` : ""}
    <div id="dr-news" style="margin-top:8px"></div>`;
  $("#dr-watch").onclick = (e) => guard(async () => {
    if (d.watched) await api("DELETE", `/api/watchlist/${encodeURIComponent(d.ticker)}`);
    else await POST("/api/watchlist", { ticker: d.ticker, note: "" });
    toast(d.watched ? `Stopped watching ${d.ticker}.` : `Watching ${d.ticker}: you'll get earnings, volume and big-move alerts.`);
    d.watched = !d.watched; renderDrawer(d);
    if (/^#(today|alerts)?$/.test(location.hash.split("?")[0] || "")) route(true);
  }, e.currentTarget);
  $("#dr-alert").onclick = () => { $("#dr-alert-f").classList.toggle("hidden"); $("#dr-av").focus(); };
  $("#dr-ak").onchange = () => { $("#dr-av").value = $("#dr-ak").value === "move_pct" ? 5 : (+q.price).toFixed(2); };
  $("#dr-ago").onclick = (e) => guard(async () => {
    await POST("/api/alert_rules", { ticker: d.ticker, kind: $("#dr-ak").value, value: $("#dr-av").value, note: "" });
    $("#dr-alert-f").classList.add("hidden"); toast("Alert added. You'll get a push when it fires.");
  }, e.target);
  $("#drawer-body").querySelectorAll("[data-plan]").forEach((r) => (r.onclick = () => planModal(r.dataset.plan)));
  newsPanel($("#dr-news"), d.ticker);
}

function drawerChart(vals, plan) {
  if (vals.length < 2) return `<div class="empty small">No price history.</div>`;
  const levels = plan ? [plan.stop, plan.target].filter(isNum) : [];
  const w = 400, h = 150, all = vals.concat(levels.filter((x) => x > Math.min(...vals) * 0.7 && x < Math.max(...vals) * 1.3));
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const Y = (v) => h - 6 - ((v - lo) / span) * (h - 12);
  const line = vals.map((v, i) => (i ? "L" : "M") + ((i / (vals.length - 1)) * w).toFixed(1) + " " + Y(v).toFixed(1)).join("");
  const col = vals[vals.length - 1] >= vals[0] ? "var(--good)" : "var(--bad)";
  const lv = plan ? [[plan.stop, "var(--bad)"], [plan.entry, "var(--muted)"], [plan.target, "var(--good)"]].filter(([v]) => isNum(v) && v >= lo && v <= hi) : [];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
    <defs><linearGradient id="drg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${col};stop-opacity:.25"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs>
    ${lv.map(([v, c]) => `<line x1="0" x2="${w}" y1="${Y(v)}" y2="${Y(v)}" style="stroke:${c}" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`).join("")}
    <path d="${line}L${w} ${h}L0 ${h}Z" fill="url(#drg)"/><path d="${line}" fill="none" style="stroke:${col}" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>`;
}

function closeDrawer() {
  drawerTicker = null;
  $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-bg").classList.add("hidden");
}

// Any ticker link opens the quick view instead of jumping away (ctrl/cmd-click still navigates).
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  const el = e.target.closest("[data-tk], a[href^='#chart?t=']");
  if (!el || el.hasAttribute("data-nodrawer") || e.target.closest("button:not([data-tk])")) return;
  const t = el.dataset.tk || decodeURIComponent(el.getAttribute("href").split("t=")[1] || "");
  if (!t) return;
  e.preventDefault();
  if (el.closest("#modal")) closeModal();
  openTicker(t);
});

// ---------- command palette ----------
const PAL_PAGES = [
  ["Home", "#today", "i-home"], ["New trade check", "#check", "i-check"], ["Positions", "#portfolio", "i-wallet"], ["Journal", "#journal", "i-book"],
  ["Stats & tax", "#stats", "i-bars"], ["Chart", "#chart", "i-candle"], ["Screener", "#screener", "i-filter"], ["Strategy lab", "#lab", "i-flask"],
  ["Watchlist & alerts", "#alerts", "i-bell"], ["Settings", "#settings", "i-gear"],
];
const PAL_CMDS = [
  ["Toggle light / dark theme", () => toggleTheme(), "i-sun"],
  ["Send today's briefing to my phone", () => guard(async () => { await POST("/api/briefing/send"); toast("Sent."); }), "i-bell"],
  ["Scan alerts now", () => guard(async () => { const r = await POST("/api/alerts/run"); toast(`${r.last_new} new alert(s).`); }), "i-bell"],
  ["Sync broker", () => guard(async () => { const r = await POST(`/api/accounts/${S.acct}/sync`); S.accounts = await GET("/api/accounts"); syncResult(S.acct, r); route(true); }), "i-wallet"],
  ["Keyboard shortcuts", () => showKeys(), "i-more"],
];
let palItems = [], palSel = 0, palSeq = 0;
function openPalette() {
  $("#palette").classList.remove("hidden");
  $("#pal-q").value = "";
  $("#pal-q").focus();
  palRender("");
}
function closePalette() { $("#palette").classList.add("hidden"); }
async function palRender(q) {
  const seq = ++palSeq, ql = q.trim().toLowerCase();
  let tickers = [];
  try { tickers = await GET(`/api/search?q=${encodeURIComponent(q.trim())}`); } catch (e) {}
  if (seq !== palSeq) return;
  const pages = PAL_PAGES.filter(([n]) => !ql || n.toLowerCase().includes(ql));
  const cmds = PAL_CMDS.filter(([n]) => (ql ? n.toLowerCase().includes(ql) : false) && (n !== "Sync broker" || acct()?.broker === "alpaca"));
  palItems = [...tickers.map((t) => ({ kind: "t", ...t })), ...pages.map(([n, h, i]) => ({ kind: "p", name: n, href: h, icon: i })),
    ...cmds.map(([n, fn, i]) => ({ kind: "c", name: n, fn, icon: i }))];
  palSel = 0;
  let html = "", sec = "";
  palItems.forEach((it, i) => {
    const s = it.kind === "t" ? (q.trim() ? "Tickers" : "Your tickers") : it.kind === "p" ? "Go to" : "Actions";
    if (s !== sec) { html += `<div class="pal-sec">${s}</div>`; sec = s; }
    html += it.kind === "t"
      ? `<div class="pal-item" data-i="${i}"><span class="tkr">${esc(it.ticker)}</span><span class="nm">${esc(it.name)}</span>${it.tag ? `<span class="pill ${it.tag === "holding" ? "open" : it.tag === "planned" ? "planned" : ""}">${esc(it.tag)}</span>` : ""}</div>`
      : `<div class="pal-item" data-i="${i}"><svg class="ic"><use href="#${it.icon}"/></svg><span class="nm">${esc(it.name)}</span></div>`;
  });
  $("#pal-list").innerHTML = html || `<div class="empty small">No matches.</div>`;
  $("#pal-list").querySelectorAll(".pal-item").forEach((el) => {
    el.onmousemove = () => palMark(+el.dataset.i);
    el.onclick = (e) => palGo(+el.dataset.i, e.shiftKey);
  });
  palMark(0);
}
function palMark(i) {
  palSel = i;
  $("#pal-list").querySelectorAll(".pal-item").forEach((el) => el.classList.toggle("sel", +el.dataset.i === i));
  $(`#pal-list .pal-item[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
}
function palGo(i, alt) {
  const it = palItems[i];
  if (!it) return;
  closePalette();
  if (it.kind === "t") { if (alt) location.hash = `#chart?t=${encodeURIComponent(it.ticker)}`; else openTicker(it.ticker); }
  else if (it.kind === "p") location.hash = it.href;
  else it.fn();
}

// ---------- market clocks ----------
let mkts = [];
async function loadMarkets() { try { mkts = await GET("/api/markets"); } catch (e) { mkts = []; } drawMarkets(); }
function drawMarkets() {
  const now = Date.now();
  if (mkts.some((m) => new Date(m.next) <= now)) return loadMarkets();
  const left = (iso) => { const m = Math.max(0, Math.round((new Date(iso) - now) / 60000)); const h = Math.floor(m / 60);
    return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`; };
  $("#mkts").innerHTML = mkts.map((m) => `<span class="mkt ${m.open ? "open" : ""}" title="${esc(m.name)} ${m.open ? "open" : "closed"} · local time ${esc(m.local_time)} (holidays not tracked)">
    <span class="dot"></span>${esc(m.name === "Stockholm" ? "STO" : m.name)} <b>${m.open ? "Open" : "Closed"}</b><span class="when muted">· ${m.open ? "closes" : "opens"} ${left(m.next)}</span></span>`).join("");
}

// ---------- theme ----------
function toggleTheme() {
  const light = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  try { localStorage.setItem("theme", light ? "light" : "dark"); } catch (e) {}
  themeIcon();
  route(true);
}
function themeIcon() {
  const light = document.documentElement.dataset.theme === "light";
  $("#theme-btn use").setAttribute("href", light ? "#i-sun" : "#i-moon");
  document.querySelector('meta[name="theme-color"]').content = light ? "#f4f6fa" : "#0b0e13";
}

// ---------- shortcuts ----------
const GO_KEYS = { h: "#today", p: "#portfolio", j: "#journal", s: "#stats", c: "#chart", r: "#screener", l: "#lab", a: "#alerts", ",": "#settings" };
function showKeys() {
  const k = (a, b) => `<tr><td>${a.split(" ").map((x) => `<kbd>${x}</kbd>`).join(" ")}</td><td>${b}</td></tr>`;
  openModal(`<h2>Keyboard shortcuts</h2><table>
    ${k("Ctrl K", "Search tickers, pages and actions")}${k("/", "Same, from anywhere")}${k("n", "New trade check")}
    ${k("g h", "Home")}${k("g p", "Positions")}${k("g j", "Journal")}${k("g s", "Stats &amp; tax")}${k("g c", "Chart")}${k("g r", "Screener")}
    ${k("g l", "Strategy lab")}${k("g a", "Watchlist &amp; alerts")}${k("g ,", "Settings")}${k("t", "Light / dark theme")}${k("r", "Refresh this page's numbers")}${k("esc", "Close panels")}${k("?", "This list")}</table>
    <p class="small muted">Click any ticker anywhere for a quick view. Ctrl/⌘-click to jump straight to its chart.</p>`);
}
let gPending = 0;
document.addEventListener("keydown", (e) => {
  const palOpen = !$("#palette").classList.contains("hidden");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen ? closePalette() : openPalette(); return; }
  if (palOpen) {
    if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); palMark(Math.min(palItems.length - 1, palSel + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palMark(Math.max(0, palSel - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); palGo(palSel, e.shiftKey); }
    return;
  }
  if (e.key === "Escape") { closeDrawer(); closeSide(); return; }
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$("#modal").classList.contains("hidden")) return;
  if (gPending && Date.now() - gPending < 1200) {
    gPending = 0;
    if (GO_KEYS[e.key]) { e.preventDefault(); location.hash = GO_KEYS[e.key]; }
    return;
  }
  if (e.key === "g") { gPending = Date.now(); return; }
  if (e.key === "/") { e.preventDefault(); openPalette(); }
  else if (e.key === "n") location.hash = "#check";
  else if (e.key === "t") toggleTheme();
  else if (e.key === "r") { route(true); refreshHeader(); toast("Refreshed."); }
  else if (e.key === "?") showKeys();
});

// ---------- mobile sheet ----------
function openSide() {
  $("#side").classList.add("open");
  if (!$("#side-bg")) { const bg = document.createElement("div"); bg.id = "side-bg"; bg.onclick = closeSide; document.body.appendChild(bg); }
}
function closeSide() { $("#side").classList.remove("open"); $("#side-bg")?.remove(); }
function closeOverlays() { closeDrawer(); closePalette(); closeSide(); }

// ---------- boot ----------
function uiBoot() {
  if (window.Chart) { Chart.defaults.font.family = "Inter, system-ui, sans-serif"; Chart.defaults.color = "#8b95a3"; }
  $("#search-btn").onclick = openPalette;
  $("#m-search").onclick = openPalette;
  $("#m-more").onclick = openSide;
  $("#theme-btn").onclick = toggleTheme;
  $("#keys-btn").onclick = showKeys;
  $("#drawer-bg").onclick = closeDrawer;
  $("#palette").onclick = (e) => { if (e.target.id === "palette") closePalette(); };
  let deb;
  $("#pal-q").oninput = () => { clearTimeout(deb); deb = setTimeout(() => palRender($("#pal-q").value), 110); };
  themeIcon();
  loadMarkets();
  setInterval(drawMarkets, 20000);
  setInterval(loadMarkets, 10 * 60000);
  // Live numbers: quietly re-render money views every minute while nobody is typing or looking at a popup.
  setInterval(() => {
    const name = (location.hash || "#today").slice(1).split(/[/?]/)[0] || "today";
    if (document.hidden || !["today", "portfolio"].includes(name)) return;
    if (!$("#modal").classList.contains("hidden") || $("#view").contains(document.activeElement) && /input|textarea|select/i.test(document.activeElement.tagName)) return;
    route(true);
  }, 60000);
}
