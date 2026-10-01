"use strict";
/* Publishing + autopilot views. Loaded before app.js; uses its helpers (h, api, modal…) at call time. */

const PLAT_ICON = { youtube: "▶️", tiktok: "🎵", instagram: "📸", folder: "📁" };
const STATUS_LABEL = {
  rendering: "Rendering", approval: "Needs approval", scheduled: "Scheduled", publishing: "Publishing…",
  done: "Published", partial: "Partly published", error: "Failed", rejected: "Rejected",
};
const when = (ts) => {
  if (!ts) return "";
  const d = new Date(ts * 1000), now = new Date();
  const day = d.toDateString() === now.toDateString() ? "Today"
    : d.toDateString() === new Date(now.getTime() + 864e5).toDateString() ? "Tomorrow"
      : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};
const toLocalInput = (ts) => {
  const d = new Date(ts * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
};
const tagsText = (tags) => (tags || []).map((t) => "#" + t).join(" ");
const parseTags = (s) => s.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);

// ------------------------------------------------------------------ nav badge
const Nav = (() => {
  async function refresh() {
    try {
      const posts = await api("/api/posts");
      const n = posts.filter((p) => p.status === "approval").length;
      $("#approvalCount").hidden = !n;
      $("#approvalCount").textContent = n;
    } catch { /* server restarting */ }
  }
  function mark() {
    const r = location.hash.replace(/^#\/?/, "").split("/")[0] || "";
    $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === r || (a.dataset.r === "" && r === "p")));
  }
  setInterval(refresh, 10000);
  refresh();
  return { refresh, mark };
})();

