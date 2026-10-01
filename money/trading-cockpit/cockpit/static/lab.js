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
    <details style="margin-top:10px"><summary class="small muted">Robustness search: try many settings and see if tuning them actually helps</summary>
      <p class="small muted">Tries every combination below on the <b>older 70%</b> only, picks the best, then shows where that pick lands on the newer 30%.
        If the best in-sample settings aren't also good out-of-sample, tuning is just fitting noise. Put <code>$p</code> in the rule
        (e.g. <code>rsi(2) &lt; $p</code>) to search a number in it too. At most 81 combinations.</p>
      <div class="form">
        <div class="span2"><label>Stop sizes</label><input id="o-stop" placeholder="1.5 2 3"></div>
        <div class="span2"><label>Max holds</label><input id="o-hold" placeholder="5 10 20"></div>
        <div class="span2"><label>Targets in R (none = no target)</label><input id="o-target" placeholder="none 2 3"></div>
        <div class="span2"><label>Values for $p</label><input id="o-p" placeholder="5 10 15"></div>
        <div class="span2" style="align-self:end"><button id="o-run">Run robustness search</button></div>
      </div></details>
  </div>
  <div id="o-result"></div>
    <details style="margin-top:10px"><summary class="small muted">Rule cheat-sheet</summary>
      <p class="small">Prices: <code>${m.series.join("</code> <code>")}</code>. Combine with <code>and</code> <code>or</code> <code>not</code>, compare with
      <code>&gt; &lt; &gt;= &lt;=</code>, do math with <code>+ - * /</code>.</p>
      <ul class="small">${Object.entries(m.help).map(([k, v]) => `<li><code>${esc(v.split(":")[0])}</code>${esc(v.slice(v.indexOf(":")))}</li>`).join("")}</ul>
    </details>
  </div>
  <div id="l-result"></div>
  <div class="panel"><div class="row" style="justify-content:space-between"><h2>Saved strategies</h2>${saved.length > 1 ? `<button class="sm" id="l-cmp">Compare ticked</button>` : ""}</div>
    ${saved.length ? `<table><tr><th></th><th>Name</th><th>Rule</th><th>Verdict</th><th class="num">Out-of-sample trades</th><th class="num">Avg / trade</th><th>Phone alert</th><th></th></tr>
      ${saved.map((s) => `<tr><td><input type="checkbox" data-cmp="${s.id}" style="width:auto"></td><td><b>${esc(s.name)}</b></td><td class="small"><code>${esc(s.spec.entry)}</code></td><td>${verdictPill(s.verdict)}</td>
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
  $("#o-run").onclick = (e) => guard(runOptimize, e.target);
  if ($("#l-cmp")) $("#l-cmp").onclick = (e) => guard(async () => {
    const ids = [...$("#view").querySelectorAll("[data-cmp]:checked")].map((c) => +c.dataset.cmp);
    if (ids.length < 2) throw new Error("Tick at least two strategies");
    await compareStrategies(ids);
  }, e.target);
};

