// Evolution: ~300 published strategies compete on the last year of US stocks, the losers die off, the survivors
// face a holdout exam and then a live paper trial. Placebo (coin-flip) strategies run alongside as the control group.
"use strict";

let EVO = null, evoPoll = null, evoFilter = "all";

const CAUSE = {
  "lost money": { c: "var(--bad)", t: "Average trade lost money across all the stocks it has faced so far" },
  "trailed luck": { c: "var(--warn)", t: "No better than buying random days with the same exits" },
  outcompeted: { c: "var(--violet)", t: "Weakest edge score (t-stat vs random) among the survivors" },
  starved: { c: "var(--muted)", t: "Too few trades to judge" },
  "weak edge": { c: "var(--info)", t: "Final exam only: beat random entries on the holdout, but by less than one standard error" },
};
const LIVE_PILL = { "on trial": "open", graduated: "good", eliminated: "bad" };

function evoFate(r) {
  const f = r.fate;
  if (f.status === "finalist") return `<span class="pill good">Finalist</span>`;
  if (f.status === "failed exam") return `<span class="pill planned" title="${esc(CAUSE[f.cause]?.t || "")}">Failed exam · ${esc(f.cause)}</span>`;
  return `<span class="pill" title="${esc(CAUSE[f.cause]?.t || "")}">Died gen ${f.gen} · ${esc(f.cause)}</span>`;
}
const evoZ = (z) => (isNum(z) ? `<span class="${z >= 1.65 ? "good" : z >= 1 ? "" : "muted"}">${z.toFixed(2)}</span>` : "—");
const evoStat = (s) => (s && s.n ? `${s.n} · <span class="${cls(s.mean)}">${pct(s.mean, 2, true)}</span>` : "—");
const evoSrc = (key) => {
  const s = EVO?.run?.sources?.[key];
  return s ? (s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)) : "";
};

