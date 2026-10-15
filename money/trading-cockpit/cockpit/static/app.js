// Trading Cockpit front end: plain JS, one view per tab.
"use strict";

const S = { accounts: [], acct: null, settings: {}, charts: {} };
const VIEWS = {};
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- helpers ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const GET = (u) => api("GET", u);
const POST = (u, b) => api("POST", u, b || {});
const PATCH = (u, b) => api("PATCH", u, b || {});

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const cssv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const isNum = (x) => typeof x === "number" && isFinite(x);
function usd(x, d = 2) { return isNum(x) ? (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—"; }
function pct(x, d = 1, sign = false) { return isNum(x) ? (sign && x > 0 ? "+" : "") + (x * 100).toFixed(d) + "%" : "—"; }
function num(x, d = 2) { return isNum(x) ? x.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }) : "—"; }
function qty(x) { return isNum(x) ? (Number.isInteger(x) ? String(x) : x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")) : "—"; }
function cls(x) { return isNum(x) ? (x > 0 ? "good" : x < 0 ? "bad" : "") : ""; }
function rmult(x) { return isNum(x) ? (x > 0 ? "+" : "") + x.toFixed(2) + "R" : "—"; }
function date(s) { return s ? String(s).slice(0, 10) : "—"; }
function money(x) { return `<span class="${cls(x)}">${usd(x)}</span>`; }

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), err ? 6000 : 3000);
}
function openModal(html) { $("#modal-body").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

async function guard(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}
function acct() { return S.accounts.find((a) => a.id === S.acct) || S.accounts[0]; }
function isPaper() { return acct()?.mode === "paper"; }
function lineChart(id, labels, datasets, opts = {}) {
  if (S.charts[id]) S.charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  S.charts[id] = new Chart(el, {
    type: "line", data: { labels, datasets },
    options: Object.assign({
      responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#8b95a3", boxWidth: 12 } } },
      elements: { point: { radius: 0 }, line: { borderWidth: 1.6 } },
      scales: { x: { ticks: { color: "#8b95a3", maxTicksLimit: 8 }, grid: { color: cssv("--grid") }, border: { display: false } },
                y: { ticks: { color: "#8b95a3" }, grid: { color: cssv("--grid") }, border: { display: false } } },
    }, opts),
  });
}

async function refreshHeader() {
  try {
    const st = await GET(`/api/accounts/${S.acct}/state`);
    $("#acct-equity").innerHTML = `<div class="eq">${usd(st.equity)}</div><span class="small ${cls(st.total_pnl)}">${usd(st.total_pnl)} all time</span>`;
    return st;
  } catch (e) { $("#acct-equity").textContent = ""; }
}

// ---------- router ----------
const PAGE_TITLES = { today: "Home", check: "New trade", portfolio: "Positions", journal: "Journal", stats: "Stats & tax", chart: "Chart",
  screener: "Screener", lab: "Strategy lab", evolution: "Strategy evolution", alerts: "Watchlist & alerts", settings: "Settings" };
// quiet: re-render in place (live refresh) without the loading placeholder.
async function route(quiet) {
  let name = (location.hash || "#today").slice(1).split(/[/?]/)[0];
  if (!VIEWS[name]) name = "today";
  document.querySelectorAll("a.nav").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + name));
  $("#page-title").textContent = PAGE_TITLES[name] || "";
  document.title = `${PAGE_TITLES[name] || ""} · Trading Cockpit`;
  if (quiet !== true) {
    if (window.closeOverlays) closeOverlays();
    $("#view").innerHTML = `<div class="empty"><span class="spin"></span> Loading…</div>`;
    $("#view").style.animation = "none"; void $("#view").offsetWidth; $("#view").style.animation = "";
  }
  const seq = S.routeSeq = (S.routeSeq || 0) + 1;
  try { await VIEWS[name](); } catch (e) { $("#view").innerHTML = `<div class="panel bad">${esc(e.message)}</div>`; }
  // A slower, older render finished after a newer one and overwrote it: draw the current page again.
  if (seq !== S.routeSeq) { if (S.routeDone === S.routeSeq) route(true); return; }
  S.routeDone = seq;
}
window.addEventListener("hashchange", route);

async function boot() {
  S.accounts = await GET("/api/accounts");
  S.settings = await GET("/api/settings");
  let saved = null;
  try { saved = Number(localStorage.getItem("acct")); } catch (e) {}
  S.acct = S.accounts.some((a) => a.id === saved) ? saved : S.accounts[0].id;
  const sel = $("#account");
  sel.innerHTML = S.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}${a.name.toLowerCase() === a.mode ? "" : ` (${a.mode})`}</option>`).join("");
  sel.value = S.acct;
  sel.onchange = () => { S.acct = Number(sel.value); try { localStorage.setItem("acct", S.acct); } catch (e) {} refreshHeader(); route(); };
  refreshHeader();
  route();
  if (!S._timer) S._timer = setInterval(refreshHeader, 60000);
  if (window.uiBoot) uiBoot();
}

// Trailing-stop / scale-out rule inputs, shared by the check form and the stop/target modal.
function trailInputs(pre, t) {
  t = t || {};
  const v = (k, m = 1) => (isNum(t[k]) ? +(t[k] * m).toFixed(4) : "");
  return `<div><label>Stop to breakeven at (R)</label><input id="${pre}-be" type="number" step="any" placeholder="e.g. 1" value="${v("breakeven_r")}"></div>
    <div><label>Trail × ATR below high</label><input id="${pre}-ta" type="number" step="any" placeholder="e.g. 3" value="${v("trail_atr")}"></div>
    <div><label>…or trail % below high</label><input id="${pre}-tp" type="number" step="any" placeholder="e.g. 8" value="${v("trail_pct", 100)}"></div>
    <div><label>Sell part at (R)</label><input id="${pre}-sr" type="number" step="any" placeholder="e.g. 2" value="${v("scale_r")}"></div>
    <div><label>…this % of the position</label><input id="${pre}-sf" type="number" step="any" placeholder="50" value="${v("scale_frac", 100)}"></div>`;
}
function readTrail(pre) {
  const g = (k) => $(`#${pre}-${k}`)?.value || "";
  const t = { breakeven_r: g("be"), trail_atr: g("ta"), trail_pct: g("tp"), scale_r: g("sr"), scale_frac: g("sf") };
  return Object.values(t).some((x) => x !== "") ? t : null;
}
function trailText(t) {
  if (!t) return "";
  const parts = [];
  if (t.breakeven_r) parts.push(`stop to breakeven at +${t.breakeven_r}R`);
  if (t.trail_atr) parts.push(`trail ${t.trail_atr}× ATR below the high`);
  if (t.trail_pct) parts.push(`trail ${pct(t.trail_pct, 0)} below the high`);
  if (t.scale_r) parts.push(`sell ${pct(t.scale_frac ?? 0.5, 0)} at +${t.scale_r}R`);
  return parts.join(" · ");
}

