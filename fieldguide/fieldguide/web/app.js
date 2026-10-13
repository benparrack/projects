import { md, esc, inline, highlightLines, setLinker } from './md.js';
// titles may carry `code`; render it but never link it (titles sit inside links already)
const ti = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
import { diagram, architecture, forceGraph, treemap } from './diagrams.js';

const app = document.getElementById('app');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const pad2 = n => String(n).padStart(2, '0');
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

let G, slug, P, lineCache = new Map(), ctx = {};

// ---------- progress (per viewer, per guide) ----------
function loadProgress() {
  try { return JSON.parse(localStorage.getItem('fg:' + slug)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem('fg:' + slug, JSON.stringify(P)); } catch {}
}

// ---------- boot ----------
const m = location.pathname.match(/^\/g\/([a-z0-9-]+)/);
if (m) openGuide(m[1]); else shelf();

async function shelf() {
  document.title = 'Field Guide';
  let list = [];
  try { list = await (await fetch('/api/guides')).json(); } catch {}
  const progress = s => { try { return JSON.parse(localStorage.getItem('fg:' + s.slug)) || {}; } catch { return {}; } };
  app.innerHTML = `<div class="shelf">
    <div class="mast"><div><div class="label">Codebase study guides</div><h1>Field Guide</h1>
      <p>Every project you've built, explained back to you.</p></div>
      <div class="label">${plural(list.length, 'guide')}</div></div>
    ${list.length ? `<div class="books">${list.map(g => {
      const p = progress(g), done = Object.keys(p.read || {}).length;
      return `<a href="/g/${g.slug}/${p.last && p.last !== '#/' ? p.last : ''}"><div class="label">${esc(g.stats.languages.slice(0, 2).map(l => l[0]).join(' · '))}</div>
        <h2>${esc(g.title)}</h2><p>${esc(g.tagline)}</p>
        <div class="stats"><span>${g.stats.loc.toLocaleString()} lines</span><span>${g.chapters} chapters</span><span>${done ? `${done} read` : 'unread'}</span><span>built ${esc(g.built.slice(0, 10))}</span>${g.stale ? `<span class="stale" title="${plural(g.stale, 'file')} changed since the build">needs a rebuild</span>` : ''}</div>
        <div class="prog"><i style="width:${Math.round((done / g.chapters) * 100)}%"></i></div></a>`;
    }).join('')}</div>` : `<p class="empty-state">No guides yet. Build your first one below.</p>`}
    <div class="howto"><div class="label">Add a project</div>
      <pre>python3 -m fieldguide build ~/projects/some-project</pre>
      <p>It reads every file, plans a course, and writes each chapter with Claude through your Claude Code login. Rebuilding after changes only redoes what changed.</p></div>
  </div>`;
}

async function openGuide(s) {
  slug = s;
  try {
    const r = await fetch('/api/guide/' + s);
    if (!r.ok) throw new Error();
    G = await r.json();
  } catch {
    app.innerHTML = `<div class="shelf"><h1 class="title">Not found</h1><p>No guide called <code>${esc(s)}</code>. <a href="/">Back to the shelf</a>.</p></div>`;
    return;
  }
  P = loadProgress();
  P.read ||= {}; P.quiz ||= {};
  prepare();
  frame();
  window.addEventListener('hashchange', route);
  route();
}

// ---------- indexes ----------
function prepare() {
  const C = G.course;
  ctx.byPath = Object.fromEntries(G.project.files.map(f => [f.path, f]));
  ctx.comp = {};
  C.components.forEach((c, i) => c.files.forEach(p => (ctx.comp[p] ??= i)));
  ctx.chFor = {};
  C.chapters.forEach((c, i) => c.files.forEach(p => (ctx.chFor[p] ||= []).push(i)));
  ctx.syms = {};
  for (const f of G.project.files) for (const s of f.symbols) {
    if (s.kind === 'heading' || s.kind === 'selector') continue;
    const keys = [s.name, s.parent ? `${s.parent}.${s.name}` : null].filter(Boolean);
    for (const k of keys) (ctx.syms[k] ||= []).push({ file: f.path, line: s.line, end: s.end });
  }
  ctx.base = {};
  for (const p of Object.keys(ctx.byPath)) (ctx.base[p.split('/').pop()] ||= []).push(p);
  setLinker(code => {
    let c = code.trim().replace(/\(\)$/, '').replace(/\(.*\)$/, '');
    const lm = c.match(/^(.+?):(\d+)(?:[-–](\d+))?$/);
    let lines = '';
    if (lm) { c = lm[1]; lines = `:L${lm[2]}${lm[3] ? '-' + lm[3] : ''}`; }
    const file = ctx.byPath[c] ? c : ctx.byPath[c.replace(/^\.\//, '')] ? c.replace(/^\.\//, '') :
      (ctx.base[c]?.length === 1 ? ctx.base[c][0] : Object.keys(ctx.byPath).find(p => p.endsWith('/' + c)));
    if (file) return fileHref(file) + lines;
    const sym = ctx.syms[c] || ctx.syms[c.split('.').pop()];
    if (sym && /^[\w$.]+$/.test(c) && c.length > 2) return fileHref(sym[0].file) + `:L${sym[0].line}-${sym[0].end || sym[0].line}`;
    return null;
  });
  ctx.words = G.chapters.reduce((a, ch) => a + (ch ? ch.sections.reduce((b, s) => b + s.body.split(/\s+/).length, 0) : 0), 0);
  ctx.langColor = Object.fromEntries(G.project.stats.languages.map(([l], i) => [l, `var(--c${i % 8})`]));
}
const fileHref = p => '#/files/' + encodeURI(p);
const compColor = p => (ctx.comp[p] != null ? `var(--c${ctx.comp[p] % 8})` : 'var(--muted)');

// ---------- frame ----------
function frame() {
  document.title = `${G.course.title} · Field Guide`;
  app.innerHTML = `
  <div class="topbar"><button id="menu" aria-label="Contents">Contents</button><span>${esc(G.course.title)}</span></div>
  <div class="frame">
    <aside class="side" id="side"></aside>
    <main id="main"></main>
  </div>
  <button class="fab" id="fab" hidden><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 3.5h11v7h-6l-3 3v-3h-2z"/></svg>Ask about this</button>
  <div class="drawer" id="drawer" aria-hidden="true"><header><div><div class="label">Ask</div><div id="dr-where" style="font:13px var(--sans);color:var(--muted)"></div></div><button id="dr-close" aria-label="Close">×</button></header><div class="body" id="dr-body"></div></div>
  <div class="palette-bg" id="pal"><div class="palette" role="dialog" aria-label="Search"><input id="pal-in" placeholder="Jump to a chapter, file, function or term" autocomplete="off"><ul id="pal-list"></ul></div></div>
  <div class="palette-bg" id="keys"><div class="palette keys" role="dialog" aria-label="Keyboard shortcuts"><div class="label">Keyboard</div><dl>
    <dt><kbd>/</kbd></dt><dd>Search chapters, files, functions and terms</dd>
    <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous and next chapter</dd>
    <dt><kbd>m</kbd></dt><dd>Mark the chapter as understood</dd>
    <dt><kbd>a</kbd></dt><dd>Ask a question about this page</dd>
    <dt><kbd>Space</kbd></dt><dd>Flashcards: show the answer</dd>
    <dt><kbd>1</kbd> <kbd>2</kbd></dt><dd>Flashcards: again, or knew it</dd>
    <dt><kbd>Esc</kbd></dt><dd>Close whatever is open</dd>
    <dt><kbd>?</kbd></dt><dd>This list</dd></dl></div></div>
  <div class="readbar" id="readbar"><i></i></div>`;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#fab').onclick = openDrawer;
  $('#dr-close').onclick = closeDrawer;
  setupPalette();
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    $('#readbar i').style.width = (h > 0 ? Math.min(1, scrollY / h) * 100 : 0) + '%';
    ctx.onScroll?.();
  }, { passive: true });
  $('#keys').onclick = () => $('#keys').classList.remove('open');
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); openPalette(); }
    if (e.key === 'Escape') { closePalette(); closeDrawer(); $('#keys').classList.remove('open'); }
    if (/INPUT|TEXTAREA/.test(document.activeElement.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('#pal').classList.contains('open')) return;
    if (e.key === '?') $('#keys').classList.toggle('open');
    if (e.key === 'm') $('[data-read]')?.click();
    if (e.key === 'a' && ctx.focus) { e.preventDefault(); openDrawer(); }
    if (ctx.cardKey?.(e)) return;
    const r = location.hash.match(/^#\/ch\/(\d+)/);
    if (r && e.key === 'ArrowRight') { const n = +r[1]; location.hash = n < G.course.chapters.length ? `#/ch/${n + 1}` : '#/review'; }
    if (r && e.key === 'ArrowLeft') { const n = +r[1]; location.hash = n > 1 ? `#/ch/${n - 1}` : '#/'; }
  });
}