VIEWS.evolution = async function () {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  EVO = await GET("/api/evo" + (q.get("run") ? `?run=${encodeURIComponent(q.get("run"))}` : ""));
  const { run, live, job } = EVO;
  const running = job.state === "running";
  if (!run) {
    $("#view").innerHTML = `${evoHeader(null, running)}${evoJob(job)}
      <div class="panel empty"><h2 style="justify-content:center">No evolution yet</h2>
        <p class="muted">A run backtests every strategy in the library on the last year of ~600 US stocks and lets natural selection
          pick the survivors. It takes about a minute plus the first download of three years of prices.</p>
        <button class="primary" id="evo-new2">Run the first evolution</button></div>`;
    evoWire(running);
    return;
  }
  const S = run.summary, gens = run.generations, all = run.strategies;
  const fin = all.filter((r) => r.fate.status === "finalist" && r.family !== "placebo");
  const surv = all.filter((r) => ["finalist", "failed exam"].includes(r.fate.status) && r.family !== "placebo")
    .sort((a, b) => (b.holdout.z ?? -9) - (a.holdout.z ?? -9));
  const trial = Object.entries(live.strategies || {}).map(([id, v]) => ({ id, ...v }));
  const onTrial = trial.filter((v) => v.status !== "eliminated");
  const best = fin.slice().sort((a, b) => (b.holdout.excess ?? -9) - (a.holdout.excess ?? -9))[0];
  const aliveCurve = [S.strategies + S.placebos, ...gens.map((g) => g.alive)];
  const sigCount = onTrial.reduce((n, v) => n + (v.signals?.length || 0), 0);

  $("#view").innerHTML = `
  ${evoHeader(run, running)}
  ${evoJob(job)}
  <div class="kpis">
    <div class="kpi hero"><div class="k">Entered the arena</div><div class="v">${S.strategies} strategies</div>
      <div class="s">+ ${S.placebos} placebos · ${S.tickers} stocks</div>
      ${spark(aliveCurve, { color: "var(--accent)" })}</div>
    <div class="kpi"><div class="k">Survived selection</div><div class="v">${S.finalists}</div>
      <div class="s">${pct(S.real_rate, 1)} passed the final exam</div></div>
    <div class="kpi"><div class="k">Placebos that survived</div><div class="v ${S.placebo_finalists ? "warn" : "good"}">${S.placebo_finalists} / ${S.placebos}</div>
      <div class="s">${S.placebo_finalists ? "luck alone gets this far" : "every coin flip died"}</div></div>
    <div class="kpi"><div class="k">Best holdout edge</div><div class="v ${cls(best?.holdout.excess)}">${best ? pct(best.holdout.excess, 2, true) : "—"}</div>
      <div class="s">${best ? `per trade · ${esc(best.name.split(" · ")[0])}` : "no finalists"}</div></div>
    <div class="kpi"><div class="k">Live paper trial</div><div class="v">${onTrial.length}</div>
      <div class="s">${trial.filter((v) => v.status === "graduated").length} graduated · ${sigCount} signals today</div></div>
  </div>

  <div class="grid g2">
    <div class="panel"><div class="ph"><h2>Population funnel</h2><span class="small muted">each generation trades a fresh cohort of stocks</span></div>
      ${evoFunnel(run)}</div>
    <div class="panel"><div class="ph"><h2>Real strategies vs placebos</h2><span class="small muted">share still alive</span></div>
      <div style="height:220px"><canvas id="evo-ctrl"></canvas></div>
      <p class="small muted" style="margin:10px 0 0">Placebos buy on a deterministic coin flip with the same exits as real strategies. They face the exact same
        selection, so their survival rate is what luck alone achieves. ${S.placebo_finalists
          ? `<b class="warn">${S.placebo_finalists} placebo${S.placebo_finalists > 1 ? "s" : ""} survived, so expect about ${Math.round(S.placebo_rate * S.strategies)} of the real finalists to be lucky too.</b>`
          : `<b class="good">None survived</b>, while ${pct(S.real_rate, 1)} of real strategies did.`}</p></div>
  </div>

  <div class="panel"><div class="ph"><h2>Population map</h2>${evoLegend()}</div>
    <p class="small muted" style="margin-top:-6px">Every square is one strategy: a family's rule with one set of parameters. The brighter it is, the longer it lived. Click one for its full record.</p>
    ${evoMap(run)}</div>

  <div class="panel"><div class="ph"><h2>Survivors</h2><span class="small muted">sorted by the holdout exam: ${run.holdout} stocks no strategy was selected on</span></div>
    <div class="tablewrap"><table><tr><th>#</th><th>Strategy</th><th class="num" title="trades · average trade">Holdout</th><th class="num" title="average trade minus random entries">vs random</th>
      <th class="num" title="t-stat of the edge, clustered by day; 1.65 ≈ 95% one-sided">Edge z</th><th class="num" title="same rule on the year before (different regime)">Prior year</th>
      <th class="num" title="$10k, 10 slots of 10%, the selection stocks' trades; median of random pick orders">Paper account</th><th></th><th>Status</th></tr>
      ${surv.map((r, i) => {
        const lv = live.strategies?.[r.id];
        return `<tr class="click" data-sid="${esc(r.id)}"><td class="muted">${i + 1}</td>
        <td class="wrap"><b>${esc(r.name.split(" · ")[0])}</b> <span class="muted small">${esc(r.id)}</span><div class="small muted">${esc(r.name.split(" · ")[1] || "")}</div></td>
        <td class="num">${evoStat(r.holdout)}</td><td class="num ${cls(r.holdout.excess)}">${pct(r.holdout.excess, 2, true)}</td>
        <td class="num">${evoZ(r.holdout.z)}</td>
        <td class="num ${cls(r.prior.excess)}">${pct(r.prior.excess, 2, true)}${r.prior.excess > 0 ? " ✓" : ""}</td>
        <td class="num ${cls(r.sim?.total_return)}" title="${isNum(r.sim?.p10) ? `middle 80% of ${r.sim.draws} draws: ${pct(r.sim.p10, 1, true)} to ${pct(r.sim.p90, 1, true)}` : ""}">${pct(r.sim?.total_return, 1, true)}</td>
        <td style="width:90px">${spark((r.sim?.curve || []).map((p) => p.v), { cls: "spark-inline", h: 26 })}</td>
        <td>${r.fate.status === "finalist" ? (lv ? `<span class="pill ${LIVE_PILL[lv.status]}">${esc(lv.status)}</span>` : `<span class="pill good">Finalist</span>`) : evoFate(r)}</td></tr>`;
      }).join("")}</table></div>
    <p class="small muted" style="margin:10px 0 0">Prior year is a check, not a filter: a ✓ means the rule also beat random entries in the 12 months before the test year.
      Paper account: $10,000 in 10 slots of 10%, trading the selection stocks with 10 bps costs per side. There are usually more signals than free slots, so it is run 25 times with signals picked in random order and the median is shown (hover for the range).</p></div>

  <div class="panel"><div class="ph"><h2>Live paper trial</h2>
      <span class="small muted">${live.updated_at ? `updated ${esc(live.updated_at.slice(0, 16).replace("T", " "))}` : "not refreshed yet"} · runs every weekday after the US close</span></div>
    ${trial.length ? evoLiveTable(trial)
      : `<div class="empty small">Finalists start paper trading here the day they're promoted.</div>`}
    <p class="small muted" style="margin:10px 0 0">Signals are checked at each close and bought at the next open on all ${S.tickers} stocks, one position per stock.
      A strategy is <b>eliminated</b> once it has ${EVO.gates.elim_trades}+ live trades and isn't beating random entries.
      It <b>graduates</b> (candidate for real money) after ${EVO.gates.days}+ trading days and ${EVO.gates.trades}+ trades with an edge of z ≥ ${EVO.gates.z}.
      Nothing here places real orders.</p></div>

  <div class="grid g2">
    <div class="panel"><div class="ph"><h2>Family scoreboard</h2><span class="small muted">how each idea fared across its variants</span></div>${evoFamilies(run)}</div>
    <div class="panel"><div class="ph"><h2>How deaths happened</h2></div>${evoCauses(run)}</div>
  </div>

  <div class="panel"><div class="ph"><h2>Graveyard</h2><div class="chips" id="evo-gf">
      ${["all", ...Object.keys(CAUSE), "failed exam"].map((c) => `<span class="chip ${evoFilter === c ? "on" : ""}" data-f="${c}">${c === "all" ? "Everyone" : esc(c)}</span>`).join("")}</div></div>
    <div class="tablewrap evo-scroll" id="evo-grave"></div></div>

  ${evoMethod(run)}`;

  const real = S.strategies, pl = S.placebos;
  lineChart("evo-ctrl", ["Start", ...gens.map((g) => `Gen ${g.g}`), "Exam"], [
    { label: "Real strategies", data: [1, ...gens.map((g) => (g.alive - g.placebo_alive) / real), S.finalists / real], borderColor: cssv("--accent"), backgroundColor: cssv("--accent-soft"), fill: true, tension: 0.25 },
    { label: "Placebos", data: [1, ...gens.map((g) => g.placebo_alive / pl), S.placebo_finalists / pl], borderColor: cssv("--violet"), borderDash: [5, 4], tension: 0.25 },
  ], { scales: { x: { ticks: { color: "#8b95a3" }, grid: { display: false } },
                 y: { min: 0, max: 1, ticks: { color: "#8b95a3", callback: (v) => Math.round(v * 100) + "%" }, grid: { color: cssv("--grid") }, border: { display: false } } },
       plugins: { legend: { labels: { color: "#8b95a3", boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(c.raw * 100).toFixed(1)}%` } } } });
  evoGrave();
  evoWire(running);
};