// ---------- Check (pre-trade) ----------
let lastCheck = null;
VIEWS.check = async function () {
  const setups = await GET(`/api/accounts/${S.acct}/journal`).then((j) => [...new Set(j.plans.map((p) => p.setup).filter(Boolean))]).catch(() => []);
  const prefill = new URLSearchParams(location.hash.split("?")[1] || "");
  $("#view").innerHTML = `
  <div class="panel">
    <h2>Pre-trade check</h2>
    <div class="hint">Describe the trade you're thinking about. The cockpit sizes it so a stop-out costs about
      ${pct(S.settings.risk_pct, 1)} of your account and checks it against the stock's own history. It does not predict
      direction. You decide that, and write down why.</div>
    <div class="form">
      <div><label>Ticker</label><input id="c-ticker" placeholder="TSLA or EVO.ST" value="${esc(prefill.get("t") || "")}" autocomplete="off"></div>
      <div><label>Entry price</label><input id="c-entry" type="number" step="any" placeholder="live price"></div>
      <div><label>Stop (exit if wrong)</label><input id="c-stop" type="number" step="any" placeholder="auto: 2×ATR"></div>
      <div><label>Target (take profit)</label><input id="c-target" type="number" step="any" placeholder="auto: 4×ATR"></div>
      <div><label>Plan to hold (trading days)</label><input id="c-hold" type="number" value="10" min="1"></div>
      <div><label>Risk % of account</label><input id="c-risk" type="number" step="0.1" value="${(S.settings.risk_pct * 100).toFixed(1)}"></div>
      <div class="span3"><label>Why are you buying? What would prove you wrong?</label><textarea id="c-thesis" placeholder="e.g. Pulled back to its 50-day average in an uptrend, earnings are 6 weeks away. Wrong if it closes below $X."></textarea></div>
      <div><label>Setup tag</label><input id="c-setup" list="setups" placeholder="pullback, breakout…"><datalist id="setups">${setups.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></div>
      <div><label>Confidence (1–5)</label><select id="c-conf"><option value="">–</option>${[1, 2, 3, 4, 5].map((i) => `<option>${i}</option>`).join("")}</select></div>
      <div style="align-self:end"><button class="primary" id="c-run" style="width:100%">Run check</button></div>
    </div>
    <details style="margin-top:10px"><summary class="small muted">Manage the trade automatically (optional): trailing stop, breakeven, partial profit</summary>
      <p class="small muted">Checked on every alert scan. The stop only ever moves up. Paper accounts act on it; for real accounts you get a push
        (and a linked Alpaca stop order is moved for you, if orders are allowed).</p>
      <div class="form">${trailInputs("c")}</div></details>
  </div>
  <div id="c-result"></div>
  <div class="panel hidden" id="c-news"></div>`;
  const run = () => guard(runCheck, $("#c-run"));
  $("#c-run").onclick = run;
  $("#c-ticker").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  $("#c-ticker").addEventListener("change", () => { $("#c-entry").value = ""; $("#c-stop").value = ""; $("#c-target").value = ""; });
  if (prefill.get("t")) run();
};

function checkPayload() {
  return {
    ticker: $("#c-ticker").value, entry: $("#c-entry").value, stop: $("#c-stop").value, target: $("#c-target").value,
    hold_days: $("#c-hold").value, risk_pct: $("#c-risk").value, thesis: $("#c-thesis").value,
    setup: $("#c-setup").value, confidence: $("#c-conf").value, trail: readTrail("c"),
  };
}

async function runCheck() {
  $("#c-result").innerHTML = `<div class="panel empty"><span class="spin"></span> Pulling history, earnings and your portfolio…</div>`;
  const p = checkPayload();
  // First pass fills sensible defaults so the user sees a complete plan.
  if (!p.target && !p.stop) {
    const pre = await POST(`/api/accounts/${S.acct}/check`, p);
    p.entry = p.entry || pre.entry.toFixed(2);
    p.stop = pre.suggested.stop; p.target = pre.suggested.target;
  } else if (!p.target) {
    const pre = await POST(`/api/accounts/${S.acct}/check`, p);
    p.entry = p.entry || pre.entry.toFixed(2);
    const e = Number(p.entry), s = Number(p.stop);
    p.target = (e + 2 * (e - s)).toFixed(2);
  }
  const r = await POST(`/api/accounts/${S.acct}/check`, p);
  lastCheck = r;
  $("#c-ticker").value = r.ticker;
  $("#c-entry").value = (+r.entry).toFixed(2);
  $("#c-stop").value = (+r.stop).toFixed(2);
  $("#c-target").value = r.target ? (+r.target).toFixed(2) : "";
  renderCheck(r);
  $("#c-news").classList.remove("hidden");
  newsPanel($("#c-news"), r.ticker);
}

