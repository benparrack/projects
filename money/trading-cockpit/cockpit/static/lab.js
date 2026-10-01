// Strategy lab: write a rule, backtest it against random entries, save it as an alert.
"use strict";

let labMeta = null, labLast = null;

VIEWS.lab = async function () {
  labMeta = labMeta || (await GET("/api/lab/meta"));
  const saved = await GET("/api/lab/strategies");
  const m = labMeta;
  $("#view").innerHTML = `
  <div class="panel"><h2>Strategy lab</h2>
    <div class="hint">Write a buy rule and test it on 5 years of history. The rule is checked at each day's close and the trade is
      bought at the <b>next</b> open, so it can't cheat. The last 30% of the data is held back as a fair test, and the same exits are
      applied to random entry days to show what luck alone would have made. Most rules don't beat that, and the lab will say so.</div>
    <div class="row" style="margin-bottom:10px"><span class="small muted">Start from:</span>
      ${m.presets.map((p, i) => `<button class="sm" data-preset="${i}" title="${esc(p.why)}">${esc(p.name)}</button>`).join("")}</div>
    <div class="form">
      <div class="span6"><label>Buy when (checked at the close)</label><input id="l-entry" placeholder="close > sma(close, 200) and rsi(2) < 10"></div>
      <div class="span6"><label>Sell when (optional; sells at the next open)</label><input id="l-exit" placeholder="close > sma(close, 5)"></div>
      <div><label>Stop type</label><select id="l-st"><option value="atr">× ATR below entry</option><option value="pct">% below entry</option><option value="none">no stop</option></select></div>
      <div><label>Stop size</label><input id="l-sv" type="number" step="any" value="2"></div>
      <div><label>Target (R multiple, optional)</label><input id="l-tr" type="number" step="any" placeholder="none"></div>
      <div><label>Max hold (trading days)</label><input id="l-mh" type="number" value="20"></div>
      <div><label>Costs per side (bps)</label><input id="l-cost" type="number" value="10"></div>
      <div style="align-self:end"><button class="primary" id="l-run" style="width:100%">Backtest</button></div>
      <div class="span6"><label>Tickers</label><input id="l-tk" value="${esc(m.default_tickers.join(" "))}"></div>
    </div>
    <details style="margin-top:10px"><summary class="small muted">Rule cheat-sheet</summary>
      <p class="small">Prices: <code>${m.series.join("</code> <code>")}</code>. Combine with <code>and</code> <code>or</code> <code>not</code>, compare with
      <code>&gt; &lt; &gt;= &lt;=</code>, do math with <code>+ - * /</code>.</p>
      <ul class="small">${Object.entries(m.help).map(([k, v]) => `<li><code>${esc(v.split(":")[0])}</code>${esc(v.slice(v.indexOf(":")))}</li>`).join("")}</ul>
    </details>
  </div>
  <div id="l-result"></div>
  <div class="panel"><h2>Saved strategies</h2>
    ${saved.length ? `<table><tr><th>Name</th><th>Rule</th><th>Verdict</th><th class="num">Out-of-sample trades</th><th class="num">Avg / trade</th><th>Phone alert</th><th></th></tr>
      ${saved.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td class="small"><code>${esc(s.spec.entry)}</code></td><td>${verdictPill(s.verdict)}</td>
        <td class="num">${s.oos?.trades ?? "—"}</td><td class="num ${cls(s.oos?.avg_ret)}">${pct(s.oos?.avg_ret, 2, true)}</td>
        <td><label class="small chk"><input type="checkbox" data-alert="${s.id}" ${s.alert ? "checked" : ""}> notify on signal</label></td>
        <td><button class="sm" data-load="${s.id}">Load</button> <button class="sm" data-sig="${s.id}">Signals today</button> <button class="sm danger" data-del="${s.id}">×</button></td></tr>`).join("")}</table>`
      : `<div class="empty small">Save a strategy after backtesting it. With "notify on signal" on, the alert scanner tells you when it fires.</div>`}
  </div>`;
  const load = (p) => {
    $("#l-entry").value = p.entry; $("#l-exit").value = p.exit || ""; $("#l-st").value = p.stop_type;
    $("#l-sv").value = p.stop_value; $("#l-tr").value = p.target_r ?? ""; $("#l-mh").value = p.max_hold;
    if (p.tickers) $("#l-tk").value = p.tickers.join(" ");
    if (p.cost_bps !== undefined) $("#l-cost").value = p.cost_bps;
  };
  $("#view").querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { load(m.presets[b.dataset.preset]); $("#l-run").click(); }));
  $("#view").querySelectorAll("[data-load]").forEach((b) => (b.onclick = () => { load(saved.find((s) => s.id == b.dataset.load).spec); window.scrollTo(0, 0); }));
  $("#view").querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => guard(async () => { await api("DELETE", `/api/lab/strategies/${b.dataset.del}`); route(); }, b)));
  $("#view").querySelectorAll("[data-alert]").forEach((c) => (c.onchange = () => guard(async () => {
    await PATCH(`/api/lab/strategies/${c.dataset.alert}`, { alert: c.checked }); toast(c.checked ? "You'll get a phone alert when it fires." : "Alert off.");
  })));
  $("#view").querySelectorAll("[data-sig]").forEach((b) => (b.onclick = () => guard(async () => {
    const hits = await GET(`/api/lab/strategies/${b.dataset.sig}/signals`);
    toast(hits.length ? `Firing on the last close: ${hits.join(", ")}` : "No signals on the last close.");
  }, b)));
  $("#l-run").onclick = (e) => guard(runBacktest, e.target);
};

function labSpec() {
  return { entry: $("#l-entry").value, exit: $("#l-exit").value, stop_type: $("#l-st").value, stop_value: $("#l-sv").value,
    target_r: $("#l-tr").value, max_hold: $("#l-mh").value, cost_bps: $("#l-cost").value, tickers: $("#l-tk").value };
}

function verdictPill(v) {
  if (!v) return "—";
  const c = v === "EDGE" ? "GO" : v === "NO EDGE" ? "STOP" : "CAUTION";
  return `<span class="verdict-pill ${c}">${esc(v)}</span>`;
}

async function runBacktest() {
  $("#l-result").innerHTML = `<div class="panel empty"><span class="spin"></span> Backtesting…</div>`;
  let r;
  try { r = await POST("/api/lab/backtest", labSpec()); } catch (e) { $("#l-result").innerHTML = ""; throw e; }
  labLast = r;
  const col = (title, s, note) => `<div class="card"><div class="k">${title}</div>
    ${s.trades ? `<div class="v ${cls(s.avg_ret)}">${pct(s.avg_ret, 2, true)} <span class="small muted">/ trade</span></div>
    <div class="small">${s.trades} trades · win ${pct(s.win_rate, 0)} · avg ${rmult(s.avg_r)} · PF ${isNum(s.profit_factor) ? s.profit_factor.toFixed(2) : "—"} · hold ${s.avg_hold.toFixed(1)}d</div>
    ${isNum(s.random_avg_ret) ? `<div class="small muted">random entries: ${pct(s.random_avg_ret, 2, true)} / trade · beat ${pct(1 - s.p_value, 0)} of 500 random runs</div>` : ""}`
    : `<div class="v muted">no trades</div>`}<div class="small muted">${note}</div></div>`;
  const vc = r.verdict === "EDGE" ? "GO" : r.verdict === "NO EDGE" ? "STOP" : "CAUTION";
  $("#l-result").innerHTML = `
  <div class="verdict ${vc}"><div class="big">${esc(r.verdict)}</div><div>${esc(r.verdict_text)}</div></div>
  <div class="grid g3">
    ${col("All 5 years", r.all, "every trade the rule would have made")}
    ${col("Older 70% (in-sample)", r.in_sample, "where rules usually get tuned, so it flatters them")}
    ${col("Newest 30% (out-of-sample)", r.out_of_sample, "the fair test")}
  </div>
  <div class="panel" style="margin-top:16px"><h3 style="margin-top:0">Running total, in R (risk units) per trade</h3>
    <div class="chartbox"><canvas id="l-curve"></canvas></div>
    <div class="row" style="margin-top:10px"><input id="l-name" placeholder="name this strategy" style="max-width:280px">
      <label class="small chk"><input type="checkbox" id="l-alert"> phone alert when it fires</label><button id="l-save">Save strategy</button></div>
  </div>
  <div class="grid g2">
    <div class="panel"><h3 style="margin-top:0">By ticker</h3><table><tr><th>Ticker</th><th class="num">Trades</th><th class="num">Buy &amp; hold</th><th>Firing now</th></tr>
      ${r.per_ticker.map((t) => `<tr><td>${esc(t.ticker)}</td><td class="num">${t.trades}</td><td class="num ${cls(t.buy_hold)}">${pct(t.buy_hold, 0, true)}</td><td>${t.signal_today ? '<span class="good">yes</span>' : ""}</td></tr>`).join("")}</table>
      ${r.skipped.length ? `<p class="small warn">Skipped: ${r.skipped.map(esc).join("; ")}</p>` : ""}
      <p class="small muted">Out-of-sample starts around ${esc(r.per_ticker[0]?.split_date || "")}.</p></div>
    <div class="panel"><h3 style="margin-top:0">Trades (newest first)</h3><div class="tablewrap" style="max-height:360px;overflow:auto"><table><tr><th>Ticker</th><th>In</th><th>Out</th><th class="num">Return</th><th class="num">R</th><th>Exit</th></tr>
      ${r.trades.map((t) => `<tr><td>${esc(t.ticker)}${t.oos ? "" : ' <span class="small muted">IS</span>'}</td><td>${t.entry_date}</td><td>${t.exit_date}</td><td class="num ${cls(t.ret)}">${pct(t.ret, 1, true)}</td><td class="num">${rmult(t.r)}</td><td class="small">${esc(t.why)}</td></tr>`).join("")}</table></div></div>
  </div>`;
  const pts = r.curve;
  lineChart("l-curve", pts.map((p) => p.t), [
    { label: "cumulative R (grey = in-sample, blue = out-of-sample)", data: pts.map((p) => p.v), borderColor: "#4c8dff",
      segment: { borderColor: (c) => (pts[c.p1DataIndex]?.oos ? "#4c8dff" : "#8b95a3") } },
  ]);
  $("#l-save").onclick = (e) => guard(async () => {
    await POST("/api/lab/strategies", Object.assign(labSpec(), { name: $("#l-name").value, alert: $("#l-alert").checked, result: labLast }));
    toast("Saved."); route();
  }, e.target);
}