function evoHeader(run, running) {
  const runs = EVO.runs || [];
  return `<div class="ph" style="margin-bottom:16px"><div>
      <div style="font-size:22px;font-weight:700;letter-spacing:-.5px">Strategy evolution</div>
      <div class="muted small">${run ? `Run ${esc(run.created_at.slice(0, 16).replace("T", " "))} · prices through ${esc(run.data_end)} · ${run.config.generations} generations · ${run.seconds}s`
        : "Natural selection for trading rules"}</div></div>
    <div class="row">${runs.length > 1 ? `<select id="evo-run" style="width:auto">${runs.map((r) => `<option value="${esc(r.id)}" ${run && r.id === run.id ? "selected" : ""}>${esc(r.created_at.slice(0, 16).replace("T", " "))} · ${r.summary.finalists} finalists</option>`).join("")}</select>` : ""}
      ${run ? `<button id="evo-live" ${running ? "disabled" : ""}>Refresh live trial</button>` : ""}
      <button class="primary" id="evo-new" ${running ? "disabled" : ""}>Run new evolution</button></div></div>`;
}

function evoJob(job) {
  if (job.state === "running") {
    const p = job.total ? job.done / job.total : 0;
    return `<div class="panel" id="evo-job"><div class="row" style="justify-content:space-between"><b><span class="spin"></span> ${esc(job.phase || "Working")}</b>
      <span class="small muted">${job.total ? `${job.done} / ${job.total}` : ""}</span></div><div class="meter"><i style="width:${Math.max(2, p * 100)}%;background:var(--accent)"></i></div></div>`;
  }
  if (job.state === "error") return `<div class="panel"><b class="bad">The last job failed:</b> <span class="small">${esc(job.error)}</span></div>`;
  return "";
}