function renderCheck(r) {
  const m = r.metrics, sz = r.sizing, cur = r.quote.currency, br = m.base_rates;
  const native = (x) => isNum(x) ? `${num(x)} ${cur === "USD" ? "" : cur}` : "—";
  const name = r.info.shortName || r.info.longName || "";
  const em = (m.earnings_moves || []).slice(0, 8);
  $("#c-result").innerHTML = `
  <div class="verdict ${r.verdict}"><div class="big">${r.verdict}</div><div>${esc(r.verdict_text)}</div></div>
  <div class="grid g2">
    <div class="panel">
      <h3 style="margin-top:0"><a href="#chart?t=${encodeURIComponent(r.ticker)}">${esc(r.ticker)}</a> <span class="muted">${esc(name)} · ${esc(r.info.sector || "")}</span></h3>
      <div class="grid g3">
        <div class="card"><div class="k">Buy</div><div class="v">${qty(sz.shares)} sh</div><div class="small muted">≈ ${usd(sz.cost_usd)}</div></div>
        <div class="card"><div class="k">Max loss at stop</div><div class="v bad">${usd(sz.risk_usd)}</div><div class="small muted">${pct(sz.risk_usd / r.equity, 2)} of account</div></div>
        <div class="card"><div class="k">Reward:risk</div><div class="v">${isNum(m.rr) ? m.rr.toFixed(1) + ":1" : "—"}</div><div class="small muted">stop ${pct(m.stop_pct)} · ${isNum(m.stop_atr) ? m.stop_atr.toFixed(1) + "× ATR" : ""}</div></div>
      </div>
      <p class="small muted">Live ${native(r.quote.price)} (${pct(r.quote.change_pct, 1, true)} today${r.quote.open ? "" : ", market closed"})${cur !== "USD" ? ` · 1 ${cur} = $${r.fx.toFixed(4)}` : ""}. Size limited by: <b>${esc(sz.limited_by)}</b>. Account equity ${usd(r.equity)}, cash ${usd(r.cash)}.</p>
      <ul class="flags">${r.flags.map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join("")}</ul>
      <div class="row" style="margin-top:14px">
        <button class="primary" id="c-buy">${isPaper() ? "Save plan & paper-buy now" : "Save plan & record my buy"}</button>
        <button id="c-save">Save plan only (buy later)</button>
      </div>
      <div id="c-fill" class="hidden" style="margin-top:12px"></div>
    </div>
    <div class="panel">
      <div class="chartbox"><canvas id="c-chart"></canvas></div>
      <div class="grid g3" style="margin-top:12px">
        <div class="card"><div class="k">Typical ${r.hold_days}-day move</div><div class="v">±${pct(m.typical_move_hold, 0)}</div></div>
        <div class="card"><div class="k">ATR (avg daily range)</div><div class="v">${pct(m.atr_pct, 1)}</div></div>
        <div class="card"><div class="k">Worst day (1y)</div><div class="v bad">${pct(Math.expm1(m.worst_day_1y || 0), 0)}</div></div>
        <div class="card"><div class="k">From 52-week high</div><div class="v">${pct(m.from_52w_high, 0)}</div></div>
        <div class="card"><div class="k">Biggest fall (5y)</div><div class="v bad">${pct(m.max_dd_5y, 0)}</div></div>
        <div class="card"><div class="k">Beta vs S&amp;P 500</div><div class="v">${isNum(m.beta) ? m.beta.toFixed(2) : "—"}</div></div>
      </div>
      ${br && br.samples ? `<h3>If you'd placed this exact stop/target on any day in the last 3 years</h3>
        <div class="bar">
          <div style="width:${br.target_first * 100}%;background:var(--good)">target ${pct(br.target_first, 0)}</div>
          <div style="width:${br.neither * 100}%;background:#556">neither ${pct(br.neither, 0)}</div>
          <div style="width:${br.stop_first * 100}%;background:var(--bad)">stop ${pct(br.stop_first, 0)}</div>
        </div>
        <p class="small muted">Average outcome ${rmult(br.expected_r)} per trade over ${br.samples} start days. Your reason for
        buying has to be better than this random-day baseline.</p>` : ""}
      <h3>Earnings</h3>
      <p>${m.next_earnings ? `Next: <b>${esc(m.next_earnings)}</b>${isNum(m.earnings_in_days) ? ` (in ${m.earnings_in_days} trading days)` : ""}` : "Next date unknown."}
      ${isNum(m.avg_earnings_move) ? ` · average move on earnings: <b>±${pct(m.avg_earnings_move, 1)}</b>` : ""}</p>
      ${em.length ? `<div class="small muted">${em.map((e) => `${e.date}: <span class="${cls(e.move)}">${pct(e.move, 1, true)}</span>`).join(" · ")}</div>` : ""}
    </div>
  </div>`;
  const ch = r.chart;
  const flat = (v) => ch.map(() => v);
  lineChart("c-chart", ch.map((p) => p.t), [
    { label: r.ticker, data: ch.map((p) => p.c), borderColor: "#4c8dff" },
    { label: "entry", data: flat(r.entry), borderColor: "#8b95a3", borderDash: [4, 4], borderWidth: 1 },
    { label: "stop", data: flat(r.stop), borderColor: "#e5534b", borderDash: [4, 4], borderWidth: 1 },
    ...(r.target ? [{ label: "target", data: flat(r.target), borderColor: "#2fbf71", borderDash: [4, 4], borderWidth: 1 }] : []),
  ]);
  $("#c-save").onclick = (e) => guard(async () => {
    const { id } = await POST(`/api/accounts/${S.acct}/plans`, checkPayload());
    toast(`Plan #${id} saved. Buy it from the Portfolio tab when you're ready.`);
    location.hash = "#portfolio";
  }, e.target);
  $("#c-buy").onclick = () => {
    if (isPaper()) return guard(async () => {
      const { id } = await POST(`/api/accounts/${S.acct}/plans`, checkPayload());
      if (!(await buyPost(`/api/plans/${id}/buy`, {}))) { toast(`Not bought. Plan #${id} is saved as planned.`); return; }
      toast("Paper buy filled.");
      refreshHeader();
      location.hash = "#portfolio";
    }, $("#c-buy"));
    if (acct()?.broker === "alpaca") toast("Linked to Alpaca: fills sync automatically. You can save the plan and let the sync record the buy.");
    const f = $("#c-fill");
    f.classList.remove("hidden");
    f.innerHTML = `<div class="hint">Place the order at your broker first, then enter what you actually got.</div>
      <div class="row"><div><label>Shares filled</label><input id="f-qty" type="number" step="any" value="${sz.shares}"></div>
      <div><label>Fill price (${esc(cur)})</label><input id="f-px" type="number" step="any" value="${(+r.entry).toFixed(2)}"></div>
      <div><label>Fees ($)</label><input id="f-fee" type="number" step="any" value="0"></div>
      <div style="align-self:end"><button class="primary" id="f-go">Record buy</button></div></div>`;
    $("#f-go").onclick = (e) => guard(async () => {
      const { id } = await POST(`/api/accounts/${S.acct}/plans`, Object.assign(checkPayload(), { shares: $("#f-qty").value }));
      if (!(await buyPost(`/api/plans/${id}/buy`, { qty: $("#f-qty").value, price: $("#f-px").value, fees: $("#f-fee").value }))) {
        toast(`Not recorded. Plan #${id} is saved as planned.`); return;
      }
      toast("Buy recorded.");
      refreshHeader();
      location.hash = "#portfolio";
    }, e.target);
  };
}