// ------------------------------------------------------------------ publish modal
async function publishModal(pid, clip, { fresh = false } = {}) {
  const [soc, ap] = await Promise.all([api("/api/social"), api("/api/autopilot")]);
  if (!soc.accounts.length) {
    const close = modal([h("h2", {}, "No accounts connected"),
      h("p", { class: "muted" }, "Connect YouTube, TikTok, Instagram or a sync folder first."),
      h("div", { class: "row", style: { justifyContent: "flex-end" } },
        h("a", { class: "btn", href: "#/accounts", onclick: () => close() }, "Connect accounts →"))]);
    return;
  }
  const preset = new Set(ap.accounts.length ? ap.accounts : soc.accounts.map((a) => a.id));
  const checks = soc.accounts.map((a) => {
    const cb = h("input", { type: "checkbox", value: a.id, checked: preset.has(a.id) });
    return h("label", { class: "acct-pick" }, cb, h("span", {}, PLAT_ICON[a.platform] || "•"), a.name);
  });
  const title = h("input", { type: "text", value: clip.title, maxlength: 100 });
  const text = h("textarea", { rows: 3 }, clip.hook || "");
  const tags = h("input", { type: "text", value: tagsText(parseTags(ap.hashtags)) });
  const privacy = h("select", {}, ["public", "unlisted", "private"].map((v) => h("option", { value: v, selected: v === ap.privacy }, v)));
  const tkMode = h("select", {}, h("option", { value: "direct", selected: ap.tiktok_mode === "direct" }, "Post directly"),
    h("option", { value: "draft", selected: ap.tiktok_mode === "draft" }, "Send to TikTok drafts/inbox"));
  const whenSel = h("select", {}, h("option", { value: "now" }, "Right now"), h("option", { value: "slot" }, "Next free time slot"),
    h("option", { value: "at" }, "Pick a time…"));
  const nextSlot = (await api("/api/posts/next-slot")).at;
  const atIn = h("input", { type: "datetime-local", value: toLocalInput(nextSlot), hidden: true });
  whenSel.onchange = () => (atIn.hidden = whenSel.value !== "at");
  whenSel.options[1].textContent = `Next free time slot (${when(nextSlot)})`;
  const exports = clip.exports || [];
  const rerender = h("input", { type: "checkbox", checked: fresh || !exports.length, disabled: !exports.length });
  const gen = h("button", { class: "btn small ghost", onclick: () => generate() }, "✨ Write it for me");
  async function generate() {
    gen.disabled = true;
    gen.textContent = "Writing…";
    try {
      const c = await api(`/api/projects/${pid}/clips/${clip.id}/caption`, { method: "POST", json: {} });
      title.value = c.title;
      text.value = c.text;
      tags.value = tagsText(c.hashtags);
    } catch (e) { toast(e.message, true); }
    gen.disabled = false;
    gen.textContent = "✨ Write it for me";
  }
  const go = h("button", { class: "btn", onclick: () => submit() }, "🚀 Publish");
  async function submit() {
    const accounts = checks.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value);
    if (!accounts.length) return toast("Pick at least one account", true);
    const w = whenSel.value === "at" ? new Date(atIn.value).getTime() / 1000 : whenSel.value;
    go.disabled = true;
    try {
      const p = await api("/api/posts", {
        method: "POST", json: {
          pid, cid: clip.id, accounts, title: title.value, text: text.value, hashtags: parseTags(tags.value),
          privacy: privacy.value, tiktok_mode: tkMode.value, when: w, rerender: rerender.checked,
        },
      });
      close();
      toast(p.status === "rendering" ? "Rendering, then publishing — see Publish" : p.at && p.at > Date.now() / 1000 + 60
        ? `Scheduled for ${when(p.at)}` : "Publishing now — see Publish");
      Nav.refresh();
    } catch (e) { toast(e.message, true); go.disabled = false; }
  }
  const close = modal([
    h("h2", {}, "Publish clip"),
    h("label", {}, "Post to"), h("div", { class: "acct-picks" }, checks),
    h("div", { class: "row", style: { marginTop: "12px" } }, h("label", { class: "grow", style: { margin: 0 } }, "Title"), gen),
    title,
    h("label", {}, "Caption"), text,
    h("label", {}, "Hashtags"), tags,
    h("div", { class: "two", style: { marginTop: "4px" } },
      h("div", {}, h("label", {}, "Visibility (YouTube / TikTok)"), privacy),
      h("div", {}, h("label", {}, "TikTok"), tkMode)),
    h("div", { class: "two" }, h("div", {}, h("label", {}, "When"), whenSel), h("div", {}, h("label", {}, " "), atIn)),
    h("label", { class: "switch", style: { marginTop: "12px" } }, rerender,
      exports.length ? `Re-render first (otherwise uses the export from ${ago(exports[exports.length - 1].at)})` : "Renders the clip first (no export yet)"),
    h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "16px" } },
      h("button", { class: "btn ghost", onclick: () => close() }, "Cancel"), go),
  ]);
  $(".modal").style.width = "min(620px, 94vw)";
  generate();
}