function evoFunnel(run) {
  const n0 = run.summary.strategies + run.summary.placebos;
  const row = (label, before, after, deaths, sub) => {
    const seg = Object.entries(deaths).filter(([, v]) => v).map(([k, v]) =>
      `<i style="width:${(v / n0) * 100}%;background:${CAUSE[k].c}" title="${v} ${esc(k)}"></i>`).join("");
    return `<div class="evo-fr"><div class="small"><b>${label}</b><div class="muted">${sub}</div></div>
      <div class="evo-fb"><i style="width:${(after / n0) * 100}%;background:var(--accent)" title="${after} survived"></i>${seg}</div>
      <div class="num small"><b>${after}</b> <span class="muted">/ ${before}</span></div></div>`;
  };
  const exam = run.strategies.filter((r) => r.fate.status === "failed exam");
  return `<div class="evo-funnel">${run.generations.map((g) => row(`Gen ${g.g}`, g.alive_before, g.alive, g.deaths, `${g.tickers} new stocks`)).join("")}
    ${row("Final exam", run.generations.at(-1).alive, run.summary.finalists + run.summary.placebo_finalists,
      exam.reduce((d, r) => ((d[r.fate.cause] = (d[r.fate.cause] || 0) + 1), d), {}), `${run.holdout} untouched stocks`)}</div>`;
}

function evoLegend() {
  const G = EVO.run.config.generations;
  return `<div class="evo-legend small muted"><span><i class="evo-c" style="${evoCellStyle({ status: "dead", gen: 1 }, G)}"></i>died gen 1</span>
    <span><i class="evo-c" style="${evoCellStyle({ status: "dead", gen: G }, G)}"></i>died gen ${G}</span>
    <span><i class="evo-c" style="${evoCellStyle({ status: "failed exam" }, G)}"></i>failed exam</span>
    <span><i class="evo-c" style="${evoCellStyle({ status: "finalist" }, G)}"></i>finalist</span>
    <span><i class="evo-c placebo"></i>placebo</span></div>`;
}

function evoCellStyle(f, G) {
  if (f.status === "finalist") return "background:var(--good)";
  if (f.status === "failed exam") return "background:var(--warn)";
  const k = G > 1 ? (f.gen - 1) / (G - 1) : 1;
  return `background:color-mix(in srgb, var(--accent) ${Math.round(12 + k * 58)}%, var(--panel3))`;
}

function evoMap(run) {
  const G = run.config.generations, by = {};
  run.strategies.forEach((r) => (by[r.family] = by[r.family] || []).push(r));
  const groups = {};
  Object.entries(by).forEach(([fid, rs]) => (groups[run.families[fid].kind] = groups[run.families[fid].kind] || []).push([fid, rs]));
  return `<div class="evo-map">${Object.entries(groups).map(([kind, fams]) => `<div class="evo-group"><div class="evo-gh">${esc(kind)}</div>
    ${fams.map(([fid, rs]) => `<div class="evo-fam"><div class="evo-fn" title="${esc(run.families[fid].name)}">${esc(run.families[fid].name)}</div><div class="evo-cells">
      ${rs.map((r) => `<button class="evo-c ${r.family === "placebo" ? "placebo" : ""}" data-sid="${esc(r.id)}" style="${evoCellStyle(r.fate, G)}"
        title="${esc(r.name)} · ${r.fate.status === "dead" ? `died gen ${r.fate.gen}, ${r.fate.cause}` : r.fate.status}" aria-label="${esc(r.name)}"></button>`).join("")}</div></div>`).join("")}</div>`).join("")}</div>`;
}