// ---------- Portfolio ----------
VIEWS.portfolio = async function () {
  const [st, cv] = await Promise.all([GET(`/api/accounts/${S.acct}/state`), GET(`/api/accounts/${S.acct}/curve`)]);
  const open = st.plans.filter((p) => p.status === "open");
  const planned = st.plans.filter((p) => p.status === "planned");
  const vsSpy = isNum(cv.value) && isNum(cv.spy) ? cv.value - cv.spy : null;
  const a = acct();
  $("#view").innerHTML = `
  ${a?.broker ? `<div class="row small muted" style="margin-bottom:10px">${a.broker === "alpaca" ? "Linked to Alpaca" : "CSV imports"} · ${esc(a.sync_status || "")}${a.synced_at ? " · " + esc(String(a.synced_at).slice(0, 16).replace("T", " ")) : ""}
    ${a.broker === "alpaca" ? `<button class="sm" id="p-sync">Sync now</button>` : `<a href="#settings">import more</a>`}</div>` : ""}
  <div class="kpis">
    <div class="kpi"><div class="k">Account value</div><div class="v">${usd(st.equity)}</div></div>
    <div class="kpi"><div class="k">Cash</div><div class="v">${usd(st.cash)}</div></div>
    <div class="kpi"><div class="k">Profit / loss (all time)</div><div class="v ${cls(st.total_pnl)}">${usd(st.total_pnl)}</div><div class="s">${pct(st.deposits ? st.total_pnl / st.deposits : null, 1, true)} on ${usd(st.deposits, 0)} deposited</div></div>
    <div class="kpi"><div class="k">vs. same money in S&amp;P 500</div><div class="v ${cls(vsSpy)}">${usd(vsSpy)}</div><div class="s">SPY would be ${usd(cv.spy)}</div></div>
    <div class="kpi"><div class="k">Open risk (to stops)</div><div class="v ${st.heat_pct > S.settings.max_heat_pct ? "warn" : ""}">${usd(st.heat)}</div><div class="s">${pct(st.heat_pct, 1)} of account (limit ${pct(S.settings.max_heat_pct, 0)})</div></div>
  </div>
  <div class="panel"><div class="ph"><h2>Account vs. S&amp;P 500</h2>
    <span class="small muted">Max drawdown ${pct(cv.max_drawdown, 1)}</span></div>
    ${cv.points.length > 1 ? `<div class="chartbox"><canvas id="p-curve"></canvas></div>` : `<div class="empty small">The chart starts filling in after your first trading day.</div>`}
  </div>
  <div class="panel"><h2>Open trades</h2>
    ${open.length ? `<div class="tablewrap"><table><tr><th>Ticker</th><th class="num">Shares</th><th class="num">Entry</th><th class="num">Price</th><th class="num">P/L</th><th class="num">Now</th><th style="min-width:190px">Stop → target</th><th class="num">Days</th><th></th></tr>
      ${open.map((p) => `<tr>
        <td><a href="#chart?t=${encodeURIComponent(p.ticker)}"><b>${esc(p.ticker)}</b></a> <span class="small muted">#${p.id}${p.setup ? " · " + esc(p.setup) : ""}</span>${p.trail_json ? ' <span class="pill" title="trailing / scale-out rules active">auto</span>' : ""}</td>
        <td class="num">${qty(p.qty_open)}</td><td class="num">${num(p.avg_entry)}</td><td class="num">${num(p.price)}</td>
        <td class="num">${money(p.unrealized)}</td><td class="num ${cls(p.r_multiple)}">${rmult(p.r_multiple)}</td>
        <td title="stop ${num(p.stop)} (${pct(p.to_stop_pct, 1)}) · target ${num(p.target)} (${pct(p.to_target_pct, 1, true)})">${progBar(p.stop, p.avg_entry, p.target, p.price)}</td>
        <td class="num">${p.hold_days ?? 0}<span class="small muted"> / ${p.hold_days_plan ?? "—"}d</span></td>
        <td><button class="sm" data-sell="${p.id}">Sell</button> <button class="sm" data-edit="${p.id}">Stop/target</button> <button class="sm" data-view="${p.id}">Plan</button></td>
      </tr>`).join("")}</table></div>` : `<div class="empty">No open trades. Run a <a href="#check">pre-trade check</a> to start one.</div>`}
  </div>
  ${planned.length ? `<div class="panel"><h2>Planned (not bought yet)</h2><div class="tablewrap"><table><tr><th>Ticker</th><th class="num">Shares</th><th class="num">Entry</th><th class="num">Stop</th><th class="num">Target</th><th class="num">Price now</th><th>Saved</th><th></th></tr>
    ${planned.map((p) => `<tr><td><a href="#chart?t=${encodeURIComponent(p.ticker)}"><b>${esc(p.ticker)}</b></a> <span class="small muted">#${p.id}</span></td><td class="num">${qty(p.shares)}</td><td class="num">${num(p.entry)}</td><td class="num">${num(p.stop)}</td><td class="num">${num(p.target)}</td><td class="num">${num(p.price)}</td><td>${date(p.created_at)}</td>
      <td><button class="sm primary" data-buy="${p.id}">Buy</button> <button class="sm" data-view="${p.id}">Plan</button> <button class="sm danger" data-cancel="${p.id}">Cancel</button></td></tr>`).join("")}
  </table></div></div>` : ""}
  <div class="panel"><h2>Holdings by ticker</h2>
    ${st.positions.length ? `<div class="tablewrap"><table><tr><th>Ticker</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Today</th><th class="num">Value</th><th class="num">Cost basis</th><th class="num">Unrealized</th><th class="num">% of account</th><th class="num">Long-term in</th></tr>
      ${st.positions.map((p) => `<tr><td>${tkLink(p.ticker)}${p.currency !== "USD" ? ` <span class="small muted">${esc(p.currency)}</span>` : ""}</td><td class="num">${qty(p.qty)}</td><td class="num">${num(p.avg_cost_native)}</td><td class="num">${num(p.price)}</td>
        <td class="num">${delta(p.day_change_pct)}</td><td class="num">${usd(p.value)}</td><td class="num">${usd(p.cost)}</td>
        <td class="num">${money(p.unrealized)} <span class="small ${cls(p.unrealized_pct)}">${pct(p.unrealized_pct, 1, true)}</span></td>
        <td class="num">${pct((p.value || p.cost) / st.equity, 0)}</td><td class="num">${p.days_to_long_term ? p.days_to_long_term + " days" : "now"}</td></tr>`).join("")}
    </table></div>` : `<div class="empty small">Nothing held.</div>`}
  </div>
  <div class="panel"><h2>${isPaper() ? "Paper cash" : "Deposits & withdrawals"}</h2>
    <p class="small muted">${isPaper() ? "Top up or reset your practice money." : "Record money you move into or out of your broker so profit and the S&P comparison stay accurate."}</p>
    <div class="row"><input id="cm-amt" type="number" step="any" placeholder="amount, negative to withdraw" style="max-width:240px"><input id="cm-note" placeholder="note" style="max-width:240px"><button id="cm-go">Add</button></div>
  </div>`;
  if (cv.points.length > 1) {
    lineChart("p-curve", cv.points.map((p) => p.t), [
      { label: "Your account", data: cv.points.map((p) => p.value), borderColor: "#4c8dff" },
      { label: "Same deposits in SPY", data: cv.points.map((p) => p.spy), borderColor: "#8b95a3" },
      { label: "Deposited", data: cv.points.map((p) => p.deposits), borderColor: "#444b55", borderDash: [3, 3], borderWidth: 1 },
    ]);
  }
  const byId = Object.fromEntries(st.plans.map((p) => [p.id, p]));
  $("#view").querySelectorAll("[data-sell]").forEach((b) => (b.onclick = () => tradeModal(byId[b.dataset.sell], "sell")));
  $("#view").querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => tradeModal(byId[b.dataset.buy], "buy")));
  $("#view").querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editLevelsModal(byId[b.dataset.edit])));
  $("#view").querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => planModal(b.dataset.view)));
  $("#view").querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => guard(async () => {
    await PATCH(`/api/plans/${b.dataset.cancel}`, { status: "cancelled" }); toast("Plan cancelled."); route();
  }, b)));
  if ($("#p-sync")) $("#p-sync").onclick = (e) => guard(async () => {
    const r = await POST(`/api/accounts/${S.acct}/sync`);
    S.accounts = await GET("/api/accounts"); syncResult(S.acct, r); route();
  }, e.target);
  $("#cm-go").onclick = (e) => guard(async () => {
    await POST(`/api/accounts/${S.acct}/cash`, { amount: $("#cm-amt").value, note: $("#cm-note").value });
    toast("Saved."); refreshHeader(); route();
  }, e.target);
};

const EXIT_REASONS = ["hit target", "hit stop", "thesis broken", "time exit", "trailing stop", "took profit early", "fear / nerves", "needed the cash", "other"];

