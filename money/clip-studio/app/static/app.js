"use strict";
/* Clip Studio front end: hash router with three views (home, project, editor),
   a canvas preview that mirrors the ffmpeg/libass export, and an export queue drawer. */

// ------------------------------------------------------------------ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

function put(el, ...kids) {
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k);
}

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) {
    o.body = JSON.stringify(o.json);
    o.headers = { "Content-Type": "application/json" };
    delete o.json;
  }
  const r = await fetch(path, o);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status} ${r.statusText}`);
  return data;
}

function fmt(t, dec = false) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = dec ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return `${m}:${ss}`;
}
function parseTime(s) {
  s = String(s).trim();
  if (!s) return NaN;
  return s.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ago = (t) => {
  const d = Date.now() / 1000 - t;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(t * 1000).toLocaleDateString();
};
function debounce(fn, ms) {
  let id;
  const d = (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(id); fn(...a); };
  return d;
}
let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), err ? 5000 : 2600);
}
function modal(content, { onClose } = {}) {
  const bg = h("div", { class: "modal-bg" }, h("div", { class: "modal" }, content));
  const close = () => { bg.remove(); document.removeEventListener("keydown", esc); onClose && onClose(); };
  const esc = (e) => e.key === "Escape" && close();
  bg.addEventListener("mousedown", (e) => e.target === bg && close());
  document.addEventListener("keydown", esc);
  document.body.append(bg);
  return close;
}
function confirmBox(text, okLabel = "Delete") {
  return new Promise((res) => {
    let done = false;
    const close = modal([
      h("h2", {}, text),
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn ghost", onclick: () => { done = true; close(); res(false); } }, "Cancel"),
        h("button", { class: "btn danger", onclick: () => { done = true; close(); res(true); } }, okLabel)),
    ], { onClose: () => !done && res(false) });
  });
}
const scoreColor = (s) => (s == null ? "#8d93a3" : s >= 85 ? "#22c55e" : s >= 70 ? "#a3e635" : s >= 55 ? "#f59e0b" : "#ef4444");

// ------------------------------------------------------------------ app state + router
let CFG = null;
let teardown = [];
const onTeardown = (fn) => teardown.push(fn);

async function route() {
  teardown.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  teardown = [];
  if (!CFG) CFG = await api("/api/config");
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = $("#view");
  view.className = "";
  view.innerHTML = "";
  $("#crumbs").innerHTML = "";
  try {
    Nav.mark();
    if (parts[0] === "p" && parts[2] === "c") await editorView(view, parts[1], parts[3]);
    else if (parts[0] === "p") await projectView(view, parts[1]);
    else if (parts[0] === "publish") await publishView(view);
    else if (parts[0] === "accounts") await accountsView(view);
    else if (parts[0] === "autopilot") await autopilotView(view);
    else await homeView(view);
  } catch (e) {
    console.error(e);
    view.append(h("div", { class: "error-box" }, `Couldn't load this page: ${e.message}`), h("a", { href: "#/", class: "btn ghost" }, "← Home"));
  }
}
window.addEventListener("hashchange", route);

function crumbs(...items) {
  const c = $("#crumbs");
  c.innerHTML = "";
  items.forEach((it, i) => {
    c.append(h("span", {}, "/"));
    c.append(it.href ? h("a", { href: it.href }, h("span", {}, it.text)) : h("span", { style: { color: "var(--text)" } }, it.text));
  });
}

function every(ms, fn) {
  let stop = false, id;
  const tick = async () => {
    if (stop) return;
    try { await fn(); } catch (e) { console.error(e); }
    if (!stop) id = setTimeout(tick, ms);
  };
  id = setTimeout(tick, ms);
  const cancel = () => { stop = true; clearTimeout(id); };
  onTeardown(cancel);
  return cancel;
}

// ------------------------------------------------------------------ home
function settingsFields(s = {}) {
  const engineOpts = [h("option", { value: "local" }, "Local (free, offline)"),
    h("option", { value: "claude", disabled: !CFG.claude }, CFG.claude ? "Claude AI (smarter)" : "Claude AI (set ANTHROPIC_API_KEY)")];
  const box = h("div", { class: "settings" },
    h("div", {}, h("label", {}, "Min length (s)"), h("input", { type: "number", name: "minLen", value: s.minLen ?? 20, min: 5, max: 170 })),
    h("div", {}, h("label", {}, "Max length (s)"), h("input", { type: "number", name: "maxLen", value: s.maxLen ?? 60, min: 10, max: 180 })),
    h("div", {}, h("label", {}, "Clips to find"), h("input", { type: "number", name: "count", value: s.count ?? 10, min: 1, max: 40 })),
    h("div", {}, h("label", {}, "Transcription"),
      h("select", { name: "model" }, CFG.models.map((m) => h("option", { value: m, selected: m === (s.model || "small") },
        { base: "base — fastest", small: "small — balanced", medium: "medium — accurate", "large-v3-turbo": "large-v3-turbo — best" }[m] || m)))),
    h("div", {}, h("label", {}, "Language"), h("input", { type: "text", name: "language", value: s.language || "", placeholder: "auto (en, es, sv…)" })),
    h("div", {}, h("label", {}, "Clip finder"), h("select", { name: "engine" }, engineOpts)),
    h("div", { class: "wide", style: { gridColumn: "span 6" } }, h("label", {}, "Focus (optional) — what kind of moments do you want?"),
      h("input", { type: "text", name: "focus", value: s.focus || "", placeholder: "e.g. funny reactions, money advice, hot takes, stories" })));
  if (s.engine) box.querySelector("[name=engine]").value = s.engine;
  return box;
}
const readSettings = (root) => Object.fromEntries($$("input[name],select[name]", root).map((i) => [i.name, i.value]));

async function homeView(view) {
  const urlIn = h("input", { type: "url", placeholder: "Paste a YouTube / Twitch / any video link…" });
  const fileIn = h("input", { type: "file", accept: "video/*,.mkv,.flv,.ts", hidden: true });
  const settings = settingsFields();
  const autoBox = h("input", { type: "checkbox", checked: CFG.autopilot });
  const upBar = h("div", { class: "bar hidden" }, h("div", { style: { width: "0%" } }));
  const go = h("button", { class: "btn", onclick: () => create() }, "✨ Get clips");
  const drop = h("div", { class: "drop", onclick: () => fileIn.click() }, "or drop a video file here / click to upload");

  async function create(file) {
    const fd = new FormData();
    Object.entries(readSettings(settings)).forEach(([k, v]) => fd.append(k, v));
    if (autoBox.checked) fd.append("autopilot", "1");
    if (file) fd.append("file", file);
    else if (urlIn.value.trim()) fd.append("url", urlIn.value.trim());
    else return toast("Paste a link or pick a file first", true);
    go.disabled = true;
    try {
      const p = await new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open("POST", "/api/projects");
        x.upload.onprogress = (e) => {
          if (!file || !e.total) return;
          upBar.classList.remove("hidden");
          upBar.firstChild.style.width = `${(100 * e.loaded) / e.total}%`;
          drop.textContent = `Uploading ${file.name}… ${Math.round((100 * e.loaded) / e.total)}%`;
        };
        x.onload = () => {
          const d = JSON.parse(x.responseText || "{}");
          x.status < 300 ? res(d) : rej(new Error(d.error || x.statusText));
        };
        x.onerror = () => rej(new Error("Upload failed"));
        x.send(fd);
      });
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      toast(e.message, true);
      go.disabled = false;
      drop.textContent = "or drop a video file here / click to upload";
      upBar.classList.add("hidden");
    }
  }
  fileIn.onchange = () => fileIn.files[0] && create(fileIn.files[0]);
  urlIn.addEventListener("keydown", (e) => e.key === "Enter" && create());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) create(f);
  });

  const grid = h("div", { class: "grid" });
  view.append(
    h("section", { class: "hero" },
      h("h1", {}, "Turn long videos into viral shorts"),
      h("p", {}, "Import a video → AI transcribes it, finds the best moments, reframes to vertical with face tracking and adds animated captions. Everything runs on this computer."),
      h("div", { class: "import" }, urlIn, go), drop, fileIn, upBar, settings,
      h("label", { class: "switch", style: { marginTop: "14px" } }, autoBox,
        h("span", {}, "🤖 Autopilot: render the best clips and queue them for posting when it's done ",
          h("a", { href: "#/autopilot", class: "muted", style: { textDecoration: "underline" } }, "(settings)")))),
    h("div", { class: "row", style: { marginBottom: "12px" } }, h("h2", { style: { margin: 0 } }, "Projects")),
    grid);

  async function load() {
    const ps = await api("/api/projects");
    grid.innerHTML = "";
    if (!ps.length) grid.append(h("div", { class: "empty", style: { gridColumn: "1/-1" } }, "No projects yet — paste a link above to start."));
    for (const p of ps) {
      grid.append(h("a", { class: "card", href: `#/p/${p.id}` },
        h("div", { class: "thumb", style: { backgroundImage: `url(/api/projects/${p.id}/thumb?${p.updated || ""})` } }),
        h("button", {
          class: "icon del", title: "Delete project", onclick: async (e) => {
            e.preventDefault();
            if (await confirmBox(`Delete “${p.name}” and all its clips?`)) { await api(`/api/projects/${p.id}`, { method: "DELETE" }); load(); }
          },
        }, "🗑"),
        h("div", { class: "body" },
          h("div", { class: "title", title: p.name }, p.name),
          h("div", { class: "meta" }, statusEl(p), " · ", p.status === "ready" ? `${p.clipCount} clips` : "", p.status === "ready" ? " · " : "",
            p.info ? fmt(p.info.duration) : "", " · ", ago(p.created)),
          p.status === "processing" ? h("div", { class: "bar" }, h("div", { style: { width: `${(p.progress || 0) * 100}%` } })) : null)));
    }
    return ps;
  }
  let ps = await load();
  every(2000, async () => { if (ps.some((p) => p.status === "processing")) ps = await load(); });
}