function evoFamilies(run) {
  const by = {};
  run.strategies.forEach((r) => {
    const f = (by[r.family] = by[r.family] || { n: 0, fin: 0, life: 0, best: null });
    f.n++;
    f.fin += r.fate.status === "finalist";
    f.life += r.fate.status === "dead" ? r.fate.gen - 1 : run.config.generations;
    if (r.fate.status === "finalist" && (!f.best || r.holdout.excess > f.best.holdout.excess)) f.best = r;
  });
  const rows = Object.entries(by).sort((a, b) => b[1].fin - a[1].fin || b[1].life / b[1].n - a[1].life / a[1].n);
  return `<div class="tablewrap evo-scroll"><table><tr><th>Family</th><th class="num">Variants</th><th class="num" title="average generations survived">Avg life</th><th class="num">Finalists</th><th class="num">Best holdout edge</th></tr>
    ${rows.map(([fid, f]) => `<tr class="${f.best ? "click" : ""}" ${f.best ? `data-sid="${esc(f.best.id)}"` : ""}><td class="wrap"><b>${esc(run.families[fid].name)}</b><div class="small muted">${esc(run.families[fid].kind)}</div></td>
      <td class="num">${f.n}</td><td class="num">${(f.life / f.n).toFixed(1)}</td><td class="num ${f.fin ? "good" : "muted"}">${f.fin}</td>
      <td class="num ${cls(f.best?.holdout.excess)}">${f.best ? pct(f.best.holdout.excess, 2, true) : "—"}</td></tr>`).join("")}</table></div>`;
}

function evoCauses(run) {
  const tot = {};
  run.generations.forEach((g) => Object.entries(g.deaths).forEach(([k, v]) => (tot[k] = (tot[k] || 0) + v)));
  const exam = run.strategies.filter((r) => r.fate.status === "failed exam").length;
  const max = Math.max(1, ...Object.values(tot), exam);
  const line = (label, v, c, t) => `<div class="evo-cause"><div><b>${esc(label)}</b><div class="small muted">${esc(t)}</div></div>
    <div class="meter" style="margin:0"><i style="width:${(v / max) * 100}%;background:${c}"></i></div><div class="num"><b>${v}</b></div></div>`;
  return Object.entries(CAUSE).filter(([k]) => k !== "weak edge").map(([k, c]) => line(k[0].toUpperCase() + k.slice(1), tot[k] || 0, c.c, c.t)).join("")
    + line("Failed final exam", exam, "var(--warn)", `Survived selection, but on the holdout stocks didn't beat random entries by z ≥ ${EVO.exam_z}`)
    + `<p class="small muted" style="margin:12px 0 0">Selection each generation: starved → lost money → trailed luck (all pooled over every cohort so far) →
      the bottom ${pct(run.config.cull, 0)} by edge score. Strategies are never tweaked or bred: changing parameters to fit the past is how backtests lie.</p>`;
}

function evoGrave() {
  const rows = EVO.run.strategies.filter((r) => r.fate.status !== "finalist")
    .filter((r) => evoFilter === "all" || r.fate.cause === evoFilter || (evoFilter === "failed exam" && r.fate.status === "failed exam"))
    .sort((a, b) => (b.fate.gen || 99) - (a.fate.gen || 99) || (b.all.excess ?? -9) - (a.all.excess ?? -9));
  $("#evo-grave").innerHTML = `<table><tr><th>Strategy</th><th>Fate</th><th class="num" title="every stock, test year: trades · average trade">Test year</th><th class="num">vs random</th><th class="num">Edge z</th></tr>
    ${rows.slice(0, 400).map((r) => `<tr class="click" data-sid="${esc(r.id)}"><td class="wrap"><b>${esc(r.name)}</b>${r.family === "placebo" ? ` <span class="pill">placebo</span>` : ""}</td>
      <td>${evoFate(r)}</td><td class="num">${evoStat(r.all)}</td><td class="num ${cls(r.all.excess)}">${pct(r.all.excess, 2, true)}</td><td class="num">${evoZ(r.all.z)}</td></tr>`).join("")}</table>
    ${rows.length ? "" : `<div class="empty small">Nobody died of that.</div>`}`;
  $("#evo-grave").querySelectorAll("[data-sid]").forEach((t) => (t.onclick = () => evoDetail(t.dataset.sid)));
}