function tradeModal(p, side) {
  const paper = isPaper();
  const defQty = side === "sell" ? p.qty_open : p.shares;
  openModal(`<h2>${side === "buy" ? "Buy" : "Sell"} ${esc(p.ticker)} <span class="muted small">plan #${p.id}</span></h2>
    ${paper ? `<div class="hint">Paper account: fills at the live price (plus ${S.settings.paper_slippage_bps} bps slippage).</div>`
            : `<div class="hint">Place the order at your broker first, then record the fill here.</div>`}
    <div class="form">
      <div class="span2"><label>Shares</label><input id="t-qty" type="number" step="any" value="${defQty}"></div>
      ${paper ? "" : `<div class="span2"><label>Fill price</label><input id="t-px" type="number" step="any" value="${p.price ? (+p.price).toFixed(2) : ""}"></div>
      <div class="span2"><label>Fees ($)</label><input id="t-fee" type="number" step="any" value="0"></div>`}
      ${side === "sell" ? `<div class="span3"><label>Why are you selling?</label><select id="t-reason">${EXIT_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></div>
      <div class="span3"><label>Did you follow your plan?</label><select id="t-followed"><option value="">–</option><option value="1">Yes</option><option value="0">No</option></select></div>
      <div class="span6"><label>Lesson / note (shown in your journal)</label><textarea id="t-lesson"></textarea></div>` : ""}
    </div>
    <div class="row" style="margin-top:14px"><button class="primary" id="t-go">${side === "buy" ? "Buy" : "Sell"}</button><button onclick="closeModal()">Cancel</button></div>`);
  $("#t-go").onclick = (e) => guard(async () => {
    const body = { qty: $("#t-qty").value, price: $("#t-px")?.value, fees: $("#t-fee")?.value };
    if (side === "buy") {
      if (!(await buyPost(`/api/plans/${p.id}/buy`, body))) return;
    } else await POST(`/api/plans/${p.id}/sell`, body);
    if (side === "sell") {
      await PATCH(`/api/plans/${p.id}`, { exit_reason: $("#t-reason").value, followed_plan: $("#t-followed").value, lesson: $("#t-lesson").value });
    }
    closeModal(); toast(side === "buy" ? "Bought." : "Sold."); refreshHeader(); route();
  }, e.target);
}

function editLevelsModal(p) {
  openModal(`<h2>${esc(p.ticker)}: stop &amp; target</h2>
    <div class="hint">Moving a stop <b>up</b> to lock in gains (a trailing stop) is fine. Moving it <b>down</b> to avoid taking a loss is the
    classic way small losses become big ones, so the journal records it as breaking your plan.</div>
    <div class="form"><div class="span3"><label>Stop (was ${num(p.stop)})</label><input id="e-stop" type="number" step="any" value="${p.stop}"></div>
    <div class="span3"><label>Target (was ${num(p.target)})</label><input id="e-target" type="number" step="any" value="${p.target ?? ""}"></div></div>
    <h3>Automatic management</h3><div class="form">${trailInputs("e", JSON.parse(p.trail_json || "null"))}</div>
    <div class="row" style="margin-top:14px"><button class="primary" id="e-go">Save</button></div>`);
  $("#e-go").onclick = (e) => guard(async () => {
    const ns = Number($("#e-stop").value);
    const body = { stop: $("#e-stop").value, target: $("#e-target").value, trail: readTrail("e") };
    if (ns < p.stop) body.followed_plan = 0;
    await PATCH(`/api/plans/${p.id}`, body);
    closeModal(); toast(ns < p.stop ? "Saved. Stop lowered, so this is marked as breaking your plan." : "Saved."); route();
  }, e.target);
}

async function planModal(id) {
  const p = await GET(`/api/plans/${id}`);
  const c = p.check || {};
  openModal(`<h2>${esc(p.ticker)} plan #${p.id} <span class="pill ${p.status}">${p.status}</span></h2>
    <p class="small muted">Saved ${date(p.created_at)} · entry ${num(p.entry)} · stop ${num(p.stop)} · target ${num(p.target)} · hold ${p.hold_days}d · risk ${pct(p.risk_pct, 1)}${p.setup ? " · " + esc(p.setup) : ""}${p.confidence ? " · confidence " + p.confidence + "/5" : ""}</p>
    <p class="small"><a href="#chart?t=${encodeURIComponent(p.ticker)}" onclick="closeModal()">Open chart</a>${p.source === "broker" ? ' · <span class="warn">bought at the broker without a plan</span>' : ""}
      ${p.initial_stop && p.stop > p.initial_stop ? ` · stop raised from ${num(p.initial_stop)}` : ""}</p>
    ${p.trail ? `<p class="small">Auto-management: ${esc(trailText(p.trail))}${p.scaled ? " · <b>scale-out done</b>" : ""}</p>` : ""}
    ${p.override_reason ? `<div class="hint" style="border-left-color:var(--bad)">Bought despite a guardrail: “${esc(p.override_reason)}”</div>` : ""}
    ${p.status === "planned" && acct()?.broker === "alpaca" && acct()?.broker_info?.allow_orders ? `<div class="row" style="margin:8px 0">
      <input id="al-lim" type="number" step="any" placeholder="limit price (empty = market)" style="max-width:220px" value="${p.entry ?? ""}">
      <button class="primary" id="al-send">Send bracket order to Alpaca</button></div>` : ""}
    ${p.broker_order_id ? `<p class="small muted">Alpaca order ${esc(p.broker_order_id)}</p>` : ""}
    <h3>Why I bought</h3><p>${esc(p.thesis) || '<span class="muted">(nothing written)</span>'}</p>
    ${c.verdict ? `<h3>The check said: <span class="${c.verdict === "GO" ? "good" : c.verdict === "STOP" ? "bad" : "warn"}">${c.verdict}</span></h3>
      <ul class="flags">${(c.flags || []).map((f) => `<li class="${f.level}">${esc(f.text)}</li>`).join("")}</ul>` : ""}
    <h3>Fills</h3>
    ${p.trades.length ? `<table><tr><th>Date</th><th>Side</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Fees</th><th>Note</th></tr>
      ${p.trades.map((t) => `<tr><td>${date(t.ts)}</td><td>${t.side}</td><td class="num">${qty(t.qty)}</td><td class="num">${num(t.price)} ${t.currency !== "USD" ? esc(t.currency) : ""}</td><td class="num">${usd(t.fees)}</td><td class="small muted">${esc(t.note)}</td></tr>`).join("")}</table>` : `<p class="muted">None yet.</p>`}
    ${p.after_exit ? `<h3>After you sold</h3>
      <p class="small">Price relative to your exit, in R: 5 days <b class="${cls(p.after_exit.close5_r)}">${rmult(p.after_exit.close5_r)}</b> ·
        10 days <b class="${cls(p.after_exit.close10_r)}">${rmult(p.after_exit.close10_r)}</b> · 20 days <b class="${cls(p.after_exit.close20_r)}">${rmult(p.after_exit.close20_r)}</b>
        · best ${rmult(p.after_exit.max_r)} / worst ${rmult(p.after_exit.min_r)} within 10 days.</p>
      <p class="small muted">Positive means it kept rising after you got out. One trade says little; the Stats tab adds them up by exit reason.</p>` : ""}
    <h3>Review</h3>
    <div class="form">
      <div class="span2"><label>Exit reason</label><select id="r-reason"><option value="">–</option>${EXIT_REASONS.map((r) => `<option ${p.exit_reason === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
      <div class="span2"><label>Followed the plan?</label><select id="r-followed"><option value="">–</option><option value="1" ${p.followed_plan === 1 ? "selected" : ""}>Yes</option><option value="0" ${p.followed_plan === 0 ? "selected" : ""}>No</option></select></div>
      <div class="span2"><label>Setup tag</label><input id="r-setup" value="${esc(p.setup || "")}"></div>
      <div class="span6"><label>Lesson</label><textarea id="r-lesson">${esc(p.lesson || "")}</textarea></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="primary" id="r-go">Save review</button></div>`);
  if ($("#al-send")) $("#al-send").onclick = (e) => guard(async () => {
    const r = await POST(`/api/plans/${id}/alpaca_order`, { limit: $("#al-lim").value });
    toast(`Alpaca order ${r.status}: ${r.qty} shares. The fill shows up on the next sync.`); planModal(id);
  }, e.target);
  $("#r-go").onclick = (e) => guard(async () => {
    await PATCH(`/api/plans/${id}`, { exit_reason: $("#r-reason").value || null, followed_plan: $("#r-followed").value,
      lesson: $("#r-lesson").value, setup: $("#r-setup").value || null });
    closeModal(); toast("Review saved."); route();
  }, e.target);
}

// ---------- Journal ----------
VIEWS.journal = async function () {
  const j = await GET(`/api/accounts/${S.acct}/journal`);
  const needs = j.plans.filter((p) => p.status === "closed" && (p.followed_plan === null || !p.exit_reason));
  $("#view").innerHTML = `
  <div class="panel"><h2>Journal</h2>
    ${needs.length ? `<div class="hint">${needs.length} closed trade${needs.length > 1 ? "s" : ""} still need a review. Reviews power the "followed plan vs broke plan" stats.</div>` : ""}
    ${j.plans.length ? `<div class="tablewrap"><table><tr><th>#</th><th>Ticker</th><th>Status</th><th>Opened</th><th class="num">Days</th><th class="num">Entry → exit</th><th class="num">P/L</th><th class="num">Return</th><th class="num">R</th><th>Setup</th><th>Exit</th><th>Why</th></tr>
    ${j.plans.map((p) => `<tr class="click" data-id="${p.id}"><td class="muted">${p.id}</td><td><b>${esc(p.ticker)}</b></td>
      <td><span class="pill ${p.status}">${p.status}</span>${p.source === "broker" ? ' <span class="pill review" title="came from a broker fill with no saved plan">unplanned</span>' : ""}${needs.includes(p) ? ' <span class="pill review">review</span>' : ""}</td>
      <td>${date(p.first_buy || p.created_at)}</td><td class="num">${p.hold_days ?? "—"}</td>
      <td class="num">${num(p.avg_entry ?? p.entry)} → ${p.avg_exit ? num(p.avg_exit) : "…"}</td>
      <td class="num">${money(p.status === "closed" ? p.realized : (p.realized || 0) + (p.unrealized || 0))}</td>
      <td class="num ${cls(p.return_pct)}">${pct(p.return_pct, 1, true)}</td><td class="num ${cls(p.r_multiple)}">${rmult(p.r_multiple)}</td>
      <td>${esc(p.setup || "")}</td><td class="small">${esc(p.exit_reason || "")}${p.followed_plan === 0 ? ' <span class="bad">broke plan</span>' : ""}</td>
      <td class="small muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(p.thesis || "")}</td></tr>`).join("")}
    </table></div>` : `<div class="empty">No trades yet.</div>`}
  </div>`;
  $("#view").querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => planModal(tr.dataset.id)));
};

// ---------- Stats & tax ----------
VIEWS.stats = async function () {
  const j = await GET(`/api/accounts/${S.acct}/journal`);
  const s = j.stats;
  const grp = (title, g) => `<div><h3>${title}</h3><table><tr><th></th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Avg R</th><th class="num">P/L</th></tr>
    ${Object.entries(g || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num">${pct(v.win_rate, 0)}</td><td class="num ${cls(v.avg_r)}">${rmult(v.avg_r)}</td><td class="num">${money(v.pnl)}</td></tr>`).join("")}</table></div>`;
  $("#view").innerHTML = `
  <div class="panel"><h2>How you're trading</h2>
    ${s.closed ? `<div class="grid g4">
      <div class="card"><div class="k">Closed trades</div><div class="v">${s.closed}</div></div>
      <div class="card"><div class="k">Win rate</div><div class="v">${pct(s.win_rate, 0)}</div></div>
      <div class="card"><div class="k">Avg win / avg loss</div><div class="v"><span class="good">${pct(s.avg_win_pct, 1, true)}</span> / <span class="bad">${pct(s.avg_loss_pct, 1)}</span></div></div>
      <div class="card"><div class="k">Expectancy per trade</div><div class="v ${cls(s.avg_r)}">${rmult(s.avg_r)}</div><div class="small muted">avg result in units of risk</div></div>
      <div class="card"><div class="k">Profit factor</div><div class="v">${isNum(s.profit_factor) ? s.profit_factor.toFixed(2) : "—"}</div><div class="small muted">gross wins ÷ gross losses</div></div>
      <div class="card"><div class="k">Total realized</div><div class="v ${cls(s.total_pnl)}">${usd(s.total_pnl)}</div></div>
      <div class="card"><div class="k">Best / worst</div><div class="v"><span class="${cls(s.best)}">${usd(s.best)}</span> / <span class="${cls(s.worst)}">${usd(s.worst)}</span></div></div>
      <div class="card"><div class="k">Avg hold</div><div class="v">${s.avg_hold_days.toFixed(1)} days</div></div>
    </div>
    ${s.closed < 20 ? `<p class="small muted">With ${s.closed} trade${s.closed > 1 ? "s" : ""} these numbers are mostly luck. Judge a strategy after 20–30 trades.</p>` : ""}
    <div class="grid g2" style="margin-top:18px"><div><h3>Daily realized P/L (last 6 months)</h3>${pnlHeat(j.realized)}</div>
      <div><h3>Trade results in R</h3><div class="chartbox" style="height:200px"><canvas id="st-r"></canvas></div></div></div>
    <div class="grid g3">${grp("By setup", s.by_setup)}${grp("Discipline", s.by_followed)}${grp("By exit reason", s.by_exit)}</div>
    ${s.by_override ? `<div class="grid g3">${grp("Guardrails &amp; unplanned trades", s.by_override)}</div>` : ""}`
    : `<div class="empty">Close a few trades and your stats show up here: win rate, average R, and whether following your plans pays.</div>`}
  </div>
  ${j.after_exit && j.after_exit.n ? `<div class="panel"><h2>After you sell</h2>
    <p>Across ${j.after_exit.n} exits, 10 trading days later the price was on average <b class="${cls(j.after_exit.avg_close10_r)}">${rmult(j.after_exit.avg_close10_r)}</b>
      from where you sold (median ${rmult(j.after_exit.median_close10_r)}), and higher ${pct(j.after_exit.share_higher, 0)} of the time.</p>
    <p class="small muted">If one exit reason keeps showing a big positive number, those exits are leaving money on the table (often "fear / nerves" or "took profit early").
      If it's near zero or negative, the exits are fine.</p>
    <table><tr><th>Exit reason</th><th class="num">Exits</th><th class="num">Avg 10 days later</th></tr>
      ${Object.entries(j.after_exit.by_exit).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.n}</td><td class="num ${cls(v.avg_close10_r)}">${rmult(v.avg_close10_r)}</td></tr>`).join("")}</table></div>` : ""}
  <div class="panel"><h2>Taxes (US federal estimate)</h2>
    <div class="hint">Short-term gains (held ≤ 1 year) are taxed at your income rate (set to ${pct(S.settings.st_tax_rate, 0)} in Settings);
    long-term at ${pct(S.settings.lt_tax_rate, 0)}. Net losses offset up to $3,000 of other income a year; the rest carries forward.
    ${isPaper() ? "<b>This is a paper account, so these are what the taxes would be.</b>" : ""} Rough guide only; your broker's 1099-B is the real thing.
    Living in Sweden can also create Swedish tax obligations; check before trading real money.</div>
    ${j.taxes.length ? `<table><tr><th>Year</th><th class="num">Sales</th><th class="num">Short-term</th><th class="num">Long-term</th><th class="num">Net</th><th class="num">Est. tax</th><th class="num">Deductible loss</th><th class="num">Carryover</th><th class="num">Wash-sale disallowed</th></tr>
      ${j.taxes.map((t) => `<tr><td>${t.year}</td><td class="num">${t.sales}</td><td class="num">${money(t.short_term)}</td><td class="num">${money(t.long_term)}</td><td class="num">${money(t.net)}</td><td class="num">${usd(t.est_tax)}</td><td class="num">${usd(t.deductible_loss)}</td><td class="num">${usd(t.carryover)}</td><td class="num ${t.wash_disallowed ? "warn" : ""}">${usd(t.wash_disallowed)}</td></tr>`).join("")}</table>`
      : `<div class="empty small">No sales yet.</div>`}
    ${j.realized.length ? `<h3>Realized lots (FIFO)</h3><div class="tablewrap"><table><tr><th>Sold</th><th>Ticker</th><th class="num">Shares</th><th>Bought</th><th class="num">Days</th><th>Term</th><th class="num">Cost</th><th class="num">Proceeds</th><th class="num">Gain</th><th></th></tr>
      ${j.realized.map((r) => `<tr><td>${date(r.close_ts)}</td><td>${esc(r.ticker)}</td><td class="num">${qty(r.qty)}</td><td>${date(r.open_ts)}</td><td class="num">${r.days}</td><td>${r.term}</td><td class="num">${usd(r.cost)}</td><td class="num">${usd(r.proceeds)}</td><td class="num">${money(r.gain)}</td>
        <td>${r.wash_sale ? `<span class="pill review" title="Bought again within 30 days of selling at a loss; ${usd(r.wash_disallowed)} of the loss is deferred">wash sale</span>` : ""}</td></tr>`).join("")}</table></div>` : ""}
  </div>
  <div class="panel"><h2>Fill log</h2>
    ${j.trades.length ? `<div class="tablewrap"><table><tr><th>Date</th><th>Ticker</th><th>Side</th><th class="num">Shares</th><th class="num">Price</th><th class="num">USD value</th><th class="num">Fees</th><th>Plan</th><th>Note</th></tr>
      ${j.trades.map((t) => `<tr><td>${String(t.ts).slice(0, 16).replace("T", " ")}</td><td>${tkLink(t.ticker)}</td><td>${t.side}</td><td class="num">${qty(t.qty)}</td><td class="num">${num(t.price)} ${t.currency !== "USD" ? esc(t.currency) : ""}</td><td class="num">${usd(t.qty * t.price * t.fx)}</td><td class="num">${usd(t.fees)}</td><td>#${t.plan_id ?? ""}</td><td class="small muted">${esc(t.note)}</td></tr>`).join("")}</table></div>` : `<div class="empty small">No fills yet.</div>`}
  </div>`;
  rHistogram("st-r", j.plans);
  const hm = $("#view .heat"); if (hm) hm.scrollLeft = hm.scrollWidth;  // newest weeks in view on small screens
};