function side(active) {
  const C = G.course, read = Object.keys(P.read).length, total = C.chapters.length;
  const link = (href, n, t, on, tick) => `<a href="${href}" class="${on ? 'on' : ''}"><span class="n">${n}</span><span>${ti(t)}</span>${tick ? '<span class="tick" title="Read">✓</span>' : '<span></span>'}</a>`;
  $('#side').innerHTML = `
    <div class="book"><a class="home" href="/">← All guides</a>
      <h1><a href="#/">${esc(C.title)}</a></h1>
      <div class="progress"><div class="label">${read} of ${total} chapters read</div><div class="bar"><i style="width:${(read / total) * 100}%"></i></div></div></div>
    <nav>
      ${link('#/', '§', 'Overview', active === 'cover')}
      <div class="group label">Chapters</div>
      ${C.chapters.map((c, i) => link(`#/ch/${i + 1}`, pad2(i + 1), c.title, active === 'ch' + (i + 1), P.read[i])).join('')}
      ${link('#/review', '∎', 'Putting it together', active === 'review', P.read.review)}
      <div class="group label">Reference</div>
      ${link('#/map', '', 'Map of the code', active === 'map')}
      ${link('#/files', '', 'Files', active === 'files')}
      ${link('#/glossary', '', 'Glossary', active === 'glossary')}
      ${link('#/cards', '', 'Flashcards', active === 'cards')}
      ${link('#/improve', '', 'Improvements', active === 'improve')}
      ${link('#/ask', '', 'Your questions', active === 'ask')}
    </nav>
    <div class="tools"><button id="srch">Search <kbd>/</kbd></button><button id="help" aria-label="Keyboard shortcuts">?</button><button id="theme">${document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'Light' : 'Dark'}</button></div>`;
  $('#srch').onclick = openPalette;
  $('#help').onclick = () => $('#keys').classList.add('open');
  $('#theme').onclick = () => {
    const dark = $('#theme').textContent === 'Dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('fg:theme', dark ? 'dark' : 'light'); } catch {}
    side(active);
  };
  $('#side').classList.remove('open');
}

function route() {
  const h = decodeURI(location.hash.slice(1) || '/');
  const main = $('#main');
  let r, active = '';
  ctx.focus = null; ctx.cardKey = null;
  if ((r = h.match(/^\/ch\/(\d+)/))) { active = 'ch' + r[1]; main.innerHTML = chapterView(+r[1] - 1); }
  else if (h === '/review') { active = 'review'; main.innerHTML = reviewView(); }
  else if (h.startsWith('/map')) { active = 'map'; main.innerHTML = mapView(); }
  else if ((r = h.match(/^\/files\/?(.*)$/))) { active = 'files'; main.innerHTML = filesView(r[1]); }
  else if (h === '/glossary') { active = 'glossary'; main.innerHTML = glossaryView(); }
  else if (h === '/improve') { active = 'improve'; main.innerHTML = improveView(); }
  else if (h === '/cards') { active = 'cards'; main.innerHTML = cardsView(); }
  else if (h === '/ask') { active = 'ask'; main.innerHTML = askView(); }
  else { active = 'cover'; main.innerHTML = coverView(); }
  side(active);
  wire(active);
  document.body.classList.toggle('reading', /^ch|^review$/.test(active));
  $('#fab').hidden = !ctx.focus;
  if (!ctx.keepScroll) window.scrollTo(0, 0);
  ctx.keepScroll = false;
  P.last = location.hash; save();
}

// ---------- shared bits ----------
function srcLines(path) {
  if (!lineCache.has(path)) lineCache.set(path, highlightLines(G.sources[path] ?? '', ctx.byPath[path]?.lang));
  return lineCache.get(path);
}
// --i is the line's own indent, so a wrapped line continues two columns in from where its code starts
const lnHTML = (l, n, cls = '', attr = '') =>
  `<div class="ln${cls}" data-n="${n}"${attr}><span style="--i:${l.match(/^ */)[0].length}ch">${l || ' '}</span></div>`;
function codeFigure(c, label) {
  // excerpts drop their shared indent; lines continuing a multi-line string start with <span and are left alone
  const raw = (G.sources[c.file] ?? '').split('\n').slice(c.start - 1, c.end).filter(l => l.trim());
  const cut = Math.min(...raw.map(l => l.match(/^ */)[0].length), 99);
  const lines = srcLines(c.file).slice(c.start - 1, c.end).map(l => l.replace(new RegExp(`^ {0,${cut}}`), ''));
  return `<figure class="code bleed"><div class="head"><a href="${fileHref(c.file)}:L${c.start}-${c.end}">${esc(c.file)}</a><span>lines ${c.start}–${c.end}</span></div>
    <div class="src">${lines.map((l, i) => lnHTML(l, c.start + i)).join('')}</div>
    ${c.caption ? `<figcaption><b>${label}</b>${inline(c.caption)}</figcaption>` : ''}</figure>`;
}
function diagramFigure(d, label) {
  try {
    return `<figure class="diagram bleed"><div class="canvas">${diagram(d)}</div><figcaption><b>${label}</b>${esc(d.title)}</figcaption></figure>`;
  } catch (e) { console.warn('diagram failed', e, d); return ''; }
}
function quizHTML(qs, key) {
  return `<div class="quiz">${qs.map((q, i) => {
    const k = `${key}.${i}`, pick = P.quiz[k];
    const done = pick != null;
    return `<div class="q${done ? ' done' : ''}" data-k="${k}" data-a="${q.answer}"><h4><span>${inline(q.question)}</span></h4>
      <div class="choices">${q.choices.map((c, j) => `<button data-j="${j}" data-l="${'ABCDEF'[j]}" ${done ? 'disabled' : ''} class="${done && j === q.answer ? 'right' : done && j === pick ? 'wrong' : ''}">${ti(c)}</button>`).join('')}</div>
      <div class="why"><b>${done && pick === q.answer ? 'Right' : 'Why'}</b>${inline(q.explanation)}</div></div>`;
  }).join('')}<div class="score" data-key="${key}"></div></div>`;
}
function wireQuiz(root) {
  const score = () => $$('.score', root).forEach(s => {
    const qs = $$(`.q[data-k^="${s.dataset.key}."]`, root), done = qs.filter(q => P.quiz[q.dataset.k] != null);
    const right = done.filter(q => P.quiz[q.dataset.k] === +q.dataset.a).length;
    s.textContent = done.length ? `${right} of ${qs.length} right${done.length < qs.length ? ` so far` : ''}.` + (done.length === qs.length ? ' ' + (right === qs.length ? 'Clean sweep.' : 'Re-read the explanations for the misses; they are the useful part.') : '') : '';
    if (done.length === qs.length && qs.length) s.innerHTML += ' <button class="retry" style="background:none;border:0;color:var(--link);text-decoration:underline;padding:0;font:inherit">Try again</button>';
  });
  $$('.q .choices button', root).forEach(b => b.onclick = () => {
    const q = b.closest('.q'), j = +b.dataset.j, a = +q.dataset.a;
    P.quiz[q.dataset.k] = j; save();
    $$('button', q).forEach((x, i) => { x.disabled = true; x.classList.toggle('right', i === a); x.classList.toggle('wrong', i === j && j !== a); });
    q.classList.add('done');
    $('.why b', q).textContent = j === a ? 'Right' : 'Why';
    score();
  });
  root.addEventListener('click', e => {
    if (!e.target.classList.contains('retry')) return;
    const key = e.target.closest('.score').dataset.key;
    Object.keys(P.quiz).filter(k => k.startsWith(key + '.')).forEach(k => delete P.quiz[k]);
    save(); ctx.keepScroll = true; route();
  });
  score();
}
const impHTML = (i, extra = '') => `<div class="imp ${i.impact}"><h4>${inline(i.title)}</h4>
  <div class="meta"><span class="pill i">${i.impact} impact</span><span class="pill">${i.effort} effort</span>${i.file && ctx.byPath[i.file] ? `<a href="${fileHref(i.file)}${i.line ? ':L' + i.line : ''}"><code>${esc(i.file)}${i.line ? ':' + i.line : ''}</code></a>` : ''}${extra}</div>
  <div class="prose">${md(i.detail || i.why || '')}</div></div>`;

// ---------- cover ----------
function coverView() {
  const C = G.course, S = G.project.stats;
  const mins = Math.max(5, Math.round(ctx.words / 220 / 5) * 5);
  const totalLoc = S.languages.reduce((a, [, n]) => a + n, 0);
  const next = C.chapters.findIndex((_, i) => !P.read[i]);
  const started = Object.keys(P.read).length > 0;
  return `<article class="page">
    <header class="cover-head">
      <div class="label">A field guide to</div>
      <h1 class="title">${esc(C.title)}</h1>
      <p class="dek">${esc(C.tagline)}</p>
      <div class="facts">
        <div><b>${S.loc.toLocaleString()}</b><span>lines of code</span></div>
        <div><b>${S.files}</b><span>source files</span></div>
        <div><b>${C.chapters.length}</b><span>chapters</span></div>
        <div><b>~${mins >= 60 ? (mins / 60).toFixed(1).replace('.0', '') + ' h' : mins + ' min'}</b><span>to read</span></div>
      </div>
      <div class="langbar">${S.languages.map(([l, n]) => `<i style="flex:${n};background:${ctx.langColor[l]}" title="${l}: ${n} lines"></i>`).join('')}</div>
      <div class="langkey">${S.languages.slice(0, 7).map(([l, n]) => `<span style="--c:${ctx.langColor[l]}">${l} ${Math.round((n / totalLoc) * 100)}%</span>`).join('')}</div>
      <a class="begin" href="${next < 0 ? '#/review' : `#/ch/${next + 1}`}">${!started ? 'Begin with chapter 1' : next < 0 ? 'Read the closing chapter' : `Continue with chapter ${next + 1}`} <span aria-hidden="true">→</span></a>
    </header>
    ${G.stale.length ? `<div class="stale-note"><b>The code has moved on.</b> ${plural(G.stale.length, 'file')} changed since this guide was built on ${esc(G.built.slice(0, 10))}${G.stale.length <= 4 ? `: ${G.stale.map(p => `<a href="${fileHref(p)}"><code>${esc(p)}</code></a>`).join(', ')}` : ''}. Rebuild to bring it up to date; only the changed parts are rewritten.<pre>python3 -m fieldguide build ${esc(G.project.root)}${G.slug !== G.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ? ` --name ${G.slug}` : ''}</pre></div>` : ''}
    <div class="prose">${md(C.overview)}</div>
    <h2>How it runs</h2>
    <div class="prose">${md(C.how_it_runs)}</div>
    <figure class="diagram bleed" id="arch-fig"><div class="canvas">${architecture(C.components, C.component_edges, c => compStat(c))}</div>
      <figcaption><b>Fig. 0.1</b>The parts of ${esc(C.title)} and what flows between them. Click a part to see its files.</figcaption></figure>
    ${C.tech?.length ? `<h2>Built with</h2><dl class="tech">${C.tech.map(t => `<dt>${esc(t.name)}</dt><dd>${md(t.role).replace(/^<p>|<\/p>$/g, '')}</dd>`).join('')}</dl>` : ''}
    ${C.how_to_run ? `<h2>Running it yourself</h2><div class="prose">${md(C.how_to_run)}</div>` : ''}
    <h2>Contents</h2>
    <ol class="toc">${C.chapters.map((c, i) => `<li><a href="#/ch/${i + 1}"><span class="num">${i + 1}</span><div><h4>${ti(c.title)}</h4><p>${inline(G.chapters[i]?.summary || c.goal)}</p></div><span class="tick">${P.read[i] ? '✓' : ''}</span></a></li>`).join('')}
      <li><a href="#/review"><span class="num">∎</span><div><h4>Putting it together</h4><p>The whole system in one picture, the ideas to keep, a final quiz and where to improve it.</p></div><span class="tick">${P.read.review ? '✓' : ''}</span></a></li></ol>
  </article>`;
}
function compStat(c) {
  const loc = c.files.reduce((a, p) => a + (ctx.byPath[p]?.loc || 0), 0);
  return `${plural(c.files.length, 'file')} · ${loc.toLocaleString()} lines`;
}

// ---------- chapter ----------
function chapterView(i) {
  const c = G.course.chapters[i], b = G.chapters[i], n = i + 1;
  if (!c) return `<article class="page"><p>No chapter ${n}.</p></article>`;
  ctx.focus = { files: c.files, where: `Chapter ${n}: ${c.title}` };
  const prev = i > 0 ? `<a href="#/ch/${i}"><small>← Chapter ${i}</small>${ti(G.course.chapters[i - 1].title)}</a>` : `<a href="#/"><small>← Overview</small>${esc(G.course.title)}</a>`;
  const next = i < G.course.chapters.length - 1 ? `<a href="#/ch/${n + 1}"><small>Chapter ${n + 1} →</small>${ti(G.course.chapters[n].title)}</a>` : `<a href="#/review"><small>Last →</small>Putting it together</a>`;
  if (!b) return `<article class="page"><header class="ch-head"><div class="label">Chapter ${pad2(n)}</div><h1 class="title">${ti(c.title)}</h1><p class="dek">${inline(c.goal)}</p></header>
    <div class="missing">This chapter failed to generate. Run the build command again and it will be filled in; finished chapters are cached.</div><nav class="ch-foot"><div>${prev}</div><div class="mid"></div><div class="next">${next}</div></nav></article>`;
  let fig = 0, lst = 0;
  const extra = [['design_notes', 'Why it\'s built this way', 'a-why'], ['improvements', 'Where it could be better', 'a-imp'], ['quiz', 'Check yourself', 'a-quiz'], ['exercises', 'Try it in the code', 'a-try']].filter(([k]) => b[k]?.length);
  return `<nav class="otp" aria-label="On this page"><div class="label">On this page</div>${b.sections.map((s, k) => `<a href="#s${k + 1}" data-to="s${k + 1}"><span>${n}.${k + 1}</span>${ti(s.heading)}</a>`).join('')}${extra.map(([, t, id]) => `<a href="#${id}" data-to="${id}" class="x">${t}</a>`).join('')}</nav>
  <article class="page">
    <header class="ch-head"><div class="label">Chapter ${pad2(n)}</div><h1 class="title">${ti(c.title)}</h1><p class="dek">${inline(c.goal)}</p>
      <div class="ch-files">${c.files.map(p => `<a class="chip" href="${fileHref(p)}">${esc(p)}</a>`).join('')}</div></header>
    ${b.sections.map((s, k) => `<section class="section" id="s${k + 1}"><h2><span class="sec-num">${n}.${k + 1}</span>${ti(s.heading)}</h2>
      <div class="prose">${md(s.body)}</div>
      ${s.diagram ? diagramFigure(s.diagram, `Fig. ${n}.${++fig}`) : ''}
      ${(s.code || []).map(x => codeFigure(x, `Listing ${n}.${++lst}`)).join('')}</section>`).join('')}
    ${b.design_notes?.length ? `<section class="aside" id="a-why"><h2>Why it's built this way</h2><div class="decisions">${b.design_notes.map(d => `<div class="decision"><h4>${inline(d.decision)}</h4>
      <div class="k">Reason</div><div class="v prose">${md(d.why)}</div><div class="k">Alternative</div><div class="v prose">${md(d.alternative)}</div></div>`).join('')}</div></section>` : ''}
    ${b.improvements?.length ? `<section class="aside" id="a-imp"><h2>Where it could be better</h2>${b.improvements.map(x => impHTML(x)).join('')}</section>` : ''}
    ${b.quiz?.length ? `<section class="aside" id="a-quiz"><h2>Check yourself</h2>${quizHTML(b.quiz, 'c' + i)}</section>` : ''}
    ${b.exercises?.length ? `<section class="aside" id="a-try"><h2>Try it in the code</h2>${b.exercises.map((x, k) => `<div class="exercise"><span class="n">${k + 1}</span><div><div class="prose">${md(x.task)}</div><details><summary>Hint</summary><div class="prose">${md(x.hint)}</div></details></div></div>`).join('')}</section>` : ''}
    ${b.takeaways?.length ? `<div class="takeaways"><div class="label">Keep in mind</div><ol>${b.takeaways.map(t => `<li>${md(t).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ol></div>` : ''}
    <nav class="ch-foot"><div>${prev}</div><div class="mid"><button class="done-btn${P.read[i] ? ' on' : ''}" data-read="${i}">${P.read[i] ? '✓ Understood' : 'Mark as understood'}</button></div><div class="next">${next}</div></nav>
  </article>`;
}

// the outline links are in-page anchors, but the router owns the hash, so scroll instead of navigating
function wireOutline() {
  const links = $$('.otp a');
  links.forEach(a => (a.onclick = e => { e.preventDefault(); $('#' + a.dataset.to)?.scrollIntoView({ behavior: 'smooth' }); }));
  const spy = () => {
    let cur = links[0];
    for (const a of links) if ($('#' + a.dataset.to)?.getBoundingClientRect().top < innerHeight * 0.3) cur = a;
    links.forEach(a => a.classList.toggle('on', a === cur));
  };
  ctx.onScroll = spy;
  spy();
}

// ---------- closing chapter ----------
function reviewView() {
  const K = G.capstone;
  ctx.focus = { files: [], where: 'The whole project' };
  if (!K) return `<article class="page"><h1 class="title">Putting it together</h1><div class="missing">The closing chapter failed to generate. Run the build again to fill it in.</div></article>`;
  return `<article class="page">
    <header class="ch-head"><div class="label">Closing chapter</div><h1 class="title">Putting it together</h1><p class="dek">The whole of ${esc(G.course.title)} in one picture, and what to do with it next.</p></header>
    <div class="prose">${md(K.recap)}</div>
    <h2>The mental model</h2><p style="color:var(--ink-2)">If you can explain each of these from memory, you understand the project.</p>
    <ol class="mm">${K.mental_model.map((m, i) => `<li><span class="n">${i + 1}</span><div><b>${inline(m.idea)}</b><span class="prose">${md(m.detail).replace(/^<p>|<\/p>$/g, '')}</span></div></li>`).join('')}</ol>
    <p style="color:var(--ink-2)">To make it stick, run through the <a href="#/cards">flashcards</a> a few times over the next week.</p>
    <h2>Final quiz</h2>${quizHTML(K.final_quiz, 'final')}
    <h2>What to improve, in order</h2><p style="color:var(--ink-2)">The full list, with every chapter's findings, is under <a href="#/improve">Improvements</a>.</p>
    ${roadmapHTML(K.roadmap)}
    <h2>Where to go from here</h2><div class="prose"><ul>${K.next_steps.map(s => `<li>${md(s).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul></div>
    <nav class="ch-foot"><div><a href="#/ch/${G.course.chapters.length}"><small>← Chapter ${G.course.chapters.length}</small>${ti(G.course.chapters.at(-1).title)}</a></div>
      <div class="mid"><button class="done-btn${P.read.review ? ' on' : ''}" data-read="review">${P.read.review ? '✓ Understood' : 'Mark as understood'}</button></div><div class="next"><a href="#/cards"><small>Next →</small>Flashcards</a></div></nav>
  </article>`;
}
const roadmapHTML = rm => `<ol class="roadmap">${rm.map(r => `<li><div><h4>${inline(r.title)}</h4>
  <div class="imp ${r.impact}" style="border:0;padding:0;margin:0"><div class="meta"><span class="pill i">${r.impact} impact</span><span class="pill">${r.effort} effort</span>${r.files.filter(p => ctx.byPath[p]).map(p => `<a href="${fileHref(p)}"><code>${esc(p)}</code></a>`).join('')}</div></div>
  <div class="prose">${md(r.why)}</div><div class="prose" style="color:var(--ink-2)"><p><strong style="font:600 11px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-right:6px">How</strong>${md(r.how).replace(/^<p>|<\/p>$/g, '')}</p></div></div></li>`).join('')}</ol>`;

// ---------- map ----------
function mapView() {
  const tab = (location.hash.match(/^#\/map\/(\w+)/) || [])[1] || 'parts';
  const C = G.course;
  return `<article class="page wide">
    <header class="ch-head" style="margin-bottom:10px"><div class="label">Reference</div><h1 class="title">Map of the code</h1>
      <p class="dek" style="margin-bottom:0">Three views of the same project: its parts, who imports whom, and where the lines are.</p></header>
    <div class="tabs" role="tablist">${[['parts', 'Parts'], ['imports', 'Import graph'], ['size', 'Size']].map(([k, t]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${tab === 'parts' ? `<figure class="diagram" style="margin-top:26px" id="arch-fig"><div class="canvas" style="border-top:0">${architecture(C.components, C.component_edges, c => compStat(c))}</div></figure>
      <div class="comp-list">${C.components.map((c, i) => `<div id="comp-${esc(c.id)}"><h4 style="--c:var(--c${i % 8})"><i></i>${esc(c.name)}</h4><p>${esc(c.summary)}</p><div class="files">${c.files.map(p => `<a class="chip" href="${fileHref(p)}">${esc(p.split('/').pop())}</a>`).join('')}</div></div>`).join('')}</div>`
    : `<div class="legend" id="legend">${C.components.map((c, i) => `<button data-g="${i}" style="--c:var(--c${i % 8})"><i></i>${esc(c.name)}</button>`).join('')}</div>
      ${tab === 'imports' ? `<div class="graph-wrap" id="graph"><div class="graph-tip"></div><div class="graph-hint">Drag to pan · scroll to zoom · hover a file to trace its imports · click to open</div></div>`
      : `<div class="treemap" id="tmap"></div><p style="font:13px var(--sans);color:var(--muted)">Each rectangle is a file, sized by lines of code and coloured by part. Grouped by folder.</p>`}`}
  </article>`;
}
function wireMap() {
  $$('.tabs button').forEach(b => (b.onclick = () => (location.hash = '#/map/' + b.dataset.tab)));
  const g = $('#graph');
  if (g) {
    const files = G.project.files.filter(f => !f.supporting).slice(0, 700);
    const nodes = files.map(f => ({ id: f.path, label: f.path.split('/').pop(), r: Math.min(22, 3.5 + Math.sqrt(f.loc) * 0.42), group: ctx.comp[f.path] ?? -1, color: compColor(f.path), f }));
    const links = files.flatMap(f => f.imports.map(t => ({ source: f.path, target: t })));
    const fg = forceGraph(g, nodes, links, {
      onOpen: n => (location.hash = fileHref(n.id)),
      tip: n => `<b>${esc(n.id)}</b>${esc(G.digests[n.id]?.purpose || '')}<br><span style="opacity:.7">${n.f.loc} lines · imports ${n.f.imports.length} · imported by ${n.f.imported_by.length}</span>`,
    });
    const hidden = new Set();
    $$('#legend button').forEach(b => (b.onclick = () => { const k = +b.dataset.g; hidden.has(k) ? hidden.delete(k) : hidden.add(k); b.classList.toggle('off'); fg.filter(hidden); }));
  }
  const t = $('#tmap');
  if (t) {
    const draw = () => treemap(t, G.project.files.filter(f => !f.supporting), f => compColor(f.path), f => fileHref(f.path));
    draw();
    ctx.onResize = draw;
  }
}

// ---------- files ----------
function filesView(spec) {
  let [path, lines] = spec.split(/:L(?=\d)/);
  const f = ctx.byPath[path];
  const tree = treeHTML(path);
  if (!f) {
    const top = [...G.project.files].filter(x => !x.supporting).sort((a, b) => b.loc - a.loc).slice(0, 8);
    return `<article class="page wide"><div class="files-grid"><div class="ftree" id="ftree">${tree}</div><div>
      <div class="label">Reference</div><h1 class="title">Files</h1><p class="dek">Every file with notes on what it does, what it touches, and the chapters that teach it.</p>
      <h3>Start with the entry points</h3><div class="fmeta" style="margin-top:8px"><ul>${G.project.entries.map(p => `<li><a href="${fileHref(p)}">${esc(p)}</a> <span style="color:var(--muted)">${esc(G.digests[p]?.purpose || '')}</span></li>`).join('')}</ul></div>
      <h3>The biggest files</h3><div class="fmeta" style="margin-top:8px"><ul>${top.map(x => `<li><a href="${fileHref(x.path)}">${esc(x.path)}</a> <span style="color:var(--muted)">${x.loc} lines</span></li>`).join('')}</ul></div>
    </div></div></article>`;
  }
  ctx.focus = { files: [path], where: path };
  const d = G.digests[path] || {};
  const [a, b] = (lines || '').split('-').map(Number);
  ctx.mark = a ? [a, b || a] : null;
  const src = srcLines(path);
  const syms = f.symbols.filter(s => !['heading', 'selector'].includes(s.kind));
  const note = Object.fromEntries((d.key_symbols || []).map(k => [k.name.replace(/\(.*$/, ''), k.what]));
  const fl = (arr) => arr.length ? `<ul>${arr.map(p => `<li><a href="${fileHref(p)}">${esc(p)}</a></li>`).join('')}</ul>` : '<span style="color:var(--muted)">nothing</span>';
  return `<article class="page wide"><div class="files-grid"><div class="ftree" id="ftree">${tree}</div><div style="min-width:0">
    <div class="fhead"><div class="label" style="color:${compColor(path)}">${esc(G.course.components[ctx.comp[path]]?.name || f.lang)}</div><h1>${esc(path)}</h1>
      ${d.purpose ? `<p class="dek">${esc(d.purpose)}</p>` : ''}</div>
    ${G.stale.includes(path) ? `<div class="stale-note"><b>Changed since the build.</b> The notes and source below are from ${esc(G.built.slice(0, 10))}; the file on disk is different now.</div>` : ''}
    ${d.summary ? `<div class="prose">${md(d.summary)}</div>` : ''}
    <div class="fmeta">
      <div><div class="label">Imports</div>${fl(f.imports)}</div>
      <div><div class="label">Imported by</div>${fl(f.imported_by)}</div>
      <div><div class="label">Taught in</div>${(ctx.chFor[path] || []).length ? `<ul>${ctx.chFor[path].map(i => `<li><a href="#/ch/${i + 1}" style="font-family:var(--sans)">${i + 1}. ${ti(G.course.chapters[i].title)}</a></li>`).join('')}</ul>` : '<span style="color:var(--muted)">only here</span>'}</div>
      <div><div class="label">Size</div>${f.lines} lines, ${f.loc} of code · ${esc(f.lang)}${f.external.length ? `<div class="label" style="margin-top:12px">Packages</div>${f.external.map(esc).join(', ')}` : ''}</div>
    </div>
    ${syms.length ? `<div class="label" style="margin-bottom:8px">Inside this file</div><ul class="sym-list">${syms.map(s => `<li><a href="${fileHref(path)}:L${s.line}-${s.end || s.line}">${s.parent ? esc(s.parent) + '.' : ''}${esc(s.name)}</a> <small style="color:var(--muted)">${s.kind} · L${s.line}</small>${note[s.name] ? `<span>${inline(note[s.name])}</span>` : s.doc ? `<span>${esc(s.doc)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    <figure class="code" style="margin-top:8px"><div class="head"><span>${esc(path)}</span><span>${f.lines} lines</span></div>
      <div class="src" id="fsrc">${src.map((l, i) => lnHTML(l, i + 1, ctx.mark && i + 1 >= ctx.mark[0] && i + 1 <= ctx.mark[1] ? ' mark' : '', ` id="L${i + 1}"`)).join('')}</div></figure>
  </div></div></article>`;
}
function treeHTML(cur) {
  let html = '<input id="ffilter" placeholder="Filter files" autocomplete="off">', prev = [];
  for (const f of G.project.files) {
    const parts = f.path.split('/');
    let k = 0;
    while (k < Math.min(prev.length, parts.length - 1) && prev[k] === parts[k]) k++;
    for (let j = k; j < parts.length - 1; j++) html += `<div class="dir" style="padding-left:${j * 14}px">${esc(parts[j])}/</div>`;
    html += `<a href="${fileHref(f.path)}" data-p="${esc(f.path)}" class="${f.path === cur ? 'on' : ''}" style="padding-left:${(parts.length - 1) * 14 + 6}px"><span>${esc(parts.at(-1))}</span><small>${f.loc}</small></a>`;
    prev = parts.slice(0, -1);
  }
  return html;
}
function wireFiles() {
  const inp = $('#ffilter');
  if (inp) inp.oninput = () => {
    const q = inp.value.toLowerCase();
    $$('#ftree a').forEach(a => (a.style.display = !q || a.dataset.p.toLowerCase().includes(q) ? '' : 'none'));
    $$('#ftree .dir').forEach(d => (d.style.display = q ? 'none' : ''));
  };
  const on = $('#ftree a.on');
  if (on) on.scrollIntoView({ block: 'center' });
  if (ctx.mark) requestAnimationFrame(() => {
    const el = $('#L' + ctx.mark[0]);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 120 });
    ctx.keepScroll = true;
  });
}

// ---------- glossary ----------
function glossaryView() {
  const terms = new Map();
  G.chapters.forEach((ch, i) => ch?.terms?.forEach(t => {
    const k = t.term.toLowerCase();
    if (!terms.has(k)) terms.set(k, { ...t, ch: [] });
    terms.get(k).ch.includes(i) || terms.get(k).ch.push(i);
  }));
  const key = t => t.term.replace(/^[^a-z0-9]+/i, ''); // _private and <tag> terms file under their first letter
  const sorted = [...terms.values()].sort((a, b) => key(a).localeCompare(key(b), undefined, { sensitivity: 'base' }));
  let html = '', letter = '';
  for (const t of sorted) {
    const L = key(t)[0]?.toUpperCase() || '#';
    if (L !== letter) { letter = L; html += `<div class="letter">${esc(L)}</div>`; }
    html += `<dt id="t-${esc(t.term.toLowerCase().replace(/\W+/g, '-'))}">${esc(t.term)}</dt><dd>${md(t.definition).replace(/^<p>|<\/p>$/g, '')} <small>${t.ch.map(i => `<a href="#/ch/${i + 1}">ch. ${i + 1}</a>`).join(', ')}</small></dd>`;
  }
  return `<article class="page"><header class="ch-head"><div class="label">Reference</div><h1 class="title">Glossary</h1>
    <p class="dek">${plural(sorted.length, 'term')} used in this guide, from this project's own vocabulary to the general ideas it relies on.</p></header>
    <dl class="gloss">${html}</dl></article>`;
}

// ---------- flashcards ----------
const KINDS = { term: 'Terms', why: 'Design decisions', idea: 'Big ideas' };
function deck() {
  const cards = [], seen = new Set();
  const add = (kind, front, back, ch) => {
    const id = kind + ':' + front.toLowerCase();
    if (!seen.has(id)) { seen.add(id); cards.push({ id, kind, front, back, ch }); }
  };
  G.chapters.forEach((ch, i) => {
    ch?.terms?.forEach(t => add('term', t.term, t.definition, i));
    ch?.design_notes?.forEach(d => add('why', d.decision, `${d.why}\n\n**Instead:** ${d.alternative}`, i));
  });
  G.capstone?.mental_model?.forEach(m => add('idea', m.idea, m.detail));
  return cards;
}
// Leitner boxes: a card you know moves up a box and comes round less often; a miss sends it back to box 0
function cardQueue(cards, boxes, n = 20) {
  return [...cards].sort((a, b) => (boxes[a.id] || 0) - (boxes[b.id] || 0) || a.r - b.r).slice(0, n);
}
function cardsView() {
  P.cards ||= {};
  const f = ctx.cardFilter || 'all', all = deck();
  const known = all.filter(c => (P.cards[c.id] || 0) >= 2).length;
  return `<article class="page"><header class="ch-head"><div class="label">Reference</div><h1 class="title">Flashcards</h1>
    <p class="dek">The guide's vocabulary, its design decisions and its big ideas, one at a time. Say the answer out loud before you turn the card.</p></header>
    <div class="filters">${[['all', `All ${all.length}`], ...Object.entries(KINDS).map(([k, t]) => [k, `${t} ${all.filter(c => c.kind === k).length}`])].map(([k, t]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="deck-stats"><span>${known} of ${all.length} known</span><div class="bar"><i style="width:${all.length ? (known / all.length) * 100 : 0}%"></i></div></div>
    <div id="card"></div></article>`;
}
function wireCards() {
  const f = ctx.cardFilter || 'all';
  const cards = deck().filter(c => f === 'all' || c.kind === f).map(c => ({ ...c, r: Math.random() }));
  let queue = cardQueue(cards, P.cards), shown = false, right = 0, seen = 0;
  const el = $('#card');
  const draw = () => {
    const c = queue[0];
    if (!c) {
      el.innerHTML = `<div class="flash end"><div class="label">Round done</div><p class="front">${seen ? `You knew ${right} of ${seen}.` : 'No cards here yet.'}</p>
        ${seen ? `<p>Cards you missed come up first next time. A few short rounds over several days beat one long one.</p><div class="acts"><button class="primary" id="again-round">Another round</button></div>` : ''}</div>`;
      $('#again-round')?.addEventListener('click', () => { ctx.keepScroll = true; route(); });
      return;
    }
    const box = P.cards[c.id] || 0;
    el.innerHTML = `<div class="flash${shown ? ' shown' : ''}"><div class="label">${KINDS[c.kind].replace(/s$/, '')}${c.ch != null ? ` · <a href="#/ch/${c.ch + 1}">chapter ${c.ch + 1}</a>` : ''}<span class="pips" title="Box ${box} of 4">${[0, 1, 2, 3].map(k => `<i class="${k < box ? 'on' : ''}"></i>`).join('')}</span></div>
      <p class="front">${inline(c.front)}</p>${c.kind === 'why' ? '<p class="cue">Why was it built this way, and what was the alternative?</p>' : c.kind === 'term' ? '<p class="cue">What does it mean here?</p>' : '<p class="cue">Explain it in your own words.</p>'}
      ${shown ? `<div class="back prose">${md(c.back)}</div><div class="acts"><button id="miss"><kbd>1</kbd> Again</button><button class="primary" id="hit"><kbd>2</kbd> Knew it</button></div>`
        : `<div class="acts"><button class="primary" id="flip"><kbd>Space</kbd> Show answer</button></div>`}
      <div class="left">${plural(queue.length, 'card')} left in this round</div></div>`;
    $('#flip')?.addEventListener('click', flip);
    $('#miss')?.addEventListener('click', () => grade(false));
    $('#hit')?.addEventListener('click', () => grade(true));
  };
  const flip = () => { shown = true; draw(); };
  const grade = ok => {
    const c = queue.shift();
    seen++; if (ok) right++;
    P.cards[c.id] = ok ? Math.min(4, (P.cards[c.id] || 0) + 1) : 0;
    if (!ok) queue.splice(Math.min(3, queue.length), 0, c); // see it again in a few cards
    save(); shown = false; draw();
    const all = deck(), known = all.filter(x => (P.cards[x.id] || 0) >= 2).length;
    $('.deck-stats span').textContent = `${known} of ${all.length} known`;
    $('.deck-stats i').style.width = (known / all.length) * 100 + '%';
  };
  ctx.cardKey = e => {
    if (!queue[0]) return false;
    if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); flip(); return true; }
    if (shown && (e.key === '1' || e.key === '2')) { grade(e.key === '2'); return true; }
    return false;
  };
  $$('.filters button').forEach(b => (b.onclick = () => { ctx.cardFilter = b.dataset.f; ctx.keepScroll = true; route(); }));
  draw();
}

// ---------- improvements ----------
function improveView() {
  const f = ctx.impFilter || 'all';
  const all = G.chapters.flatMap((ch, i) => (ch?.improvements || []).map(x => ({ ...x, ch: i })));
  const order = { high: 0, medium: 1, low: 2 }, eff = { small: 0, medium: 1, large: 2 };
  const shown = all.filter(x => f === 'all' || x.impact === f).sort((a, b) => order[a.impact] - order[b.impact] || eff[a.effort] - eff[b.effort]);
  const count = k => all.filter(x => x.impact === k).length;
  return `<article class="page"><header class="ch-head"><div class="label">Reference</div><h1 class="title">Improvements</h1>
    <p class="dek">What a careful reviewer would change: bugs, risks, missing tests and simplifications, each pinned to the code.</p></header>
    ${G.capstone?.roadmap?.length ? `<h2 style="margin-top:20px">The roadmap</h2><p style="color:var(--ink-2)">The most worthwhile changes across the whole project, in the order to make them.</p>${roadmapHTML(G.capstone.roadmap)}` : ''}
    <h2>Every finding</h2>
    <div class="filters">${[['all', `All ${all.length}`], ['high', `High ${count('high')}`], ['medium', `Medium ${count('medium')}`], ['low', `Low ${count('low')}`]].map(([k, t]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${shown.map(x => impHTML(x, `<a href="#/ch/${x.ch + 1}">from chapter ${x.ch + 1}</a>`)).join('')}
  </article>`;
}

// ---------- questions ----------
function qaHTML(q) {
  return `<div class="qa"><p class="qq">${esc(q.question)}</p>${q.context ? `<div class="ctx">Asked while reading ${esc(q.context)}</div>` : ''}<div class="prose">${md(q.answer)}</div>
    ${q.files?.length ? `<div class="files">${q.files.filter(p => ctx.byPath[p]).map(p => `<a class="chip" href="${fileHref(p)}">${esc(p)}</a>`).join('')}</div>` : ''}</div>`;
}
const askBox = (id, ph) => `<form class="askbox" id="${id}"><textarea name="q" placeholder="${esc(ph)}" required></textarea>
  <div class="bar"><span>Answered by Claude from the actual source. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send.</span><button type="submit">Ask</button></div></form>`;
function askView() {
  ctx.focus = null;
  return `<article class="page"><header class="ch-head"><div class="label">Reference</div><h1 class="title">Your questions</h1>
    <p class="dek">Anything the chapters didn't make clear. Answers are saved here so you can come back to them.</p></header>
    ${askBox('ask-main', 'e.g. What happens if two requests update the same record at once?')}
    <div id="qa-list">${G.qa.length ? [...G.qa].reverse().map(qaHTML).join('') : '<p style="color:var(--muted);margin-top:30px">No questions yet.</p>'}</div></article>`;
}
async function ask(form, focus, where, list, prepend) {
  const q = form.q.value.trim();
  if (!q) return;
  const btn = $('button', form);
  btn.disabled = true;
  const wait = document.createElement('div');
  wait.className = 'thinking';
  wait.textContent = 'Reading the code';
  prepend ? list.prepend(wait) : list.append(wait);
  try {
    const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guide: slug, question: q, focus, where }) });
    const a = await r.json();
    if (!r.ok) throw new Error(a.error || 'failed');
    G.qa.push(a);
    wait.outerHTML = qaHTML(a);
    form.q.value = '';
  } catch (e) {
    wait.className = 'missing';
    wait.textContent = `Couldn't get an answer: ${e.message}`;
  } finally { btn.disabled = false; }
}
function wireAskForm(form, getFocus, list, prepend) {
  form.onsubmit = e => { e.preventDefault(); const f = getFocus(); ask(form, f.files, f.where, list, prepend); };
  form.q.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); };
}
function openDrawer() {
  const f = ctx.focus;
  if (!f) return;
  $('#dr-where').textContent = f.where;
  const prior = G.qa.filter(q => q.context === f.where);
  $('#dr-body').innerHTML = askBox('ask-dr', 'What would you like explained?') + `<div id="dr-list">${prior.map(qaHTML).join('')}</div>`;
  wireAskForm($('#ask-dr'), () => f, $('#dr-list'), false);
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#ask-dr textarea').focus(), 200);
}
function closeDrawer() { $('#drawer')?.classList.remove('open'); $('#drawer')?.setAttribute('aria-hidden', 'true'); }