function statusEl(p) {
  const label = p.status === "ready" ? "Ready" : p.status === "error" ? "Failed" : `${p.stage || "Processing"}${p.progress ? ` ${Math.round(p.progress * 100)}%` : ""}`;
  return h("span", { class: "status" }, h("span", { class: `dot ${p.status}` }), label);
}

// ------------------------------------------------------------------ project
async function projectView(view, pid) {
  let data = await api(`/api/projects/${pid}`);
  const wrap = h("div");
  view.append(wrap);

  function render() {
    const { project: p, clips } = data;
    crumbs({ text: p.name });
    wrap.innerHTML = "";
    const head = h("div", { class: "phead" },
      h("div", { class: "grow" }, h("h1", {}, p.name),
        h("div", { class: "muted" }, statusEl(p), p.info ? ` · ${fmt(p.info.duration)} · ${p.info.width}×${p.info.height}` : "",
          p.source?.url ? [" · ", h("a", { href: p.source.url, target: "_blank", style: { textDecoration: "underline" } }, "source")] : "")),
      p.status === "ready" ? [
        h("button", { class: "btn ghost", onclick: () => addClipModal(p) }, "＋ Add clip manually"),
        h("button", { class: "btn ghost", onclick: () => refindModal(p) }, "🔁 Find clips again"),
        h("button", { class: "btn ghost", disabled: !clips.length, onclick: () => exportAll(clips) }, "⬇ Export all"),
        h("button", {
          class: "btn", disabled: !clips.length, title: "Render the best clips and queue them for posting, using your Autopilot settings", onclick: async () => {
            if (!(await confirmBox("Render the top clips and queue them for posting (Autopilot settings)?", "🤖 Go"))) return;
            try {
              const r = await api(`/api/projects/${pid}/autopilot`, { method: "POST" });
              toast(r.n ? `${r.n} clips queued — see Publish` : "No clips matched your Autopilot score threshold", !r.n);
              Exports.poke();
              Nav.refresh();
            } catch (e) { toast(e.message, true); }
          },
        }, "🤖 Auto-post best"),
      ] : null);
    wrap.append(head);
    if (p.note) wrap.append(h("div", { class: "note" }, p.note));
    if (p.status === "error") wrap.append(h("div", { class: "error-box" }, h("b", {}, "Processing failed: "), p.error || "unknown error"));
    if (p.status === "processing") {
      wrap.append(h("div", { class: "processing-box" },
        h("div", { class: "row" }, h("b", { class: "grow" }, p.stage || "Queued"), h("span", { class: "muted" }, `${Math.round((p.progress || 0) * 100)}%`)),
        h("div", { class: "bar" }, h("div", { style: { width: `${(p.progress || 0) * 100}%` } })),
        h("div", { class: "hint", style: { marginTop: "10px" } }, "Transcription runs on your CPU — roughly 1–3 min per 10 min of video with the small model. You can leave this page.")));
    }
    if (p.status !== "processing" && !clips.length && p.status !== "error") wrap.append(h("div", { class: "empty" }, "No clips found. Try “Find clips again” with a different length range."));
    const grid = h("div", { class: "clips" });
    clips.forEach((c, i) => grid.append(clipCard(p, c, i)));
    wrap.append(grid);
  }

  function clipCard(p, c) {
    const ed = c.edit;
    const last = (c.exports || []).slice(-1)[0];
    return h("div", { class: "card clip" },
      h("a", { class: "thumb", href: `#/p/${pid}/c/${c.id}`, style: { backgroundImage: `url(/api/projects/${pid}/thumbs/${c.id}.jpg)` } },
        h("span", { class: "score", style: { borderColor: scoreColor(c.score), color: scoreColor(c.score) } }, c.score == null ? "—" : c.score),
        h("span", { class: "dur" }, `${fmt(ed.start)}–${fmt(ed.end)} · ${Math.round(ed.end - ed.start)}s`)),
      h("div", { class: "body" },
        h("div", { class: "title", title: c.title }, c.title),
        c.hook ? h("div", { class: "hookline" }, `🪝 “${c.hook}”`) : null,
        h("div", { class: "chips" }, (c.reasons || []).map((r) => h("span", { class: "chip" }, r))),
        h("div", { class: "actions" },
          h("a", { class: "btn small", href: `#/p/${pid}/c/${c.id}` }, "✏️ Edit"),
          h("button", { class: "btn small ghost", onclick: () => queueExport(pid, c.id) }, "⬇ Export"),
          h("button", { class: "btn small ghost", onclick: () => publishModal(pid, c) }, "🚀 Publish"),
          last ? h("a", { class: "btn small ghost", title: "Download latest export", href: `/api/projects/${pid}/exports/${encodeURIComponent(last.file)}?dl=1` }, "💾") : null,
          h("div", { class: "grow" }),
          h("button", {
            class: "icon", title: "Duplicate", onclick: async () => { await api(`/api/projects/${pid}/clips/${c.id}/duplicate`, { method: "POST" }); refresh(); },
          }, "⧉"),
          h("button", {
            class: "icon", title: "Delete clip", onclick: async () => {
              if (await confirmBox(`Delete clip “${c.title}”?`)) { await api(`/api/projects/${pid}/clips/${c.id}`, { method: "DELETE" }); refresh(); }
            },
          }, "🗑"))));
  }

  async function exportAll(clips) {
    for (const c of clips) await api(`/api/projects/${pid}/clips/${c.id}/export`, { method: "POST" });
    toast(`Queued ${clips.length} exports`);
    Exports.poke(true);
  }

  function refindModal(p) {
    const s = settingsFields(p.settings);
    $$("[name=model],[name=language]", s).forEach((el) => el.parentElement.remove());
    const append = h("input", { type: "checkbox" });
    const close = modal([
      h("h2", {}, "Find clips again"),
      h("div", { class: "hint" }, "Re-runs the clip finder on the existing transcript (no re-transcribing)."), s,
      h("label", { class: "switch", style: { marginTop: "12px" } }, append, "Keep my current clips and add the new ones"),
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn ghost", onclick: () => close() }, "Cancel"),
        h("button", {
          class: "btn", onclick: async () => {
            try {
              await api(`/api/projects/${pid}/refind`, { method: "POST", json: { ...readSettings(s), append: append.checked } });
              close();
              refresh();
            } catch (e) { toast(e.message, true); }
          },
        }, "Find clips")),
    ]);
    $(".modal").style.width = "min(760px, 94vw)";
  }

  function addClipModal(p) {
    const vid = h("video", { src: `/api/projects/${pid}/video`, controls: true, preload: "metadata" });
    const sIn = h("input", { type: "text", value: "0:00" });
    const eIn = h("input", { type: "text", value: "0:30" });
    const tIn = h("input", { type: "text", placeholder: "Custom clip" });
    const close = modal([
      h("h2", {}, "Add a clip manually"), vid,
      h("div", { class: "two", style: { marginTop: "12px" } },
        h("div", {}, h("label", {}, "Start"), h("div", { class: "row" }, sIn, h("button", { class: "btn small ghost", onclick: () => (sIn.value = fmt(vid.currentTime, true)) }, "◷ now"))),
        h("div", {}, h("label", {}, "End"), h("div", { class: "row" }, eIn, h("button", { class: "btn small ghost", onclick: () => (eIn.value = fmt(vid.currentTime, true)) }, "◷ now")))),
      h("div", { style: { marginTop: "10px" } }, h("label", {}, "Title"), tIn),
      h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "16px" } },
        h("button", { class: "btn ghost", onclick: () => close() }, "Cancel"),
        h("button", {
          class: "btn", onclick: async () => {
            try {
              const c = await api(`/api/projects/${pid}/clips`, { method: "POST", json: { start: parseTime(sIn.value), end: parseTime(eIn.value), title: tIn.value } });
              close();
              location.hash = `#/p/${pid}/c/${c.id}`;
            } catch (e) { toast(e.message, true); }
          },
        }, "Add & edit")),
    ]);
    $(".modal").style.width = "min(720px, 94vw)";
  }

  async function refresh() {
    data = await api(`/api/projects/${pid}`);
    render();
  }
  render();
  let lastStatus = data.project.status + data.project.stage + data.project.progress;
  every(1500, async () => {
    if (data.project.status !== "processing") return;
    const d = await api(`/api/projects/${pid}`);
    const st = d.project.status + d.project.stage + d.project.progress;
    if (st !== lastStatus) { lastStatus = st; data = d; render(); }
  });
}