// Calendar heatmap of realized P/L per weekday, newest column on the right.
function pnlHeat(realized) {
  const byDay = {};
  (realized || []).forEach((r) => { const d = String(r.close_ts).slice(0, 10); byDay[d] = (byDay[d] || 0) + (r.gain || 0); });
  const end = new Date(); end.setHours(12, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - 7 * 26 - ((end.getDay() + 6) % 7));
  const vals = Object.values(byDay), mx = Math.max(1, ...vals.map(Math.abs));
  let cells = "";
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, v = byDay[k];
    const a = isNum(v) ? (0.25 + 0.75 * Math.min(1, Math.abs(v) / mx)).toFixed(2) : 0;
    cells += `<i title="${k}${isNum(v) ? ": " + usd(v) : ""}" style="${isNum(v) ? `background:${v >= 0 ? "var(--good)" : "var(--bad)"};opacity:${a}` : ""}"></i>`;
  }
  const days = vals.length, green = vals.filter((v) => v > 0).length;
  return `<div class="heat">${cells}</div><div class="heat-legend"><i style="background:var(--bad)"></i> loss <i style="background:var(--panel3)"></i> no sales
    <i style="background:var(--good)"></i> gain <span style="margin-left:auto">${days ? `${green}/${days} green days · best ${usd(Math.max(...vals))} · worst ${usd(Math.min(...vals))}` : ""}</span></div>`;
}
function rHistogram(id, plans) {
  const rs = plans.filter((p) => p.status === "closed" && isNum(p.r_multiple)).map((p) => p.r_multiple);
  const edges = []; for (let x = -3; x < 5; x += 0.5) edges.push(x);
  const counts = edges.map((e, i) => rs.filter((r) => (i === 0 ? r < e + 0.5 : i === edges.length - 1 ? r >= e : r >= e && r < e + 0.5)).length);
  if (S.charts[id]) S.charts[id].destroy();
  const el = document.getElementById(id); if (!el) return;
  S.charts[id] = new Chart(el, { type: "bar", data: { labels: edges.map((e, i) => (i === 0 ? "≤" : i === edges.length - 1 ? "≥" : "") + (e + (i === 0 ? 0.5 : 0)) + "R"),
      datasets: [{ data: counts, backgroundColor: edges.map((e) => (e < 0 ? cssv("--bad") : cssv("--good"))), borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: "#8b95a3", maxRotation: 0, autoSkip: true }, grid: { display: false } }, y: { ticks: { color: "#8b95a3", precision: 0 }, grid: { color: cssv("--grid") }, border: { display: false } } } } });
}