// ------------------------------------------------------------------ publish queue view
async function publishView(view) {
  const wrap = h("div");
  view.append(h("div", { class: "phead" }, h("div", { class: "grow" }, h("h1", {}, "Publishing"),
    h("div", { class: "muted" }, "Everything queued, scheduled and posted. Autopilot posts land here too.")),
  h("a", { class: "btn ghost", href: "#/autopilot" }, "🤖 Autopilot settings")), wrap);
  let sig = "";
  async function load(force) {
    const posts = await api("/api/posts");
    const s = JSON.stringify(posts);
    if (s === sig && !force) return;
    sig = s;
    Nav.refresh();
    wrap.innerHTML = "";
    if (!posts.length) {
      wrap.append(h("div", { class: "empty" }, "Nothing published yet. Hit 🚀 Publish on any clip, or turn on Autopilot."));
      return;
    }
    const groups = [
      ["Needs your approval", (p) => p.status === "approval"],
      ["Up next", (p) => ["rendering", "scheduled", "publishing"].includes(p.status)],
      ["Problems", (p) => ["error", "partial"].includes(p.status)],
      ["Published", (p) => p.status === "done"],
      ["Rejected", (p) => p.status === "rejected"],
    ];
    for (const [name, fn] of groups) {
      let items = posts.filter(fn);
      if (!items.length) continue;
      if (name === "Up next") items = items.sort((a, b) => (a.at || 1e12) - (b.at || 1e12));
      const head = h("div", { class: "row", style: { margin: "18px 0 8px" } }, h("h2", { style: { margin: 0 }, class: "grow" }, `${name} (${items.length})`));
      if (name === "Needs your approval" && items.length > 1) {
        head.append(h("button", {
          class: "btn small", onclick: async () => {
            for (const p of items) await api(`/api/posts/${p.id}`, { method: "PATCH", json: { action: "approve" } });
            load(true);
          },
        }, "✓ Approve all"));
      }
      wrap.append(head, h("div", { class: "posts" }, items.map(postRow)));
    }
  }
  function postRow(p) {
    const url = p.file ? `/api/projects/${p.pid}/exports/${encodeURIComponent(p.file)}` : null;
    const editable = ["approval", "scheduled", "error", "rejected"].includes(p.status);
    const act = (action, extra = {}) => async () => {
      try { await api(`/api/posts/${p.id}`, { method: "PATCH", json: { action, ...extra } }); load(true); } catch (e) { toast(e.message, true); }
    };
    return h("div", { class: `post st-${p.status}` },
      h("div", { class: "post-thumb", style: { backgroundImage: `url(/api/projects/${p.pid}/thumbs/${p.cid}.jpg)` }, onclick: () => url && playModal(url, p.title) },
        url ? h("span", {}, "▶") : null),
      h("div", { class: "grow", style: { minWidth: 0 } },
        h("div", { class: "row", style: { gap: "8px" } },
          h("b", { class: "post-title", title: p.title }, p.title),
          h("span", { class: `badge st-${p.status}` }, STATUS_LABEL[p.status] || p.status),
          p.origin === "autopilot" ? h("span", { class: "chip" }, "🤖 autopilot") : null),
        h("div", { class: "muted post-cap" }, [p.text, tagsText(p.hashtags)].filter(Boolean).join("  ")),
        h("div", { class: "muted", style: { fontSize: "12px", marginTop: "4px" } },
          h("a", { href: `#/p/${p.pid}/c/${p.cid}`, style: { textDecoration: "underline" } }, p.project || "project"),
          p.status === "rendering" ? ` · rendering ${Math.round((p.progress || 0) * 100)}%` : "",
          p.at && p.status !== "done" ? ` · ${p.status === "approval" ? "" : "⏰ "}${when(p.at)}` : "",
          p.status === "approval" ? ` · posts ${p.when === "now" ? "right away" : p.when === "slot" ? "in the next free slot" : `at ${when(p.when)}`} once approved` : "",
          p.error ? ` · ⚠ ${p.error}` : ""),
        h("div", { class: "targets" }, p.targets.map((t) => h("span", { class: `target st-${t.status}`, title: t.error || t.note || "" },
          PLAT_ICON[t.platform] || "•", " ", t.name, " · ",
          t.url ? h("a", { href: t.url, target: "_blank" }, "view ↗") : t.status === "error" ? `failed${t.attempts ? ` (${t.attempts}×)` : ""}` : t.status,
          t.status === "error" && t.error ? h("div", { class: "terr" }, t.error) : null,
          t.note ? h("div", { class: "tnote" }, t.note) : null)))),
      h("div", { class: "post-actions" },
        p.status === "approval" ? [h("button", { class: "btn small", onclick: act("approve") }, "✓ Approve"),
          h("button", { class: "btn small ghost", onclick: act("approve", { when: "now" }) }, "Post now")] : null,
        p.status === "scheduled" ? h("button", { class: "btn small ghost", onclick: act("publish_now") }, "Post now") : null,
        ["error", "partial"].includes(p.status) ? h("button", { class: "btn small", onclick: act("publish_now") }, "↻ Retry") : null,
        editable ? h("button", { class: "btn small ghost", onclick: () => editPost(p) }, "✏️ Edit") : null,
        p.status === "approval" ? h("button", { class: "btn small ghost", onclick: act("reject") }, "✕ Reject") : null,
        p.status !== "publishing" ? h("button", {
          class: "icon", title: "Remove from list", onclick: async () => {
            if (p.status === "done" || await confirmBox("Remove this post from the queue?", "Remove")) {
              await api(`/api/posts/${p.id}`, { method: "DELETE" });
              load(true);
            }
          },
        }, "🗑") : null));
  }
  function editPost(p) {
    const title = h("input", { type: "text", value: p.title, maxlength: 100 });
    const text = h("textarea", { rows: 3 }, p.text);
    const tags = h("input", { type: "text", value: tagsText(p.hashtags) });
    const at = p.status === "scheduled" ? h("input", { type: "datetime-local", value: toLocalInput(p.at) }) : null;
    const close = modal([h("h2", {}, "Edit post"), h("label", {}, "Title"), title, h("label", {}, "Caption"), text,
      h("label", {}, "Hashtags"), tags, at ? [h("label", {}, "Scheduled for"), at] : null,
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn ghost", onclick: () => close() }, "Cancel"),
        h("button", {
          class: "btn", onclick: async () => {
            const json = { title: title.value, text: text.value, hashtags: parseTags(tags.value) };
            if (at) json.at = new Date(at.value).getTime() / 1000;
            await api(`/api/posts/${p.id}`, { method: "PATCH", json });
            close();
            load(true);
          },
        }, "Save"))]);
    $(".modal").style.width = "min(560px, 94vw)";
  }
  await load(true);
  every(3000, () => load());
}