function evoLiveTable(trial) {
  const G = EVO.gates;
  const rank = (v) => (v.status === "graduated" ? 0 : v.status === "on trial" ? 1 : 2);
  trial.sort((a, b) => rank(a) - rank(b) || (b.backtest?.holdout?.z ?? 0) - (a.backtest?.holdout?.z ?? 0));
  return `<div class="tablewrap"><table><tr><th>Strategy</th><th>Status</th><th class="num">Live trades</th><th class="num">Avg trade</th><th class="num">vs random</th>
    <th class="num" title="t-stat of the live edge, clustered by day">Edge z</th><th title="progress to graduation: trades, trading days and edge, the weakest of the three">Graduation</th><th>Buys at the next open</th></tr>
    ${trial.map((v) => {
      const s = v.stats || {}, dead = v.status === "eliminated";
      const prog = Math.min((s.n || 0) / G.trades, (v.days || 0) / G.days, Math.max(0, s.z || 0) / G.z, 1);
      const sig = v.signals || [];
      return `<tr class="click ${dead ? "evo-dead" : ""}" data-sid="${esc(v.id)}"><td class="wrap"><b>${esc(v.spec.name.split(" · ")[0])}</b> <span class="small muted">${esc(v.id)}</span>
          <div class="small muted">${esc(v.spec.name.split(" · ")[1] || "")}</div></td>
        <td><span class="pill ${LIVE_PILL[v.status]}" title="${esc(v.why || "")}">${esc(v.status)}</span></td>
        <td class="num">${s.n ?? 0}${v.open?.length ? ` <span class="small muted">(${v.open.length} open)</span>` : ""}</td>
        <td class="num ${cls(s.mean)}">${pct(s.mean, 2, true)}</td><td class="num ${cls(s.excess)}">${pct(s.excess, 2, true)}</td><td class="num">${evoZ(s.z)}</td>
        <td style="min-width:130px" title="${esc(v.why || "")}">${dead ? `<span class="small muted">${esc((v.why || "").slice(0, 60))}</span>` : `<div class="small muted">${s.n || 0}/${G.trades} trades · ${v.days || 0}/${G.days} days</div>
          <div class="meter" style="margin-top:3px;height:4px"><i style="width:${Math.max(2, prog * 100)}%"></i></div>`}</td>
        <td class="wrap small">${dead ? "" : sig.length ? sig.slice(0, 6).map((t) => `<a href="#chart?t=${encodeURIComponent(t)}">${esc(t)}</a>`).join(" ") + (sig.length > 6 ? ` <span class="muted">+${sig.length - 6}</span>` : "") : `<span class="muted">none</span>`}</td></tr>`;
    }).join("")}</table></div>`;
}

function evoMethod(run) {
  const S = run.summary;
  return `<div class="panel"><div class="ph"><h2>How it works, and what it can't tell you</h2></div>
    <div class="grid g2"><div class="small">
      <ol class="evo-steps">
        <li><b>The library.</b> ${S.strategies} variants of ${Object.keys(run.families).length - 1} published rule families: Connors' RSI-2, IBS, Double 7,
          Bollinger and Keltner dips, Turtle breakouts, 52-week highs, MACD, ADX, turn-of-the-month and more. Plus ${S.placebos} placebos.</li>
        <li><b>The arena.</b> The last 12 months of ${S.tickers} US stocks (${S.large} S&amp;P 500, ${S.small} well-known small and mid caps).
          Signals at the close, bought at the next open, 10 bps costs per side, one position per stock.</li>
        <li><b>Selection.</b> Stocks are dealt into ${run.config.generations} cohorts plus a holdout, each with the same large/small mix.
          Every generation, survivors trade a cohort they've never seen and are judged against random entry days with the same exits on the same stocks.</li>
        <li><b>Final exam.</b> Survivors must beat random entries by at least one standard error (z ≥ ${EVO.exam_z}) on the ${run.holdout} holdout stocks, which never influenced any decision.</li>
        <li><b>Live trial.</b> Finalists paper-trade every new day from promotion onward. Real results, not a backtest.</li>
      </ol></div>
      <div class="small">
        <p><b>Honest caveats.</b> One year is one market regime: a rule that won in this year's market may lose in the next one (see the prior-year column).
          ${S.strategies + S.placebos} strategies were tested, and with that many, some survive by luck. The placebos measure how many.
          The edge z-score clusters trades by day, because 60 stocks bought on the same day are one bet on the market, not 60 bets.
          The universe is today's index members, which flatters dip-buying slightly (survivorship). Real fills, borrow, taxes and slippage are worse than 10 bps.</p>
        <p><b>Why nothing is bred or tweaked.</b> A genetic algorithm that mutates parameters would find rules that fit this exact year. The research on data
          snooping (White's Reality Check, Bailey &amp; López de Prado's deflated Sharpe ratio) says the cure is fewer, pre-registered tries and a holdout. Hence fixed published rules.</p>
        <p class="muted" style="margin-bottom:0">Sources: ${Object.keys(run.sources).map(evoSrc).join(" · ")}</p>
      </div></div>
    ${run.skipped?.length ? `<p class="small muted" style="margin:10px 0 0">Skipped ${run.skipped.length} stock${run.skipped.length > 1 ? "s" : ""}: ${esc(run.skipped.join("; "))}</p>` : ""}</div>`;
}