async function runOptimize() {
  $("#o-result").innerHTML = `<div class="panel empty"><span class="spin"></span> Testing every combination (10–60s)…</div>`;
  let r;
  try {
    r = await POST("/api/lab/optimize", Object.assign(labSpec(), { grid_stop: $("#o-stop").value, grid_hold: $("#o-hold").value,
      grid_target: $("#o-target").value, grid_p: $("#o-p").value }));
  } catch (e) { $("#o-result").innerHTML = ""; throw e; }
  const vc = r.verdict === "ROBUST-ISH" ? "GO" : "STOP";
  const pickRow = (x) => `<td class="num">${x.stop_value}</td><td class="num">${x.max_hold}</td><td class="num">${x.target_r ?? "—"}</td>${r.has_p ? `<td class="num">${x.p}</td>` : ""}`;
  $("#o-result").innerHTML = `<div class="verdict ${vc}"><div class="big">${esc(r.verdict)}</div><div>${esc(r.verdict_text)}</div></div>
    <div class="grid g2"><div class="panel"><h3 style="margin-top:0">In-sample rank vs out-of-sample rank</h3><div class="chartbox"><canvas id="o-sc"></canvas></div>
      <p class="small muted">Each dot is one combination. Dots along a rising diagonal mean in-sample results carry over; a shapeless cloud means they don't.</p></div>
    <div class="panel"><h3 style="margin-top:0">All ${r.combos} combinations, best in-sample first</h3><div class="tablewrap" style="max-height:340px;overflow:auto"><table>
      <tr><th class="num">Stop</th><th class="num">Hold</th><th class="num">Target</th>${r.has_p ? '<th class="num">$p</th>' : ""}<th class="num">In-sample / trade</th><th class="num">Out-of-sample / trade</th><th class="num">OOS rank</th></tr>
      ${r.rows.map((x) => `<tr>${pickRow(x)}<td class="num ${cls(x.is_avg)}">${pct(x.is_avg, 2, true)} <span class="small muted">${x.is_trades}</span></td>
        <td class="num ${cls(x.oos_avg)}">${pct(x.oos_avg, 2, true)} <span class="small muted">${x.oos_trades}</span></td><td class="num">${x.oos_rank ?? "—"}</td></tr>`).join("")}</table></div></div></div>`;
  const pts = r.rows.filter((x) => x.is_rank).map((x) => ({ x: x.is_rank, y: x.oos_rank }));
  if (S.charts["o-sc"]) S.charts["o-sc"].destroy();
  S.charts["o-sc"] = new Chart($("#o-sc"), { type: "scatter", data: { datasets: [{ label: "combination", data: pts, backgroundColor: "#4c8dff" }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } },
      scales: { x: { title: { display: true, text: "in-sample rank (1 = best)", color: "#8b95a3" }, ticks: { color: "#8b95a3" }, grid: { color: cssv("--grid") } },
                y: { title: { display: true, text: "out-of-sample rank", color: "#8b95a3" }, ticks: { color: "#8b95a3" }, grid: { color: cssv("--grid") } } } } });
}

const CMP_COLORS = ["#4c8dff", "#2fbf71", "#e6a23c", "#b07cff", "#e5534b", "#8b95a3"];
async function compareStrategies(ids) {
  $("#l-result").innerHTML = `<div class="panel empty"><span class="spin"></span> Re-running ${ids.length} strategies on fresh data…</div>`;
  window.scrollTo(0, 0);
  const rs = await POST("/api/lab/compare", { ids });
  $("#l-result").innerHTML = `<div class="panel"><h2>Comparison</h2>
    <div class="tablewrap"><table><tr><th>Strategy</th><th>Verdict</th><th class="num">Trades</th><th class="num">Avg / trade</th><th class="num">OOS avg / trade</th><th class="num">Win rate</th>
      <th class="num">Account sim CAGR</th><th class="num">Max drawdown</th><th class="num">SPY CAGR</th></tr>
      ${rs.map((r, i) => `<tr><td><span style="color:${CMP_COLORS[i]}">■</span> <b>${esc(r.name)}</b></td><td>${verdictPill(r.verdict)}</td><td class="num">${r.all.trades}</td>
        <td class="num ${cls(r.all.avg_ret)}">${pct(r.all.avg_ret, 2, true)}</td><td class="num ${cls(r.out_of_sample.avg_ret)}">${pct(r.out_of_sample.avg_ret, 2, true)}</td>
        <td class="num">${pct(r.all.win_rate, 0)}</td><td class="num ${cls(r.sim.cagr)}">${pct(r.sim.cagr, 1, true)}</td><td class="num bad">${pct(r.sim.max_drawdown, 1)}</td><td class="num">${pct(r.sim.spy_cagr, 1, true)}</td></tr>`).join("")}</table></div>
    <h3>Simulated account, same rules for each (risk ${pct(S.settings.risk_pct, 1)} per trade, max 5 positions)</h3><div class="chartbox"><canvas id="cmp-c"></canvas></div></div>`;
  const days = [...new Set(rs.flatMap((r) => (r.sim_curve || []).map((p) => p.t)))].sort();
  const series = rs.map((r, i) => {
    const m = Object.fromEntries((r.sim_curve || []).map((p) => [p.t, p.v]));
    let last = r.sim.start;
    return { label: r.name, data: days.map((d) => (last = m[d] ?? last)), borderColor: CMP_COLORS[i] };
  });
  lineChart("cmp-c", days, series);
}