// ---------- Settings ----------
const SETTING_FIELDS = [
  ["risk_pct", "Risk per trade (% of account)", 100, "How much a stop-out may cost. 0.5–2% is the usual range."],
  ["max_position_pct", "Max single position (% of account)", 100, ""],
  ["max_heat_pct", "Max total open risk (% of account)", 100, "Sum of what you'd lose if every stop hit at once."],
  ["st_tax_rate", "Short-term tax rate (%)", 100, "Your federal ordinary-income bracket."],
  ["lt_tax_rate", "Long-term tax rate (%)", 100, ""],
  ["paper_slippage_bps", "Paper slippage (basis points)", 1, "Paper fills are this much worse than the live price."],
  ["paper_fee", "Paper fee per fill ($)", 1, ""],
  ["alert_earnings_days", "Earnings warning (days ahead)", 1, ""],
  ["alert_volume_mult", "Volume spike (× 50-day average)", 1, ""],
  ["alert_move_sigma", "Big move (× normal daily swing)", 1, ""],
  ["alert_fast_min", "Scan every (min) while markets are open", 1, ""],
  ["alert_slow_min", "Scan every (min) while closed", 1, ""],
];
const GUARD_FIELDS = [
  ["daily_loss_limit_pct", "Daily loss limit (% of account)", 100, "Realized losses past this block new buys until tomorrow. 0 = off."],
  ["weekly_loss_limit_pct", "Weekly loss limit (% of account)", 100, "Blocks new buys until Monday. 0 = off."],
  ["max_loss_streak", "Cooldown after this many losses in a row", 1, "0 = off."],
  ["cooldown_days", "Cooldown length (days)", 1, ""],
];
const TEXT_KEYS = ["ntfy_topic", "sec_user_agent", "timezone", "briefing_time", "screener_time", "public_url",
  "anthropic_api_key", "ai_model", "ai_fast_model", "access_pin"];