function evoDetail(sid) {
  const r = EVO.run.strategies.find((x) => x.id === sid);
  const lv = EVO.live.strategies?.[sid];
  if (!r && !lv) return;
  const spec = r || lv.spec;
  const fam = EVO.run.families[spec.family];
  const st = (label, s) => `<div class="card"><div class="k">${label}</div><div class="v ${cls(s?.mean)}">${s?.n ? pct(s.mean, 2, true) : "—"}</div>
    <div class="small muted">${s?.n ? `${s.n} trades · ${pct(s.win, 0)} wins · vs random ${pct(s.excess, 2, true)} · z ${isNum(s.z) ? s.z.toFixed(2) : "—"}` : "no trades"}</div></div>`;
  const trades = lv?.closed?.length || lv?.open?.length ? [...(lv.open || []), ...lv.closed] : r?.recent || [];
  openModal(`<button class="x" onclick="closeModal()" aria-label="Close"><svg class="ic"><use href="#i-x"/></svg></button>
    <h2 style="margin-top:0">${esc(spec.name)}</h2>
    <div class="row small" style="margin-bottom:12px">${r ? evoFate(r) : ""}${lv ? `<span class="pill ${LIVE_PILL[lv.status]}">live: ${esc(lv.status)}</span>` : ""}
      <span class="muted">${esc(fam?.kind || "")} · ${evoSrc(fam?.source)}</span></div>
    <div class="evo-rule"><div><span class="muted small">Buy when</span><code>${esc(spec.entry)}</code></div>
      <div><span class="muted small">Sell</span><span>${esc(spec.exit_text || "")}</span></div></div>
    <div class="grid g3" style="margin-top:12px">${r ? st("Holdout exam", r.holdout) + st("Test year, all stocks", r.all) + st("Prior year", r.prior) : ""}
      ${lv ? st(`Live since ${esc(lv.since)}`, lv.stats) : ""}</div>
    ${lv?.signals?.length && lv.status !== "eliminated" ? `<h3>Buys at the next open (${lv.signals.length})</h3><div class="chips">${lv.signals.map((t) => `<a class="chip" href="#chart?t=${encodeURIComponent(t)}" onclick="closeModal()">${esc(t)}</a>`).join("")}</div>` : ""}
    ${lv?.why ? `<p class="small muted">${esc(lv.why)}</p>` : ""}
    ${r?.sim?.curve?.length > 1 ? `<h3>Paper account on the selection stocks</h3><div class="small muted">$10,000 in 10 slots, median of ${r.sim.draws || 1} random pick orders: ${pct(r.sim.total_return, 1, true)}${isNum(r.sim.p10) ? ` (middle 80%: ${pct(r.sim.p10, 1, true)} to ${pct(r.sim.p90, 1, true)})` : ""}, max drawdown ${pct(r.sim.max_drawdown, 1)}${isNum(r.sim.spy_return) ? `, SPY ${pct(r.sim.spy_return, 1, true)} over the same dates` : ""}.</div>
      <div style="height:180px;margin-top:6px"><canvas id="evo-eq"></canvas></div>` : ""}
    ${r?.gens?.length ? `<h3>Generation by generation</h3><div class="tablewrap"><table><tr><th>Gen</th><th class="num">Trades</th><th class="num">Avg trade</th><th class="num">Random</th><th class="num">Edge</th><th class="num">Cumulative z</th></tr>
      ${r.gens.map((g) => `<tr><td>${g.g}</td><td class="num">${g.n}</td><td class="num ${cls(g.mean)}">${pct(g.mean, 2, true)}</td><td class="num">${pct(g.base, 2, true)}</td>
        <td class="num ${cls(g.excess)}">${pct(g.excess, 2, true)}</td><td class="num">${evoZ(g.cum_z)}</td></tr>`).join("")}</table></div>` : ""}
    ${trades.length ? `<h3>${lv?.closed?.length || lv?.open?.length ? "Live trades" : "Recent backtest trades"}</h3><div class="tablewrap" style="max-height:260px;overflow-y:auto"><table>
      <tr><th>Stock</th><th>In</th><th>Out</th><th class="num">Days</th><th class="num">Return</th><th>Exit</th></tr>
      ${trades.slice(0, 60).map((t) => `<tr><td><a href="#chart?t=${encodeURIComponent(t[0])}" onclick="closeModal()">${esc(t[0])}</a></td><td>${esc(t[1])}</td><td>${esc(t[2])}</td>
        <td class="num">${t[4]}</td><td class="num ${cls(t[3])}">${pct(t[3], 2, true)}</td><td class="small muted">${esc(t[5])}</td></tr>`).join("")}</table></div>` : ""}
    ${lv && lv.status !== "eliminated" ? `<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="sm danger" id="evo-retire">Retire from live trial</button></div>` : ""}`);
  if (r?.sim?.curve?.length > 1) lineChart("evo-eq", r.sim.curve.map((p) => p.t), [{ label: "Account", data: r.sim.curve.map((p) => p.v), borderColor: cssv("--accent"), backgroundColor: cssv("--accent-soft"), fill: true }],
    { plugins: { legend: { display: false } } });
  if ($("#evo-retire")) $("#evo-retire").onclick = (e) => guard(async () => { await POST(`/api/evo/live/${encodeURIComponent(sid)}/retire`); closeModal(); toast("Retired."); route(true); }, e.target);
}