// ------------------------------------------------------------------ accounts view
async function accountsView(view) {
  const wrap = h("div");
  view.append(h("div", { class: "phead" }, h("div", { class: "grow" }, h("h1", {}, "Connected accounts"),
    h("div", { class: "muted" }, "Logins and tokens are stored only on this computer (data/social/)."))), wrap);
  const onMsg = (e) => e.data === "social-connected" && load();
  window.addEventListener("message", onMsg);
  onTeardown(() => window.removeEventListener("message", onMsg));
  async function load() {
    const S = await api("/api/social");
    wrap.innerHTML = "";
    for (const key of ["youtube", "tiktok", "instagram", "folder"].filter((k) => S.platforms[k])) {
      const P = S.platforms[key];
      const accts = S.accounts.filter((a) => a.platform === key);
      const card = h("div", { class: "plat" },
        h("div", { class: "row" }, h("span", { class: "plat-icon" }, PLAT_ICON[key]), h("h2", { class: "grow", style: { margin: 0 } }, P.name),
          P.kind === "oauth" && P.app ? h("span", { class: "muted", style: { fontSize: "12px" } }, `✓ developer app set${P.appFrom ? ` (from ${P.appFrom})` : ""}`) : null),
        accts.length ? h("div", { class: "accts" }, accts.map((a) => h("div", { class: "acct" },
          a.avatar ? h("img", { src: a.avatar }) : h("span", { class: "plat-icon" }, PLAT_ICON[key]),
          h("div", { class: "grow" }, h("b", {}, a.name), h("div", { class: "muted", style: { fontSize: "12px" } },
            a.error ? h("span", { style: { color: "var(--bad)" } }, `⚠ ${a.error}`) : `connected ${ago(a.created)}`)),
          h("button", {
            class: "btn small ghost", onclick: async (e) => {
              e.target.disabled = true;
              try { await api(`/api/social/accounts/${a.id}/check`, { method: "POST" }); toast(`${a.name} works ✓`); } catch (err) { toast(err.message, true); }
              load();
            },
          }, "Test"),
          h("button", {
            class: "icon", title: "Disconnect", onclick: async () => {
              if (await confirmBox(`Disconnect ${a.name}?`, "Disconnect")) { await api(`/api/social/accounts/${a.id}`, { method: "DELETE" }); load(); }
            },
          }, "🗑")))) : null,
        h("div", { class: "row", style: { marginTop: "10px", flexWrap: "wrap" } }, connectUI(key, P, S)),
        h("details", { class: "help" }, h("summary", {}, "How to set this up"), h("p", {}, P.help),
          S.redirects[key] ? h("p", {}, "Redirect URI to register: ", h("code", {}, S.redirects[key])) : null,
          P.kind === "oauth" && P.app ? h("button", {
            class: "btn small ghost", onclick: async () => {
              if (await confirmBox(`Remove the ${P.name} developer app credentials?`, "Remove")) {
                await api(`/api/social/apps/${key}`, { method: "POST", json: { clear: true } });
                load();
              }
            },
          }, "Replace developer app credentials") : null));
      wrap.append(card);
    }
  }
  function connectUI(key, P, S) {
    if (P.kind === "oauth" && !P.app) {
      if (P.appFields.some((f) => f.type === "file")) {
        const f = h("input", { type: "file", accept: ".json", hidden: true });
        f.onchange = async () => {
          const fd = new FormData();
          fd.append("client", f.files[0]);
          const r = await fetch(`/api/social/apps/${key}`, { method: "POST", body: fd });
          const d = await r.json();
          r.ok ? (toast("Saved ✓ — now click Connect"), load()) : toast(d.error, true);
        };
        return [f, h("button", { class: "btn", onclick: () => f.click() }, "Upload OAuth client JSON"),
          h("span", { class: "muted" }, "One-time setup — see “How to set this up” below")];
      }
      const ins = P.appFields.map((fd) => h("input", { type: "text", placeholder: fd.label, name: fd.name, style: { flex: "1 1 220px" } }));
      return [...ins, h("button", {
        class: "btn", onclick: async () => {
          try {
            await api(`/api/social/apps/${key}`, { method: "POST", json: Object.fromEntries(ins.map((i) => [i.name, i.value])) });
            toast("Saved ✓ — now click Connect");
            load();
          } catch (e) { toast(e.message, true); }
        },
      }, "Save")];
    }
    if (P.kind === "oauth") {
      return [h("button", { class: "btn", onclick: () => oauthConnect(key, P) }, `＋ Connect ${P.name} account`),
        key === "youtube" && P.streamClipperToken ? h("button", {
          class: "btn ghost", onclick: async () => {
            try { const r = await api("/api/social/import/stream-clipper", { method: "POST" }); toast(`Connected ${r.account.name}`); load(); } catch (e) { toast(e.message, true); }
          },
        }, "Use stream-clipper's login") : null];
    }
    const ins = P.connectFields.map((fd) => h("input", { type: "text", placeholder: fd.label, name: fd.name, style: { flex: "1 1 260px" } }));
    return [...ins, h("button", {
      class: "btn", onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await api(`/api/social/connect/${key}`, { method: "POST", json: Object.fromEntries(ins.map((i) => [i.name, i.value])) });
          toast(`Connected ${r.account.name}`);
          load();
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      },
    }, "＋ Connect")];
  }
  async function oauthConnect(key, P) {
    let r;
    try { r = await api(`/api/social/connect/${key}`, { method: "POST" }); } catch (e) { return toast(e.message, true); }
    window.open(r.url, "_blank");
    const paste = h("input", { type: "text", placeholder: "http://…?code=…&state=…" });
    const close = modal([h("h2", {}, `Connect ${P.name}`),
      h("p", {}, "A login tab opened — sign in and allow access. This page updates by itself when it's done."),
      h("p", { class: "muted" }, "If you ended up on a page that didn't load, copy its full address from the address bar and paste it here:"),
      paste,
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "14px" } },
        h("a", { class: "btn ghost", href: r.url, target: "_blank" }, "Open login again"),
        h("button", {
          class: "btn", onclick: async () => {
            try { const x = await api("/api/social/oauth/paste", { method: "POST", json: { url: paste.value } }); toast(`Connected ${x.account.name}`); close(); load(); } catch (e) { toast(e.message, true); }
          },
        }, "Finish"))]);
    const done = (e) => { if (e.data === "social-connected") { close(); window.removeEventListener("message", done); } };
    window.addEventListener("message", done);
  }
  await load();
}