function labSpec() {
  return { entry: $("#l-entry").value, exit: $("#l-exit").value, stop_type: $("#l-st").value, stop_value: $("#l-sv").value,
    target_r: $("#l-tr").value, max_hold: $("#l-mh").value, cost_bps: $("#l-cost").value, tickers: $("#l-tk").value };
}

function verdictPill(v) {
  if (!v) return "—";
  const c = v === "EDGE" ? "GO" : v === "NO EDGE" ? "STOP" : "CAUTION";
  return `<span class="verdict-pill ${c}">${esc(v)}</span>`;
}

async function runBacktest() { return runBacktestWith(labSpec()); }

async function runBacktestWith(spec) {
  $("#l-result").innerHTML = `<div class="panel empty"><span class="spin"></span> Backtesting…</div>`;
  let r;
  try { r = await POST("/api/lab/backtest", spec); } catch (e) { $("#l-result").innerHTML = ""; throw e; }
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
  ${r.sim && r.sim.trades ? `<div class="panel" style="margin-top:16px"><h3 style="margin-top:0">As one account: $10,000, ${pct(r.sim.risk_pct, 1)} risk per trade, max ${r.sim.max_positions} positions</h3>
    <div class="grid g5">
      <div class="card"><div class="k">Ending value</div><div class="v ${cls(r.sim.total_return)}">${usd(r.sim.final, 0)}</div><div class="small muted">${pct(r.sim.total_return, 0, true)} over ${r.sim.years.toFixed(1)} years</div></div>
      <div class="card"><div class="k">Per year (CAGR)</div><div class="v ${cls(r.sim.cagr)}">${pct(r.sim.cagr, 1, true)}</div><div class="small muted">SPY: ${pct(r.sim.spy_cagr, 1, true)}</div></div>
      <div class="card"><div class="k">Max drawdown</div><div class="v bad">${pct(r.sim.max_drawdown, 1)}</div></div>
      <div class="card"><div class="k">Trades taken</div><div class="v">${r.sim.trades}</div><div class="small muted">${r.sim.skipped} skipped (slots full)</div></div>
      <div class="card"><div class="k">Settings</div><div class="row"><input id="sim-r" type="number" step="0.1" value="${(r.sim.risk_pct * 100).toFixed(1)}" title="risk % per trade" style="max-width:70px"><input id="sim-n" type="number" value="${r.sim.max_positions}" title="max positions" style="max-width:60px"><button class="sm" id="sim-go">Rerun</button></div></div>
    </div><div class="chartbox" style="margin-top:12px"><canvas id="l-sim"></canvas></div>
    <p class="small muted">Positions sized so a stop-out costs the risk %, capped at the max-position setting. Uses the same trades as above, so it shares their limits:
      no slippage beyond the cost setting, and these tickers were picked today (survivorship bias).</p></div>` : ""}
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
  if (r.sim && r.sim.curve) {
    lineChart("l-sim", r.sim.curve.map((p) => p.t), [{ label: "simulated account ($)", data: r.sim.curve.map((p) => p.v), borderColor: "#2fbf71" }]);
    $("#sim-go").onclick = (e) => guard(async () => {
      const sp = Object.assign(labSpec(), { sim_risk_pct: $("#sim-r").value, sim_max_pos: $("#sim-n").value });
      await runBacktestWith(sp);
    }, e.target);
  }
  $("#l-save").onclick = (e) => guard(async () => {
    await POST("/api/lab/strategies", Object.assign(labSpec(), { name: $("#l-name").value, alert: $("#l-alert").checked, result: labLast }));
    toast("Saved."); route();
  }, e.target);
}