const onoff = (k, on = "On", off = "Off") => `<select data-k="${k}"><option value="1" ${S.settings[k] ? "selected" : ""}>${on}</option><option value="0" ${S.settings[k] ? "" : "selected"}>${off}</option></select>`;
const numField = ([k, label, mult, help]) => `<div class="span2"><label>${label}</label><input data-k="${k}" data-m="${mult}" type="number" step="any" value="${+(S.settings[k] * mult).toFixed(4)}"><div class="small muted">${help}</div></div>`;
VIEWS.settings = async function () {
  S.settings = await GET("/api/settings");
  const s = S.settings;
  $("#view").innerHTML = `<div class="panel"><h2>Risk rules</h2><div class="form">
    ${SETTING_FIELDS.map(numField).join("")}
    <div class="span2"><label>Fractional shares</label><select data-k="fractional"><option value="1" ${s.fractional ? "selected" : ""}>Allowed</option><option value="0" ${s.fractional ? "" : "selected"}>Whole shares only</option></select></div>
    <div class="span2"><label>Alert scanning</label><select data-k="alerts_enabled"><option value="1" ${s.alerts_enabled ? "selected" : ""}>On</option><option value="0" ${s.alerts_enabled ? "" : "selected"}>Off</option></select></div>
    <div class="span2"><label>Paper: exit automatically at stop/target</label><select data-k="paper_auto_exit"><option value="1" ${s.paper_auto_exit ? "selected" : ""}>Yes (practice discipline)</option><option value="0" ${s.paper_auto_exit ? "" : "selected"}>No</option></select></div>
  </div></div>
  <div class="panel"><h2>Guardrails</h2><div class="hint">Rules for the moments when discipline is hardest. A blocked buy can still go through,
    but only after you write down why, and the journal keeps score of how those trades do.</div><div class="form">
    ${GUARD_FIELDS.map(numField).join("")}
    <div class="span2"><label>Block adding to a losing position</label>${onoff("block_avg_down", "Yes", "No")}</div>
  </div></div>
  <div class="panel"><h2>Briefing, reports &amp; AI</h2><div class="form">
    <div class="span2"><label>Morning briefing push</label>${onoff("briefing_enabled")}</div>
    <div class="span2"><label>Briefing time (weekdays)</label><input data-k="briefing_time" type="time" value="${esc(s.briefing_time)}"></div>
    <div class="span2"><label>Your time zone</label><input data-k="timezone" value="${esc(s.timezone)}"><div class="small muted">e.g. Europe/Stockholm, America/New_York</div></div>
    <div class="span2"><label>Screener + weekly report time</label><input data-k="screener_time" type="time" value="${esc(s.screener_time)}"><div class="small muted">After the US close. Weekly report runs Fridays.</div></div>
    <div class="span2"><label>Weekly report</label>${onoff("weekly_report")}</div>
    <div class="span2"><label>Coach note with the weekly report</label>${onoff("coach_weekly")}</div>
    <div class="span3"><label>Anthropic API key (for news summaries + coach)</label><input data-k="anthropic_api_key" type="password" autocomplete="off" value="${esc(s.anthropic_api_key)}" placeholder="sk-ant-…"><div class="small muted">From console.anthropic.com. Stored only in this computer's database. A weekly coach run costs a few cents.</div></div>
    <div class="span3"><label>Models (coach · summaries)</label><div class="row"><input data-k="ai_model" value="${esc(s.ai_model)}"><input data-k="ai_fast_model" value="${esc(s.ai_fast_model)}"></div></div>
  </div></div>
  <div class="panel"><h2>Phone app</h2><div class="hint">Open the cockpit on your phone and use <b>Add to Home Screen</b>. To reach it away from home, run it behind
    Tailscale (see SETUP.md). Anything not coming from this computer has to enter the PIN.</div><div class="form">
    <div class="span3"><label>Access PIN (required for phone access)</label><input data-k="access_pin" type="password" autocomplete="new-password" value="${esc(s.access_pin)}" placeholder="not set"></div>
    <div class="span3"><label>Public URL (for links in push notifications)</label><input data-k="public_url" value="${esc(s.public_url)}" placeholder="https://your-pc.tailnet-name.ts.net"></div>
  </div></div>
  <div class="panel" id="s-accounts"></div>
  <div class="panel"><h2>Phone alerts &amp; data</h2><div class="form">
    <div class="span3"><label>ntfy topic</label><input data-k="ntfy_topic" value="${esc(s.ntfy_topic)}" placeholder="generated on first start"><div class="small muted">Install the ntfy app and subscribe to this topic. Keep it secret: anyone with the name can read your alerts.</div></div>
    <div class="span3"><label>SEC contact (for insider-buy alerts)</label><input data-k="sec_user_agent" value="${esc(s.sec_user_agent)}" placeholder="Your Name you@example.com"><div class="small muted">The SEC asks automated tools to identify themselves with a name and email. Leave empty to skip insider alerts.</div></div>
  </div></div>
  <button class="primary" id="s-save">Save settings</button> <button id="s-test">Send test alert</button>`;
  $("#s-save").onclick = (e) => guard(async () => {
    const out = {};
    $("#view").querySelectorAll("[data-k]").forEach((el) => {
      const k = el.dataset.k;
      if (TEXT_KEYS.includes(k)) out[k] = el.value.trim();
      else if (el.dataset.m) out[k] = Number(el.value) / Number(el.dataset.m);
      else out[k] = Number(el.value);
    });
    S.settings = await POST("/api/settings", out);
    toast("Settings saved.");
  }, e.target);
  accountsPanel($("#s-accounts"));
  $("#s-test").onclick = (e) => guard(async () => { await POST("/api/alerts/test"); toast("Test alert sent. Check your phone."); }, e.target);
};

window.addEventListener("DOMContentLoaded", boot);