// ------------------------------------------------------------------ autopilot view
async function autopilotView(view) {
  const [S, soc] = await Promise.all([api("/api/autopilot"), api("/api/social")]);
  const save = debounce(async (patch) => {
    try { Object.assign(S, await api("/api/autopilot", { method: "PUT", json: patch })); toast("Saved"); } catch (e) { toast(e.message, true); }
  }, 500);
  const patch = {};
  const set = (k, v) => { patch[k] = v; save({ ...patch }); };
  const sw = (k, label, hint) => h("label", { class: "switch ap-switch" },
    h("input", { type: "checkbox", checked: S[k], onchange: (e) => set(k, e.target.checked) }),
    h("div", {}, h("b", {}, label), hint ? h("div", { class: "muted", style: { fontSize: "12px" } }, hint) : null));
  const num = (k, label, min, max) => h("div", {}, h("label", {}, label),
    h("input", { type: "number", value: S[k], min, max, onchange: (e) => set(k, +e.target.value) }));
  const sel = (k, label, opts) => h("div", {}, h("label", {}, label),
    h("select", { onchange: (e) => set(k, e.target.value) }, opts.map(([v, t]) => h("option", { value: v, selected: S[k] === v }, t))));
  const txt = (k, label, ph) => h("div", {}, h("label", {}, label),
    h("input", { type: "text", value: S[k], placeholder: ph, onchange: (e) => set(k, e.target.value) }));

  const accts = soc.accounts.length ? h("div", { class: "acct-picks" }, soc.accounts.map((a) => h("label", { class: "acct-pick" },
    h("input", {
      type: "checkbox", checked: S.accounts.includes(a.id), onchange: () => set("accounts",
        $$(".ap-acct input:checked").map((i) => i.value)), value: a.id,
    }), PLAT_ICON[a.platform], " ", a.name)))
    : h("div", { class: "muted" }, "No accounts connected yet — ", h("a", { href: "#/accounts", style: { textDecoration: "underline" } }, "connect some"), ".");
  accts.classList?.add("ap-acct");

  const slotsIn = h("input", { type: "text", value: S.slots.join(", "), placeholder: "12:00, 17:00, 20:30", onchange: (e) => set("slots", e.target.value.split(/[\s,]+/).filter(Boolean)) });
  const proj = settingsFields(S.project);
  proj.addEventListener("change", () => set("project", readSettings(proj)));

  const srcList = h("div", { class: "sources" });
  const srcUrl = h("input", { type: "url", placeholder: "Channel / playlist link — e.g. https://www.youtube.com/@creator" });
  const backfill = h("input", { type: "number", value: 0, min: 0, max: 10, title: "Also import this many of the latest existing videos", style: { width: "80px" } });
  async function loadSources() {
    const s = await api("/api/autopilot");
    srcList.innerHTML = "";
    if (!s.sources.length) srcList.append(h("div", { class: "muted" }, "No watched sources yet."));
    for (const src of s.sources) {
      srcList.append(h("div", { class: "source" },
        h("input", { type: "checkbox", title: "Enabled", checked: src.enabled, onchange: (e) => api(`/api/autopilot/sources/${src.id}`, { method: "PATCH", json: { enabled: e.target.checked } }) }),
        h("div", { class: "grow", style: { minWidth: 0 } }, h("b", {}, src.name || src.url),
          h("div", { class: "muted", style: { fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
            src.url, " · ", src.checked ? `checked ${ago(src.checked)}` : "checking…", ` · ${src.imported || 0} imported`,
            src.error ? h("span", { style: { color: "var(--bad)" } }, ` · ⚠ ${src.error}`) : "")),
        h("button", {
          class: "btn small ghost", onclick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = "Checking…";
            try { const r = await api(`/api/autopilot/sources/${src.id}/check`, { method: "POST" }); toast(r.new ? `Importing ${r.new} new video(s)` : "No new videos"); } catch (err) { toast(err.message, true); }
            loadSources();
          },
        }, "Check now"),
        h("button", { class: "icon", title: "Stop watching", onclick: async () => { await api(`/api/autopilot/sources/${src.id}`, { method: "DELETE" }); loadSources(); } }, "🗑")));
    }
  }

  view.append(
    h("div", { class: "phead" }, h("div", { class: "grow" }, h("h1", {}, "🤖 Autopilot"),
      h("div", { class: "muted" }, "Leave Clip Studio running and it finds new videos, cuts the best clips, writes captions and posts them on a schedule."))),
    h("div", { class: "ap-grid" },
      h("section", { class: "panel" }, h("h2", {}, "1 · Watch for new videos"),
        h("p", { class: "muted" }, "New uploads from these channels/playlists are imported automatically (YouTube, Twitch VODs, anything yt-dlp supports)."),
        h("div", { class: "row src-add" }, srcUrl, h("span", { class: "muted", style: { fontSize: "12px", whiteSpace: "nowrap" }, title: "Also import this many of the newest existing videos" }, "import latest"), backfill,
          h("button", {
            class: "btn", onclick: async () => {
              try { await api("/api/autopilot/sources", { method: "POST", json: { url: srcUrl.value, backfill: backfill.value } }); srcUrl.value = ""; toast("Watching ✓"); loadSources(); setTimeout(loadSources, 8000); } catch (e) { toast(e.message, true); }
            },
          }, "＋ Watch")),
        srcList,
        h("div", { class: "two", style: { marginTop: "12px" } }, num("watch_interval", "Check every (minutes)", 5, 1440), num("max_video_min", "Skip videos longer than (min)", 1, 1440)),
        h("details", { class: "help", open: false }, h("summary", {}, "Clip finding settings for imported videos"), proj)),
      h("section", { class: "panel" }, h("h2", {}, "2 · Pick & render clips"),
        sw("auto_new", "Use autopilot for videos I import by hand too", "Pre-ticks the Autopilot box on the home page"),
        h("div", { class: "two" }, num("export_top", "Render the best N clips per video", 1, 20), num("min_score", "…with a score of at least", 0, 99)),
        h("h2", { style: { marginTop: "18px" } }, "3 · Post them"),
        sw("auto_publish", "Publish automatically", "Off = just render the clips"),
        sw("approval", "Ask me before posting", "Clips wait under Publish → Needs approval (and ping your phone if ntfy is set)"),
        h("label", {}, "Post to"), accts,
        h("div", {}, h("label", {}, "Daily time slots (one post per slot, local time)"), slotsIn),
        h("div", { class: "two" },
          sel("privacy", "Visibility", [["public", "Public"], ["unlisted", "Unlisted (YouTube)"], ["private", "Private"]]),
          sel("tiktok_mode", "TikTok", [["direct", "Post directly"], ["draft", "Send to drafts (inbox)"]])),
        h("div", { class: "two" },
          sel("caption_engine", "Captions written by", [["auto", CFG.claude ? "Claude (auto)" : "Auto (local; Claude if key set)"], ["local", "Local keywords"], ["claude", "Claude"]]),
          txt("hashtags", "Always add hashtags", "fyp viral")),
        txt("ntfy", "Phone notifications — ntfy.sh topic (optional)", "e.g. clipstudio-ben-x7k2"),
        h("div", { class: "hint" }, "Install the ntfy app, subscribe to the same topic, and you'll get a ping for approvals, posts and failures."))));
  await loadSources();
  every(5000, async () => { if (!document.activeElement || !document.activeElement.closest(".sources")) await loadSources(); });
}