// ---------- search palette ----------
let palItems = [], palSel = 0;
function setupPalette() {
  const C = G.course;
  palItems = [
    ...C.chapters.map((c, i) => ({ k: 'Chapter', t: `${i + 1}. ${c.title}`, s: c.goal, h: `#/ch/${i + 1}` })),
    ...G.chapters.flatMap((ch, i) => (ch?.sections || []).map((s, k) => ({ k: 'Section', t: s.heading, s: `Chapter ${i + 1}, ${C.chapters[i].title}`, h: `#/ch/${i + 1}`, sec: `s${k + 1}` }))),
    ...G.project.files.map(f => ({ k: 'File', t: f.path, s: G.digests[f.path]?.purpose || '', h: fileHref(f.path) })),
    ...G.project.files.flatMap(f => f.symbols.filter(s => !['heading', 'selector'].includes(s.kind)).map(s => ({ k: s.kind === 'class' ? 'Class' : 'Function', t: (s.parent ? s.parent + '.' : '') + s.name, s: f.path, h: `${fileHref(f.path)}:L${s.line}-${s.end || s.line}` }))),
    ...G.chapters.flatMap((ch, i) => (ch?.terms || []).map(t => ({ k: 'Term', t: t.term, s: t.definition, h: '#/glossary', term: t.term }))),
    { k: 'Page', t: 'Map of the code', s: 'Parts, import graph, size', h: '#/map' },
    { k: 'Page', t: 'Flashcards', s: 'Terms, design decisions and big ideas', h: '#/cards' },
    { k: 'Page', t: 'Improvements', s: 'Roadmap and every finding', h: '#/improve' },
    { k: 'Page', t: 'Putting it together', s: 'Recap, mental model, final quiz', h: '#/review' },
  ];
  const inp = $('#pal-in');
  inp.oninput = () => { palSel = 0; renderPal(); };
  inp.onkeydown = e => {
    const n = $$('#pal-list li').length;
    if (e.key === 'ArrowDown') { palSel = Math.min(n - 1, palSel + 1); renderPal(false); e.preventDefault(); }
    if (e.key === 'ArrowUp') { palSel = Math.max(0, palSel - 1); renderPal(false); e.preventDefault(); }
    if (e.key === 'Enter') { const a = $$('#pal-list a')[palSel]; if (a) { a.click(); } }
  };
  $('#pal').onclick = e => { if (e.target.id === 'pal') closePalette(); };
}
function renderPal(rebuild = true) {
  const q = $('#pal-in').value.trim().toLowerCase();
  if (rebuild) {
    const scored = [];
    for (const it of palItems) {
      const t = it.t.toLowerCase();
      let s = !q ? (it.k === 'Chapter' ? 1 : 0) : t === q ? 100 : t.startsWith(q) ? 60 : t.includes(q) ? 40 - t.indexOf(q) / 10 : it.s.toLowerCase().includes(q) ? 8 : 0;
      if (s) scored.push([s + (it.k === 'Chapter' ? 6 : it.k === 'File' ? 4 : 0), it]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    ctx.palShown = scored.slice(0, 40).map(x => x[1]);
  }
  $('#pal-list').innerHTML = ctx.palShown.length ? ctx.palShown.map((it, i) => `<li class="${i === palSel ? 'sel' : ''}"><a href="${it.h}" data-i="${i}"><small>${it.k}</small><span>${esc(it.t.replace(/`/g, ''))}<em>${esc(it.s.replace(/`/g, ''))}</em></span></a></li>`).join('') : '<div class="empty">Nothing matches.</div>';
  $$('#pal-list a').forEach(a => (a.onclick = () => {
    const it = ctx.palShown[+a.dataset.i];
    closePalette();
    if (it.sec) setTimeout(() => $('#' + it.sec)?.scrollIntoView(), 30);
    if (it.term) setTimeout(() => $('#t-' + it.term.toLowerCase().replace(/\W+/g, '-'))?.scrollIntoView({ block: 'center' }), 30);
  }));
  $('#pal-list li.sel')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#pal').classList.add('open'); $('#pal-in').value = ''; palSel = 0; renderPal(); $('#pal-in').focus(); }
function closePalette() { $('#pal')?.classList.remove('open'); }

// ---------- per-view wiring ----------
function wire(active) {
  ctx.onResize = null; ctx.onScroll = null;
  wireQuiz($('#main'));
  $$('[data-read]').forEach(b => (b.onclick = () => {
    const k = b.dataset.read;
    P.read[k] ? delete P.read[k] : (P.read[k] = Date.now());
    save();
    b.classList.toggle('on', !!P.read[k]);
    b.textContent = P.read[k] ? '✓ Understood' : 'Mark as understood';
    side(active);
  }));
  $$('#arch-fig .box').forEach(b => (b.onclick = () => {
    if (active === 'map') $('#comp-' + CSS.escape(b.dataset.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else location.hash = '#/map/parts';
  }));
  if (active === 'map') wireMap();
  if (active === 'files') wireFiles();
  if (active === 'improve') $$('.filters button').forEach(b => (b.onclick = () => { ctx.impFilter = b.dataset.f; ctx.keepScroll = true; route(); }));
  if (active === 'cards') wireCards();
  if ($('.otp')) wireOutline();
  if (active === 'ask') wireAskForm($('#ask-main'), () => ({ files: [], where: '' }), $('#qa-list'), true);
}
let rt;
window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => ctx.onResize?.(), 150); });