function evoRunModal() {
  const d = EVO.defaults;
  openModal(`<button class="x" onclick="closeModal()" aria-label="Close"><svg class="ic"><use href="#i-x"/></svg></button>
    <h2 style="margin-top:0">Run a new evolution</h2>
    <p class="small muted">Downloads fresh prices, backtests every strategy on every stock, and runs the selection. Takes one to three minutes.
      New finalists join the live trial; strategies already on trial keep their record.</p>
    <div class="form">
      <div class="span2"><label>Generations</label><input id="ev-g" type="number" min="2" max="10" value="${d.generations}"></div>
      <div class="span2"><label>Cull per generation</label><input id="ev-c" type="number" min="0" max="0.6" step="0.05" value="${d.cull}"></div>
      <div class="span2"><label>Min trades per generation</label><input id="ev-m" type="number" min="3" max="50" value="${d.min_trades}"></div>
      <div class="span3"><label>Seed (which stocks go in which cohort)</label><input id="ev-s" type="number" value="${d.seed}"></div>
      <div class="span3" style="align-self:end"><button class="primary" id="ev-go" style="width:100%">Start</button></div>
    </div>
    <p class="small muted" style="margin-bottom:0">Running many seeds and keeping the one you like best is itself data snooping. Pick settings once.</p>`);
  $("#ev-go").onclick = (e) => guard(async () => {
    await POST("/api/evo/run", { generations: $("#ev-g").value, cull: $("#ev-c").value, min_trades: $("#ev-m").value, seed: $("#ev-s").value });
    closeModal(); toast("Evolution started."); route(true);
  }, e.target);
}

function evoWire(running) {
  const v = $("#view");
  v.querySelectorAll("[data-sid]").forEach((t) => (t.onclick = (e) => { if (!e.target.closest("a")) evoDetail(t.dataset.sid); }));
  v.querySelectorAll("#evo-gf [data-f]").forEach((c) => (c.onclick = () => {
    evoFilter = c.dataset.f; v.querySelectorAll("#evo-gf .chip").forEach((x) => x.classList.toggle("on", x === c)); evoGrave();
  }));
  ["#evo-new", "#evo-new2"].forEach((s) => $(s) && ($(s).onclick = evoRunModal));
  if ($("#evo-live")) $("#evo-live").onclick = (e) => guard(async () => { await POST("/api/evo/live/refresh"); toast("Refreshing the live trial."); route(true); }, e.target);
  if ($("#evo-run")) $("#evo-run").onchange = (e) => (location.hash = `#evolution?run=${encodeURIComponent(e.target.value)}`);
  clearInterval(evoPoll);
  if (running) evoPoll = setInterval(async () => {
    if (!location.hash.startsWith("#evolution")) return clearInterval(evoPoll);
    const j = await GET("/api/evo/job").catch(() => null);
    if (!j) return;
    if (j.state !== "running") { clearInterval(evoPoll); if (j.state === "done") toast("Evolution job finished."); route(true); return; }
    const box = $("#evo-job");
    if (box) box.outerHTML = evoJob(j);
  }, 1500);
}