async function queueExport(pid, cid) {
  try {
    await api(`/api/projects/${pid}/clips/${cid}/export`, { method: "POST" });
    toast("Export queued — see Exports (top right)");
    Exports.poke(true);
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------------ exports drawer
const Exports = (() => {
  let list = [], timer = null, known = {};
  const drawer = $("#exportsDrawer");
  $("#exportsBtn").onclick = () => { drawer.hidden = !drawer.hidden; poke(); };
  $("#exportsClose").onclick = () => (drawer.hidden = true);
  function draw() {
    const active = list.filter((j) => j.status === "queued" || j.status === "rendering").length;
    $("#exportsCount").hidden = !active;
    $("#exportsCount").textContent = active;
    const box = $("#exportsList");
    box.innerHTML = "";
    if (!list.length) box.append(h("div", { class: "muted", style: { padding: "12px" } }, "Nothing exported yet."));
    for (const j of list) {
      const url = j.file ? `/api/projects/${j.pid}/exports/${encodeURIComponent(j.file)}` : null;
      box.append(h("div", { class: "exp" },
        h("div", { class: "t", title: j.title }, j.title),
        h("div", { class: "muted", style: { fontSize: "12px" } },
          j.status === "rendering" ? `Rendering ${Math.round(j.progress * 100)}%` : j.status === "queued" ? "Queued" : j.status === "done" ? "Done" : `Failed: ${j.error || ""}`),
        j.status === "rendering" || j.status === "queued" ? h("div", { class: "bar" }, h("div", { style: { width: `${j.progress * 100}%` } })) : null,
        url ? h("div", { class: "row", style: { marginTop: "6px" } },
          h("button", { class: "btn small ghost", onclick: () => playModal(url, j.title) }, "▶ Watch"),
          h("a", { class: "btn small", href: `${url}?dl=1` }, "💾 Download")) : null));
    }
  }
  async function poll() {
    timer = null;
    try { list = await api("/api/exports"); } catch { return; }
    for (const j of list) {
      if (known[j.id] && known[j.id] !== j.status) {
        if (j.status === "done") toast(`✅ Exported “${j.title}”`);
        if (j.status === "error") toast(`Export failed: ${j.error}`, true);
      }
      known[j.id] = j.status;
    }
    draw();
    if (list.some((j) => j.status === "queued" || j.status === "rendering")) timer = setTimeout(poll, 1000);
  }
  function poke(open) {
    if (open) drawer.hidden = false;
    if (!timer) poll();
  }
  poll();
  return { poke, list: () => list };
})();

function playModal(url, title) {
  modal([h("h2", {}, title), h("video", { src: url, controls: true, autoplay: true }),
    h("div", { class: "row", style: { justifyContent: "flex-end", marginTop: "12px" } }, h("a", { class: "btn", href: `${url}?dl=1` }, "💾 Download"))]);
}

// ------------------------------------------------------------------ editor
async function editorView(view, pid, cid) {
  view.className = "full";
  const D = await api(`/api/projects/${pid}/clips/${cid}`);
  const project = D.project;
  const words = D.words; // [{i,w,s,e}] around the clip (source time)
  const wordByI = new Map(words.map((w) => [w.i, w]));
  let clip = D.clip, ed = structuredClone(D.clip.edit), tl = D.timeline, lay = D.layout, tracks = D.tracks;
  const srcDur = project.info.duration;
  const siblings = (await api(`/api/projects/${pid}`)).clips;
  const idx = siblings.findIndex((c) => c.id === cid);
  crumbs({ text: project.name, href: `#/p/${pid}` }, { text: clip.title });
  await Promise.all(Object.values(CFG.fonts).map((f) => document.fonts.load(`40px ${f.css}`).catch(() => null)));

  // ---------- DOM skeleton
  const video = h("video", { src: `/api/projects/${pid}/video`, preload: "auto", playsInline: true, crossOrigin: "anonymous" });
  const canvas = h("canvas", { id: "preview" });
  const ctx = canvas.getContext("2d");
  const overlay = h("div", { class: "pv-overlay" }, "Loading video…");
  const playBtn = h("button", { class: "btn", style: { width: "44px", justifyContent: "center" } }, "▶");
  const timeEl = h("span", { class: "time" });
  const scrubFill = h("div", { class: "fill" }), scrubKnob = h("div", { class: "knob" });
  const scrub = h("div", { class: "scrub" }, h("div", { class: "track" }), scrubFill, scrubKnob);
  const muteBtn = h("button", { class: "icon", title: "Mute" }, "🔊");
  const savedEl = h("span", { class: "saved" }, "All changes saved");
  const titleIn = h("input", { class: "title-in", type: "text", value: clip.title });
  const tlBox = h("div", { class: "tl" });
  const tlCanvas = h("canvas");
  const sel = h("div", { class: "sel" }, h("div", { class: "h l" }), h("div", { class: "h r" }));
  const ph = h("div", { class: "ph" });
  const cutsBox = h("div");
  tlBox.append(tlCanvas, cutsBox, sel, ph);
  const trimLabels = h("div", { class: "labels" });
  const tabsEl = h("div", { class: "tabs" });
  const pane = h("div", { class: "pane" });
  const music = h("audio", { preload: "auto", loop: true });

  view.append(h("div", { class: "editor" },
    h("section", { class: "stage" },
      h("div", { class: "ehead" },
        h("button", { class: "icon", title: "Previous clip", disabled: idx <= 0, onclick: () => (location.hash = `#/p/${pid}/c/${siblings[idx - 1].id}`) }, "◀"),
        h("button", { class: "icon", title: "Next clip", disabled: idx < 0 || idx >= siblings.length - 1, onclick: () => (location.hash = `#/p/${pid}/c/${siblings[idx + 1].id}`) }, "▶"),
        h("span", { class: "score", style: { position: "static", borderColor: scoreColor(clip.score), color: scoreColor(clip.score), fontSize: "13px" } }, clip.score ?? "—"),
        titleIn, savedEl,
        h("button", {
          class: "btn ghost small", title: "Reset all edits to defaults", onclick: async () => {
            if (!(await confirmBox("Reset captions, cuts and layout for this clip?", "Reset"))) return;
            const r = await api(`/api/projects/${pid}/clips/${cid}/reset`, { method: "POST" });
            ed = structuredClone(r.clip.edit); apply(r); renderTab(); drawTimeline(true);
          },
        }, "↺ Reset"),
        h("button", { class: "btn small ghost", onclick: () => publishNow() }, "🚀 Publish"),
        h("button", { class: "btn small", onclick: () => exportNow() }, "⬇ Export")),
      h("div", { class: "canvas-wrap" }, canvas, overlay),
      h("div", { class: "transport" }, playBtn, timeEl, scrub, muteBtn),
      h("div", { class: "trim" }, trimLabels, tlBox,
        h("div", { class: "hint", style: { marginTop: "6px" } }, "Drag the purple handles to trim · ", h("span", { class: "kbd" }, "Space"), " play/pause · ",
          h("span", { class: "kbd" }, "Del"), " cut selected words · ", h("span", { class: "kbd" }, "←/→"), " step"))),
    h("aside", { class: "side" }, tabsEl, pane)), h("div", { hidden: true }, video, music));

  // ---------- server sync
  let seq = 0, pendingFaces = false;
  function apply(r) {
    tl = r.timeline; lay = r.layout;
    if (r.tracks) tracks = r.tracks;
    if (r.clip) clip = r.clip;
    drawTimeline(false);
    if (curTab === "transcript") paintTranscript();
    if (!playing) draw();
  }
  const save = debounce(async () => {
    const my = ++seq, faces = pendingFaces;
    pendingFaces = false;
    savedEl.textContent = "Saving…";
    try {
      const r = await api(`/api/projects/${pid}/clips/${cid}`, { method: "PUT", json: { edit: ed, title: titleIn.value, faces } });
      if (my !== seq) return;
      apply(r);
      savedEl.textContent = "All changes saved";
    } catch (e) {
      savedEl.textContent = "Save failed";
      toast(e.message, true);
    }
  }, 280);
  function change(faces = false) {
    if (faces) pendingFaces = true;
    savedEl.textContent = "Unsaved…";
    save();
    if (!playing) draw();
  }
  titleIn.addEventListener("input", () => change());
  onTeardown(() => save.flush());

  // ---------- time mapping (output <-> source)
  const keep = () => tl.keep;
  function srcToOut(t) {
    let acc = 0;
    for (const [a, b] of keep()) {
      if (t < a) return acc;
      if (t <= b) return acc + t - a;
      acc += b - a;
    }
    return acc;
  }
  function outToSrc(o) {
    let acc = 0;
    for (const [a, b] of keep()) {
      if (o <= acc + (b - a)) return a + (o - acc);
      acc += b - a;
    }
    const k = keep();
    return k[k.length - 1][1];
  }
  function sampleTrack(tr, t, def = 0.5) {
    if (!tr || !tr.length) return def;
    if (t <= tr[0][0]) return tr[0][1];
    for (let i = 0; i < tr.length - 1; i++) {
      const [t0, v0] = tr[i], [t1, v1] = tr[i + 1];
      if (t <= t1) return v0 + (v1 - v0) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1);
    }
    return tr[tr.length - 1][1];
  }

  // ---------- playback
  let playing = false, outT = 0, raf = 0, segIdx = 0, rawSrc = null; // rawSrc: showing an untrimmed source frame while trimming
  function seekOut(o) {
    outT = clamp(o, 0, tl.duration);
    rawSrc = null;
    const s = outToSrc(outT);
    segIdx = Math.max(0, keep().findIndex(([a, b]) => s >= a - 1e-3 && s <= b + 1e-3));
    video.currentTime = s;
    syncMusic();
    draw();
  }
  function play() {
    if (outT >= tl.duration - 0.05) seekOut(0);
    playing = true;
    playBtn.textContent = "❚❚";
    video.play().catch(() => {});
    syncMusic(true);
    loop();
  }
  function pause() {
    playing = false;
    playBtn.textContent = "▶";
    video.pause();
    music.pause();
    cancelAnimationFrame(raf);
    draw();
  }
  function syncMusic(start) {
    const f = ed.music?.file;
    if (!f) { music.pause(); return; }
    const src = `/api/music/${encodeURIComponent(f)}`;
    if (!music.src.endsWith(src)) music.src = src;
    music.volume = clamp(ed.music.volume * 2.2, 0, 1);
    music.muted = video.muted;
    if (music.duration) music.currentTime = outT % music.duration;
    if (start) music.play().catch(() => {});
  }
  function loop() {
    if (!playing) return;
    const k = keep();
    const s = video.currentTime;
    if (segIdx < k.length && s >= k[segIdx][1] - 0.02) {
      segIdx++;
      if (segIdx >= k.length) { outT = tl.duration; pause(); return; }
      video.currentTime = k[segIdx][0];
    }
    if (segIdx < k.length) outT = clamp(srcToOut(Math.max(video.currentTime, k[segIdx][0])), 0, tl.duration);
    draw();
    raf = requestAnimationFrame(loop);
  }
  playBtn.onclick = () => (playing ? pause() : play());
  canvas.onclick = () => (playing ? pause() : play());
  muteBtn.onclick = () => { video.muted = !video.muted; music.muted = video.muted; muteBtn.textContent = video.muted ? "🔇" : "🔊"; };
  video.addEventListener("seeked", () => !playing && draw());
  video.addEventListener("loadeddata", () => { overlay.textContent = ""; seekOut(0); });
  video.addEventListener("error", () => (overlay.textContent = "This video can't be previewed in the browser (export still works)."));
  onTeardown(() => { pause(); video.removeAttribute("src"); video.load(); music.pause(); });

  // scrubber
  function scrubTo(e) {
    const r = scrub.getBoundingClientRect();
    seekOut(((e.clientX - r.left) / r.width) * tl.duration);
  }
  scrub.addEventListener("pointerdown", (e) => {
    if (playing) pause();
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e);
    const mv = (ev) => scrubTo(ev);
    scrub.addEventListener("pointermove", mv);
    scrub.addEventListener("pointerup", () => scrub.removeEventListener("pointermove", mv), { once: true });
  });

  // keyboard
  function onKey(e) {
    if (e.target.matches?.("input, textarea, select")) return;
    if (e.code === "Space") { e.preventDefault(); playing ? pause() : play(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); seekOut(outT - (e.shiftKey ? 5 : 1)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); seekOut(outT + (e.shiftKey ? 5 : 1)); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selWords.size) { e.preventDefault(); cutSelection(true); }
  }
  document.addEventListener("keydown", onKey);
  onTeardown(() => document.removeEventListener("keydown", onKey));

  // ---------- canvas preview (mirrors app/render.py + app/edit.py:to_ass)
  const dims = () => {
    const [W, H] = CFG.aspects[ed.layout.aspect] || [1080, 1920];
    return { W, H };
  };
  function sizeCanvas() {
    const { W, H } = dims();
    const box = canvas.parentElement.getBoundingClientRect();
    const availW = box.width - 28, availH = box.height - 28;
    const sc = Math.min(availW / W, availH / H);
    const cw = Math.max(80, Math.floor(W * sc)), chh = Math.max(80, Math.floor(H * sc));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${chh}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(chh * dpr);
    draw();
  }
  const ro = new ResizeObserver(() => sizeCanvas());
  ro.observe(canvas.parentElement);
  onTeardown(() => ro.disconnect());

  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function hexA(hex, a) {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function textWithStyle(txt, x, y, { fill, stroke, strokeW = 0, shadow = 0, alpha = 1, strokeAlpha }) {
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    if (shadow) {
      ctx.fillStyle = "rgba(0,0,0,0.56)";
      ctx.strokeStyle = "rgba(0,0,0,0.56)";
      if (strokeW) { ctx.lineWidth = strokeW * 2; ctx.strokeText(txt, x + shadow, y + shadow); }
      ctx.fillText(txt, x + shadow, y + shadow);
    }
    if (strokeW && stroke) {
      ctx.strokeStyle = hexA(stroke, strokeAlpha ?? alpha);
      ctx.lineWidth = strokeW * 2;
      ctx.strokeText(txt, x, y);
    }
    ctx.fillStyle = hexA(fill, alpha);
    ctx.fillText(txt, x, y);
  }

  function drawVideo(W, H, srcT) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const L = ed.layout, mode = L.mode || "fill";
    const zoom = Math.max(1, +L.zoom || 1), offset = +L.offset || 0;
    const found = tracks && tracks.found;
    const t = srcT == null ? outT : null; // tracks are on the output timeline
    const crop = (ow, oh, key, ykey, dx, dy) => {
      const ar = ow / oh;
      let ch = vh / zoom, cw = ch * ar;
      if (cw > vw) { cw = vw; ch = cw / ar; }
      let cx = 0.5 + offset * 0.5;
      if (mode !== "center" && found && t != null) cx = sampleTrack(tracks[key], t) + offset * 0.5;
      const x = clamp(cx * vw - cw / 2, 0, vw - cw);
      let y = (vh - ch) / 2;
      if (ykey && zoom > 1 && found && mode !== "center" && t != null) y = clamp(sampleTrack(tracks[ykey], t) * vh - ch * 0.42, 0, vh - ch);
      ctx.drawImage(video, x, y, cw, ch, dx, dy, ow, oh);
    };
    if (mode === "fit") {
      const s = canvas.width / W;
      const cover = Math.max(W / vw, H / vh);
      ctx.save();
      ctx.filter = `blur(${Math.round(36 * s)}px) brightness(0.93) saturate(1.1)`;
      ctx.drawImage(video, (W - vw * cover) / 2 - 20, (H - vh * cover) / 2 - 20, vw * cover + 40, vh * cover + 40);
      ctx.restore();
      const sc = Math.min(W / vw, H / vh);
      const fw = vw * sc, fh = vh * sc;
      ctx.drawImage(video, (W - fw) / 2, (H - fh) * (+L.fitY ?? 0.5), fw, fh);
    } else if (mode === "split" && found) {
      const hh = Math.floor(H / 4) * 2;
      crop(W, hh, tracks.two ? "a" : "main", null, 0, 0);
      crop(W, H - hh, tracks.two ? "b" : "main", null, 0, hh);
    } else {
      crop(W, H, "main", "main_y", 0, 0);
    }
  }

  function drawCaptions(t) {
    const cap = ed.captions;
    if (!lay.phrases || !lay.capFont || !cap.enabled) return;
    const fm = lay.capFont;
    const { W } = dims();
    const bord = ((cap.outlineW || 0) * W) / 1080, shad = ((cap.shadow || 0) * W) / 1080;
    const anim = cap.anim || "pop";
    ctx.font = `${fm.em}px ${fm.css}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const p of lay.phrases) {
      if (t < p.s || t >= p.e) continue;
      if (cap.box) {
        for (const w of p.words) {
          if (t < w.s || t >= w.e) continue;
          const dt = t - w.s;
          const sc = anim === "pop" ? (dt < 0.07 ? 1 + (0.08 * dt) / 0.07 : dt < 0.15 ? 1.08 - (0.04 * (dt - 0.07)) / 0.08 : 1.04) : 1;
          const bw = w.w + fm.em * 0.36, bh = fm.em * 1.12;
          ctx.save();
          ctx.translate(w.x, w.y);
          ctx.scale(sc, sc);
          ctx.fillStyle = cap.box;
          rrect(-bw / 2, -bh / 2, bw, bh, fm.em * 0.22);
          ctx.fill();
          ctx.restore();
        }
      }
      for (const w of p.words) {
        const active = t >= w.s && t < w.e;
        if (anim === "reveal" && t < w.s) continue;
        let sc = 1, dy = 0;
        const dt = t - w.s;
        if (active && anim === "pop") sc = dt < 0.07 ? 1 + (0.16 * dt) / 0.07 : dt < 0.15 ? 1.16 - (0.08 * (dt - 0.07)) / 0.08 : 1.08;
        if (active && anim === "bounce") { sc = 1.1; dy = 14 * (1 - Math.min(1, dt / 0.11)); }
        ctx.save();
        ctx.translate(w.x, w.y + dy);
        ctx.scale(sc, sc);
        textWithStyle(w.t, 0, fm.baseline, { fill: active ? cap.active : cap.color, stroke: cap.outline, strokeW: bord, shadow: shad });
        ctx.restore();
      }
    }
  }

  function drawHook(t) {
    const hk = lay.hook;
    if (!hk || t >= hk.duration) return;
    const fm = hk.font, st = hk.style;
    const { W } = dims();
    const a = Math.min(1, (hk.duration - t) / 0.15); // no fade-in: the first frame is often the thumbnail
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.font = `${fm.em}px ${fm.css}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const r of hk.rows) {
      if (st.box) {
        const bw = r.w + fm.em * 0.7, bh = hk.lineH * 0.98;
        const sh = (6 * W) / 1080;
        ctx.fillStyle = "rgba(0,0,0,0.37)";
        rrect(r.x - bw / 2 + sh, r.y - bh / 2 + sh, bw, bh, fm.em * 0.25);
        ctx.fill();
        ctx.fillStyle = st.box;
        rrect(r.x - bw / 2, r.y - bh / 2, bw, bh, fm.em * 0.25);
        ctx.fill();
      }
    }
    for (const r of hk.rows) {
      textWithStyle(r.text, r.x, r.y + fm.baseline, { fill: st.color, stroke: st.outline || null, strokeW: st.outline ? ((st.outlineW || 0) * W) / 1080 : 0 });
    }
    ctx.restore();
  }

  function drawExtras(t) {
    const { W, H } = dims();
    const wm = lay.watermark;
    if (wm) {
      ctx.font = `${wm.font.em}px ${wm.font.css}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      textWithStyle(wm.text, wm.x, wm.y + wm.font.baseline, { fill: "#FFFFFF", alpha: 0.69, stroke: "#000000", strokeW: 2, strokeAlpha: 0.44 });
    }
    if (ed.progress?.enabled) {
      const bh = Math.max(2, Math.floor((H * 0.008) / 2) * 2);
      ctx.fillStyle = ed.progress.color || "#FFE600";
      ctx.fillRect(0, H - bh, (W * t) / Math.max(0.01, tl.duration), bh);
    }
  }

  function draw() {
    const { W, H } = dims();
    const s = canvas.width / W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (rawSrc != null) {
      drawVideo(W, H, rawSrc);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0009";
      ctx.fillRect(0, 0, canvas.width, 26 * (window.devicePixelRatio || 1));
      ctx.fillStyle = "#fff";
      ctx.font = `${12 * (window.devicePixelRatio || 1)}px system-ui`;
      ctx.textAlign = "left";
      ctx.fillText(`Trimming · ${fmt(rawSrc, true)}`, 8, 17 * (window.devicePixelRatio || 1));
    } else {
      drawVideo(W, H);
      drawCaptions(outT);
      drawHook(outT);
      drawExtras(outT);
    }
    // transport
    const f = tl.duration ? outT / tl.duration : 0;
    scrubFill.style.width = `${f * 100}%`;
    scrubKnob.style.left = `${f * 100}%`;
    timeEl.textContent = `${fmt(outT, true)} / ${fmt(tl.duration, true)}`;
    const srcNow = rawSrc ?? outToSrc(outT);
    ph.style.left = `${((srcNow - win.s) / (win.e - win.s)) * 100}%`;
    if (curTab === "transcript") markNow(srcNow);
  }

  // ---------- trim timeline (source time)
  const win = { s: 0, e: 1 };
  function computeWindow() {
    const d = ed.end - ed.start;
    const pad = Math.max(12, d * 0.6);
    win.s = Math.max(0, ed.start - pad);
    win.e = Math.min(srcDur, ed.end + pad);
  }
  function drawTimeline(recompute) {
    if (recompute) computeWindow();
    const r = tlBox.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    tlCanvas.width = Math.max(1, r.width * dpr);
    tlCanvas.height = Math.max(1, r.height * dpr);
    const c = tlCanvas.getContext("2d");
    const X = (t) => ((t - win.s) / (win.e - win.s)) * tlCanvas.width;
    c.fillStyle = "#15171d";
    c.fillRect(0, 0, tlCanvas.width, tlCanvas.height);
    // seconds grid
    c.fillStyle = "#2a2e39";
    const step = (win.e - win.s) > 120 ? 10 : 5;
    for (let t = Math.ceil(win.s / step) * step; t < win.e; t += step) c.fillRect(X(t), 0, 1, 8 * dpr);
    // words as bars (taller = longer)
    for (const w of words) {
      if (w.e < win.s || w.s > win.e) continue;
      const hgt = clamp((w.e - w.s) * 70, 6, 26) * dpr;
      c.fillStyle = "#4b5165";
      c.fillRect(X(w.s), (tlCanvas.height - hgt) / 2, Math.max(1, X(w.e) - X(w.s) - 1), hgt);
    }
    const L = X(ed.start) / dpr, R = X(ed.end) / dpr;
    sel.style.left = `${L}px`;
    sel.style.width = `${Math.max(4, R - L)}px`;
    trimLabels.innerHTML = "";
    trimLabels.append(h("span", {}, `Clip ${fmt(ed.start, true)} → ${fmt(ed.end, true)} (${(ed.end - ed.start).toFixed(1)}s source`,
      tl.duration < ed.end - ed.start - 0.05 ? `, ${tl.duration.toFixed(1)}s after cuts)` : ")"),
      h("span", {}, `${fmt(win.s)} – ${fmt(win.e)}`));
    drawCuts();
  }
  function drawCuts() {
    cutsBox.innerHTML = "";
    const k = tl.keep;
    const X = (t) => ((t - win.s) / (win.e - win.s)) * 100;
    for (let i = 0; i < k.length - 1; i++) {
      cutsBox.append(h("div", { class: "cut", style: { left: `${X(k[i][1])}%`, width: `${X(k[i + 1][0]) - X(k[i][1])}%` } }));
    }
    if (k[0][0] > ed.start + 0.05) cutsBox.append(h("div", { class: "cut", style: { left: `${X(ed.start)}%`, width: `${X(k[0][0]) - X(ed.start)}%` } }));
    const last = k[k.length - 1][1];
    if (last < ed.end - 0.05) cutsBox.append(h("div", { class: "cut", style: { left: `${X(last)}%`, width: `${X(ed.end) - X(last)}%` } }));
  }
  function snap(t) {
    let best = t, bd = 0.18;
    for (const w of words) {
      for (const b of [w.s - 0.05, w.e + 0.08]) {
        const d = Math.abs(b - t);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return clamp(best, 0, srcDur);
  }
  tlBox.addEventListener("pointerdown", (e) => {
    const r = tlBox.getBoundingClientRect();
    const T = (x) => win.s + ((x - r.left) / r.width) * (win.e - win.s);
    const target = e.target.classList.contains("l") ? "l" : e.target.classList.contains("r") ? "r" : e.target === sel ? "move" : "seek";
    if (target === "seek") {
      const t = T(e.clientX);
      if (t >= ed.start && t <= ed.end) seekOut(srcToOut(t));
      return;
    }
    if (playing) pause();
    tlBox.setPointerCapture(e.pointerId);
    const t0 = T(e.clientX), s0 = ed.start, e0 = ed.end;
    const mv = (ev) => {
      const t = T(ev.clientX);
      if (target === "l") { ed.start = clamp(snap(t), 0, ed.end - 1); rawSrc = ed.start; }
      else if (target === "r") { ed.end = clamp(snap(t), ed.start + 1, srcDur); rawSrc = ed.end; }
      else {
        const d = clamp(t - t0, -s0, srcDur - e0);
        ed.start = s0 + d; ed.end = e0 + d; rawSrc = ed.start;
      }
      // local approximation of the timeline until the server answers
      tl = { ...tl, keep: [[ed.start, ed.end]], duration: ed.end - ed.start };
      video.currentTime = rawSrc;
      drawTimeline(false);
    };
    const up = () => {
      tlBox.removeEventListener("pointermove", mv);
      rawSrc = null;
      drawTimeline(true);
      change(true);
      seekOut(0);
    };
    tlBox.addEventListener("pointermove", mv);
    tlBox.addEventListener("pointerup", up, { once: true });
  });
  const tro = new ResizeObserver(() => drawTimeline(false));
  tro.observe(tlBox);
  onTeardown(() => tro.disconnect());

  // ---------- side panel
  const TABS = [["captions", "Captions"], ["transcript", "Transcript"], ["layout", "Layout"], ["hook", "Hook"], ["extras", "Extras"], ["export", "Export"]];
  let curTab = "captions";
  for (const [k, label] of TABS) {
    tabsEl.append(h("button", { class: k === curTab ? "on" : "", onclick: (e) => { curTab = k; $$("button", tabsEl).forEach((b) => b.classList.remove("on")); e.target.classList.add("on"); renderTab(); } }, label));
  }

  // control builders
  const ctl = (label, input) => h("div", { class: "ctl" }, h("label", {}, label), input);
  function slider(obj, key, min, max, step, label, fmtv = (v) => v, opts = {}) {
    const val = h("span", { class: "muted" }, fmtv(obj[key]));
    const inp = h("input", {
      type: "range", min, max, step, value: obj[key],
      oninput: () => { obj[key] = +inp.value; val.textContent = fmtv(obj[key]); change(opts.faces); },
    });
    return h("div", { class: "ctl" }, h("div", { class: "row" }, h("label", { class: "grow" }, label), val), inp);
  }
  function toggle(obj, key, label, after) {
    const cb = h("input", { type: "checkbox", checked: !!obj[key], onchange: () => { obj[key] = cb.checked; change(); after && after(); } });
    return h("label", { class: "switch" }, cb, label);
  }
  function color(obj, key, label) {
    const inp = h("input", { type: "color", value: obj[key] || "#ffffff", oninput: () => { obj[key] = inp.value.toUpperCase(); change(); } });
    return h("div", { class: "ctl" }, h("label", {}, label), inp);
  }
  function seg(obj, key, options, after) {
    const box = h("div", { class: "seg" });
    for (const [v, label] of options) {
      box.append(h("button", {
        class: obj[key] === v ? "on" : "", onclick: () => {
          obj[key] = v;
          $$("button", box).forEach((b) => b.classList.remove("on"));
          box.children[options.findIndex((o) => o[0] === v)].classList.add("on");
          change(); after && after();
        },
      }, label));
    }
    return box;
  }
  function textIn(obj, key, placeholder) {
    const i = h("input", { type: "text", value: obj[key] || "", placeholder, oninput: () => { obj[key] = i.value; change(); } });
    return i;
  }
  const fontName = (f) => f.replace(".ttf", "").replace("-Regular", "").replace("-", " ");

  function renderTab() {
    pane.innerHTML = "";
    ({ captions: tabCaptions, transcript: tabTranscript, layout: tabLayout, hook: tabHook, extras: tabExtras, export: tabExport })[curTab]();
  }

  function tabCaptions() {
    const cap = ed.captions;
    const presets = h("div", { class: "presets" });
    for (const [k, p] of Object.entries(CFG.presets)) {
      const css = CFG.fonts[p.font].css;
      const t1 = p.upper ? "THE" : "The", t2 = p.upper ? "BEST" : "best";
      const st = (active) => ({
        fontFamily: css, color: active ? p.active : p.color, padding: "0 4px", borderRadius: "5px",
        background: active && p.box ? p.box : "transparent",
        webkitTextStroke: p.outlineW ? `${Math.min(3, p.outlineW / 3)}px ${p.outline}` : "", paintOrder: "stroke fill",
        textShadow: p.shadow ? "2px 2px 0 #0008" : "",
      });
      presets.append(h("div", {
        class: `preset ${cap.preset === k ? "on" : ""}`, onclick: () => {
          const { name, ...rest } = p;
          Object.assign(cap, rest, { preset: k, enabled: true });
          change(); renderTab();
        },
      }, h("div", { class: "sample" }, h("span", { style: st(false) }, t1), h("span", { style: st(true) }, t2)), h("div", { class: "pname" }, p.name)));
    }
    const boxOn = h("input", { type: "checkbox", checked: !!cap.box, onchange: () => { cap.box = boxOn.checked ? "#7C3AED" : ""; change(); renderTab(); } });
    put(pane, 
      h("div", { class: "sec" }, toggle(cap, "enabled", "Show captions", renderTab)),
      cap.enabled ? [
        h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Style presets"), presets),
        h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Customize"),
          ctl("Font", h("select", { onchange: (e) => { cap.font = e.target.value; change(); } },
            Object.keys(CFG.fonts).map((f) => h("option", { value: f, selected: f === cap.font }, fontName(f))))),
          slider(cap, "size", 30, 180, 1, "Size"),
          h("div", { class: "two" }, slider(cap, "words", 1, 8, 1, "Words per caption"), slider(cap, "lines", 1, 3, 1, "Max lines")),
          slider(cap, "y", 0.1, 0.92, 0.01, "Vertical position", (v) => `${Math.round(v * 100)}%`),
          ctl("Animation", seg(cap, "anim", [["pop", "Pop"], ["bounce", "Bounce"], ["reveal", "Reveal"], ["none", "None"]])),
          h("div", { class: "ctl" }, toggle(cap, "upper", "UPPERCASE")),
          h("div", { class: "three" }, color(cap, "color", "Text"), color(cap, "active", "Highlight"), color(cap, "outline", "Outline")),
          h("div", { class: "two" }, slider(cap, "outlineW", 0, 16, 1, "Outline"), slider(cap, "shadow", 0, 12, 1, "Shadow")),
          h("div", { class: "ctl row" }, h("label", { class: "switch grow" }, boxOn, "Highlight box behind active word"),
            cap.box ? h("input", { type: "color", value: cap.box, oninput: (e) => { cap.box = e.target.value.toUpperCase(); change(); } }) : null)),
      ] : null);
  }

  // transcript
  const selWords = new Set();
  let lastClicked = null;
  function tabTranscript() {
    const tools = h("div", { class: "ttools" },
      h("button", { class: "btn small ghost", onclick: () => cutSelection(true) }, "✂ Cut selected"),
      h("button", { class: "btn small ghost", onclick: () => cutSelection(false) }, "↩ Restore"),
      h("button", { class: "btn small ghost", title: "Start the clip at the first selected word", onclick: () => setBound("start") }, "⇤ Start here"),
      h("button", { class: "btn small ghost", title: "End the clip after the last selected word", onclick: () => setBound("end") }, "End here ⇥"));
    const box = h("div", { class: "transcript", id: "tx" });
    put(pane, 
      h("div", { class: "sec" },
        h("div", { class: "ctl" }, toggle(ed, "removeFillers", "Remove filler words (um, uh, like…)")),
        h("div", { class: "ctl" }, toggle(ed, "removeSilences", "Remove silences / dead air", renderTab)),
        ed.removeSilences ? slider(ed, "silenceGap", 0.2, 2, 0.05, "Cut pauses longer than", (v) => `${(+v).toFixed(2)}s`) : null,
        h("div", { class: "hint" }, "Click a word to jump there · Shift-click to select a range · Double-click to fix a word · ", h("span", { class: "kbd" }, "Del"), " cuts it from the clip.")),
      tools, box);
    paintTranscript();
  }
  function paintTranscript() {
    const box = $("#tx");
    if (!box) return;
    box.innerHTML = "";
    const removed = new Set(tl.removed);
    const deleted = new Set(ed.deleted);
    let prev = null;
    for (const w of words) {
      if (w.e < ed.start - 6 || w.s > ed.end + 6) continue;
      if (prev && w.s - prev.e > 0.7) box.append(h("span", { class: "gap" }, ` ⏸${(w.s - prev.e).toFixed(1)}s `));
      prev = w;
      const mid = (w.s + w.e) / 2;
      const inClip = mid >= ed.start && mid <= ed.end;
      const edited = ed.wordEdits[w.i] != null;
      const cls = ["w", !inClip && "out", deleted.has(w.i) && "del", !deleted.has(w.i) && removed.has(w.i) && "auto", selWords.has(w.i) && "sel", edited && "edited"].filter(Boolean).join(" ");
      const span = h("span", { class: cls, "data-i": w.i, title: `${fmt(w.s, true)}` }, edited ? ed.wordEdits[w.i] : w.w);
      span.addEventListener("click", (e) => clickWord(e, w));
      span.addEventListener("dblclick", () => editWord(span, w));
      box.append(span, " ");
    }
  }
  function clickWord(e, w) {
    if (e.shiftKey && lastClicked != null) {
      const ids = words.map((x) => x.i);
      const [a, b] = [ids.indexOf(lastClicked), ids.indexOf(w.i)].sort((x, y) => x - y);
      selWords.clear();
      ids.slice(a, b + 1).forEach((i) => selWords.add(i));
    } else {
      selWords.clear();
      selWords.add(w.i);
      lastClicked = w.i;
      if (w.s >= ed.start && w.s <= ed.end) seekOut(srcToOut(w.s));
    }
    $$("#tx .w").forEach((s) => s.classList.toggle("sel", selWords.has(+s.dataset.i)));
  }
  function cutSelection(cut) {
    const d = new Set(ed.deleted);
    selWords.forEach((i) => (cut ? d.add(i) : d.delete(i)));
    ed.deleted = [...d].sort((a, b) => a - b);
    change();
    paintTranscript();
  }
  function setBound(which) {
    if (!selWords.size) return toast("Select a word first", true);
    const ws = [...selWords].map((i) => wordByI.get(i)).sort((a, b) => a.s - b.s);
    if (which === "start") ed.start = Math.max(0, ws[0].s - 0.05);
    else ed.end = Math.min(srcDur, ws[ws.length - 1].e + 0.08);
    if (ed.end - ed.start < 1) return toast("Clip would be too short", true);
    change(true);
    drawTimeline(true);
    paintTranscript();
  }
  function editWord(span, w) {
    const inp = h("input", { type: "text", value: ed.wordEdits[w.i] ?? w.w, style: { width: `${Math.max(60, span.offsetWidth + 30)}px`, padding: "2px 6px", display: "inline-block" } });
    span.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const v = inp.value.trim();
        if (v === w.w || v === "") delete ed.wordEdits[w.i];
        else ed.wordEdits[w.i] = v;
        change();
      }
      paintTranscript();
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(true); if (e.key === "Escape") commit(false); });
    inp.addEventListener("blur", () => commit(true));
  }
  let nowI = null, nowCheck = 0;
  function markNow(srcT) {
    const n = performance.now();
    if (n - nowCheck < 120) return;
    nowCheck = n;
    const w = words.find((x) => srcT >= x.s && srcT < x.e + 0.05);
    const i = w ? w.i : null;
    if (i === nowI) return;
    $$("#tx .w.now").forEach((s) => s.classList.remove("now"));
    nowI = i;
    if (i != null) {
      const el = $(`#tx .w[data-i="${i}"]`);
      if (el) {
        el.classList.add("now");
        if (playing) el.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function tabLayout() {
    const L = ed.layout;
    const info = tracks?.found ? (tracks.two ? "Two speakers detected — Split works well." : "Face tracking active — the crop follows the speaker.") : "No faces detected — Fit (blurred background) usually looks best.";
    put(pane, 
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Reframe"),
        ctl("Mode", seg(L, "mode", [["fill", "Auto-reframe"], ["fit", "Fit + blur"], ["split", "Split"], ["center", "Center"]], renderTab)),
        h("div", { class: "hint", style: { marginBottom: "12px" } }, "🎯 ", info)),
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Aspect ratio"),
        ctl("", seg(L, "aspect", [["9:16", "9:16 Shorts"], ["1:1", "1:1"], ["4:5", "4:5"], ["16:9", "16:9"]], () => { sizeCanvas(); }))),
      L.mode === "fit"
        ? h("div", { class: "sec" }, slider(L, "fitY", 0, 1, 0.01, "Video position", (v) => `${Math.round(v * 100)}%`))
        : h("div", { class: "sec" },
          slider(L, "zoom", 1, 2.5, 0.05, "Zoom", (v) => `${(+v).toFixed(2)}×`),
          slider(L, "offset", -1, 1, 0.01, L.mode === "center" ? "Horizontal position" : "Horizontal nudge", (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`)));
  }

  function tabHook() {
    const hk = ed.hook;
    const styles = h("div", { class: "hookstyles" });
    for (const [k, st] of Object.entries(CFG.hookStyles)) {
      styles.append(h("div", { class: `hookstyle ${hk.style === k ? "on" : ""}`, onclick: () => { hk.style = k; change(); renderTab(); } },
        h("span", { style: { background: st.box || "transparent", color: st.color, fontFamily: CFG.fonts[st.font].css, webkitTextStroke: st.outline ? `1px ${st.outline}` : "" } }, "Wait for it…")));
    }
    const ta = h("textarea", { rows: 2, oninput: () => { hk.text = ta.value; change(); } });
    ta.value = hk.text || "";
    put(pane, 
      h("div", { class: "sec" }, toggle(hk, "enabled", "Show hook title at the start", renderTab),
        h("div", { class: "hint", style: { marginTop: "6px" } }, "A bold one-liner over the first seconds stops the scroll. AI suggestion: ", h("i", {}, `“${clip.hook || "—"}”`))),
      hk.enabled ? [
        h("div", { class: "sec" }, ctl("Text", ta)),
        h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Style"), styles),
        h("div", { class: "sec" },
          slider(hk, "size", 30, 110, 1, "Size"),
          slider(hk, "y", 0.05, 0.9, 0.01, "Vertical position", (v) => `${Math.round(v * 100)}%`),
          slider(hk, "duration", 1, 15, 0.5, "Show for", (v) => `${v}s`)),
      ] : null);
  }

  function tabExtras() {
    const pr = ed.progress, wm = ed.watermark, mu = ed.music;
    const musicSel = h("select", {
      onchange: () => { mu.file = musicSel.value; change(); syncMusic(playing); renderTab(); },
    }, h("option", { value: "" }, "No music"), CFG.music.map((m) => h("option", { value: m, selected: m === mu.file }, m)));
    const up = h("input", {
      type: "file", accept: "audio/*", hidden: true, onchange: async () => {
        const fd = new FormData();
        fd.append("file", up.files[0]);
        try {
          const r = await (await fetch("/api/music", { method: "POST", body: fd })).json();
          if (r.error) throw new Error(r.error);
          CFG.music = [...new Set([...CFG.music, r.file])].sort();
          mu.file = r.file;
          change(); syncMusic(playing); renderTab();
        } catch (e) { toast(e.message, true); }
      },
    });
    put(pane, 
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Progress bar"),
        h("div", { class: "row" }, h("div", { class: "grow" }, toggle(pr, "enabled", "Show progress bar")), pr.enabled ? h("input", { type: "color", value: pr.color, oninput: (e) => { pr.color = e.target.value.toUpperCase(); change(); } }) : null)),
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Watermark"), textIn(wm, "text", "@yourhandle")),
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Background music"),
        h("div", { class: "row" }, musicSel, h("button", { class: "btn small ghost", onclick: () => up.click() }, "Upload")), up,
        mu.file ? slider(mu, "volume", 0, 0.6, 0.01, "Music volume", (v) => `${Math.round(v * 100)}%`) : null,
        h("div", { class: "hint", style: { marginTop: "6px" } }, "Music loops under the clip and fades out at the end. Use royalty-free tracks.")));
    if (mu.file) {
      const v = pane.querySelector("input[type=range]");
      v && v.addEventListener("input", () => syncMusic(false));
    }
  }

  function tabExport() {
    const list = h("div");
    const exps = (clip.exports || []).slice().reverse();
    if (!exps.length) list.append(h("div", { class: "muted" }, "No exports yet."));
    for (const x of exps) {
      const url = `/api/projects/${pid}/exports/${encodeURIComponent(x.file)}`;
      list.append(h("div", { class: "exp-list-item" },
        h("video", { src: url, preload: "metadata", muted: true }),
        h("div", { class: "grow" }, h("div", { style: { fontSize: "13px", wordBreak: "break-all" } }, x.file), h("div", { class: "muted", style: { fontSize: "12px" } }, ago(x.at))),
        h("button", { class: "icon", title: "Watch", onclick: () => playModal(url, clip.title) }, "▶"),
        h("a", { class: "icon", title: "Download", href: `${url}?dl=1` }, "💾")));
    }
    const { W, H } = dims();
    put(pane, 
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Export"),
        h("div", { class: "hint", style: { marginBottom: "10px" } }, `${W}×${H} · 30 fps · H.264 + AAC · ${tl.duration.toFixed(1)}s`),
        h("button", { class: "btn", style: { width: "100%", justifyContent: "center", padding: "12px" }, onclick: () => exportNow() }, "⬇ Export MP4"),
        h("button", { class: "btn ghost", style: { width: "100%", justifyContent: "center", padding: "12px", marginTop: "8px" }, onclick: () => publishNow() }, "🚀 Publish to socials…")),
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Previous exports"), list),
      h("div", { class: "sec" }, h("div", { class: "sec-title" }, "Posting tips"),
        h("div", { class: "hint", html: "Title idea: <b></b><br>Post 1–3 clips a day per account. Keep the first 2 seconds strong — the hook title + a mid-sentence start help. Credit the original creator and follow their clipping rules if it isn't your content." })));
    $("b", pane).textContent = clip.title;
  }

  async function publishNow() {
    save.flush();
    await new Promise((r) => setTimeout(r, 350));
    publishModal(pid, clip, { fresh: true });
  }

  async function exportNow() {
    save.flush();
    await new Promise((r) => setTimeout(r, 350));
    await queueExport(pid, cid);
    // refresh export list for this clip when done
    const poll = every(1500, async () => {
      const j = Exports.list().find((x) => x.cid === cid && (x.status === "queued" || x.status === "rendering"));
      if (!j) {
        poll();
        const r = await api(`/api/projects/${pid}/clips/${cid}`);
        clip = r.clip;
        if (curTab === "export") renderTab();
      }
    });
  }

  // ---------- go
  computeWindow();
  renderTab();
  sizeCanvas();
  drawTimeline(true);
  if (!tracks?.found && ed.layout.mode === "fill") toast("No face found in this clip — try Layout → Fit + blur");
}

window.addEventListener("DOMContentLoaded", route);  // after social.js has loaded
