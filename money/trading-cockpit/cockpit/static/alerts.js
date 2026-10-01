// Alerts tab: watchlist, custom price alerts, alert history, phone setup.
"use strict";

VIEWS.alerts = async function () {
  const [a, wq] = await Promise.all([GET("/api/alerts"), GET("/api/watchlist/quotes")]);
  const st = a.status || {};
  const kindOpts = Object.entries(a.kinds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("#view").innerHTML = `
  <div class="panel"><h2>Phone alerts</h2>
    <div class="hint">Install the free <b>ntfy</b> app (Android / iOS), tap +, and subscribe to topic
      <code>${esc(a.topic)}</code>. Anyone who knows the topic name can read it, so keep it to yourself. The cockpit scans every
      ${S.settings.alert_fast_min} min while a market you watch is open, every ${S.settings.alert_slow_min} min otherwise, as long as it's running
      (see SETUP.md to keep it running in the background).</div>
    <div class="row"><button id="al-test">Send test alert</button><button id="al-run">Scan now</button>
      <span class="small muted">${st.last_run ? `Last scan ${esc(st.last_run.slice(11, 16))} UTC · ${st.tickers} tickers · ${st.last_new} new` : "Not scanned yet"}${st.next_run ? ` · next ${esc(st.next_run.slice(11, 16))} UTC` : ""}</span></div>
    <p class="small muted">Automatic for every open trade: stop hit, target hit (paper trades sell themselves if auto-exit is on),
      planned hold time used up. For planned trades: price reaches your entry. For every watched ticker: earnings within
      ${S.settings.alert_earnings_days} days, volume ≥ ${S.settings.alert_volume_mult}× normal, new 52-week high/low, a move ≥ ${S.settings.alert_move_sigma}×
      its usual daily swing${S.settings.sec_user_agent ? ", and insiders buying with their own money (SEC Form 4)" : `. Insider-buy alerts are off until you add an SEC contact in <a href="#settings">Settings</a>`}.
      Saved Lab strategies with alerts on notify you when their entry rule fires.</p>
  </div>
  <div class="grid g2">
    <div class="panel"><h2>Watchlist</h2>
      <div class="row"><input id="w-t" placeholder="ticker" style="max-width:130px"><input id="w-n" placeholder="note (why you're watching)"><button id="w-add">Add</button></div>
      ${wq.length ? `<div class="tablewrap"><table><tr><th>Ticker</th><th class="num">Price</th><th class="num">Today</th><th>Earnings</th><th>Note</th><th></th></tr>
        ${wq.map((w) => `<tr><td>${tkLink(w.ticker)}</td><td class="num">${num(w.price)}</td><td class="num">${delta(w.change_pct)}</td>
          <td>${esc((w.earnings || "").slice(0, 10)) || "—"}</td><td class="small muted">${esc(w.note)}</td>
          <td><a class="sm" href="#check?t=${encodeURIComponent(w.ticker)}">check</a> <button class="sm danger" data-unwatch="${esc(w.ticker)}">×</button></td></tr>`).join("")}</table></div>`
        : `<div class="empty small">Add stocks you're interested in. You'll hear about earnings, volume spikes, big moves and insider buying.</div>`}
      ${a.watched.length ? `<p class="small muted">Also scanned because of open/planned trades or price alerts: ${a.watched.filter((t) => !wq.some((w) => w.ticker === t)).map(esc).join(", ") || "—"}</p>` : ""}
    </div>
    <div class="panel"><h2>Price alerts</h2>
      <div class="row"><input id="r-t" placeholder="ticker" style="max-width:110px"><select id="r-k" style="max-width:220px">${kindOpts}</select>
        <input id="r-v" type="number" step="any" placeholder="value" style="max-width:110px"><input id="r-n" placeholder="note"><button id="r-add">Add</button></div>
      ${a.rules.length ? `<table><tr><th>Ticker</th><th>When</th><th class="num">Value</th><th>Note</th><th>Status</th><th></th></tr>
        ${a.rules.map((r) => `<tr><td><b>${esc(r.ticker)}</b></td><td>${esc(a.kinds[r.kind] || r.kind)}</td><td class="num">${num(r.value)}</td><td class="small muted">${esc(r.note)}</td>
          <td>${r.active ? '<span class="pill open">active</span>' : '<span class="pill closed">fired</span>'}</td><td><button class="sm danger" data-delrule="${r.id}">×</button></td></tr>`).join("")}</table>`
        : `<div class="empty small">One-off alerts: "tell me if NVDA drops below 150". Above/below alerts switch off once they fire; % move alerts fire at most once a day.</div>`}
    </div>
  </div>
  <div class="panel"><h2>Alert history</h2>
    ${a.log.length ? `<div class="tablewrap"><table><tr><th>When (UTC)</th><th>Ticker</th><th>Alert</th><th>Details</th><th>Phone</th></tr>
      ${a.log.map((l) => `<tr><td>${esc(l.ts.slice(0, 16).replace("T", " "))}</td><td>${esc(l.ticker || "")}</td><td><b>${esc(l.title)}</b></td><td class="small">${esc(l.message)}</td><td>${l.sent ? "✓" : '<span class="muted">not sent</span>'}</td></tr>`).join("")}</table></div>`
      : `<div class="empty small">Nothing yet.</div>`}
  </div>`;
  $("#al-test").onclick = (e) => guard(async () => { await POST("/api/alerts/test"); toast("Sent. Check your phone."); }, e.target);
  $("#al-run").onclick = (e) => guard(async () => { e.target.textContent = "Scanning…"; const r = await POST("/api/alerts/run"); toast(`${r.last_new} new alert(s).`); route(); }, e.target);
  $("#w-add").onclick = (e) => guard(async () => { await POST("/api/watchlist", { ticker: $("#w-t").value, note: $("#w-n").value }); route(); }, e.target);
  $("#w-t").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#w-add").click(); });
  $("#r-add").onclick = (e) => guard(async () => {
    await POST("/api/alert_rules", { ticker: $("#r-t").value, kind: $("#r-k").value, value: $("#r-v").value, note: $("#r-n").value }); route();
  }, e.target);
  $("#view").querySelectorAll("[data-unwatch]").forEach((b) => (b.onclick = () => guard(async () => { await api("DELETE", `/api/watchlist/${encodeURIComponent(b.dataset.unwatch)}`); route(); }, b)));
  $("#view").querySelectorAll("[data-delrule]").forEach((b) => (b.onclick = () => guard(async () => { await api("DELETE", `/api/alert_rules/${b.dataset.delrule}`); route(); }, b)));
};
