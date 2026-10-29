// Small markdown renderer + syntax highlighter. Inline `code` that names a project file or symbol
// becomes a link into the file explorer, which is most of what makes the prose feel connected.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let linker = () => null;
export function setLinker(fn) { linker = fn; }

export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => /^(https?:|#)/.test(u) ? `<a href="${u}"${u[0] === '#' ? '' : ' target="_blank" rel="noopener"'}>${t}</a>` : t);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => {
    const c = codes[+i], href = linker(c);
    return href ? `<a class="ref" href="${href}"><code>${esc(c)}</code></a>` : `<code>${esc(c)}</code>`;
  });
}

export function md(src) {
  const lines = String(src ?? '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = l => /^(```|#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('```')) {
      const lang = l.slice(3).trim(), buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${highlight(buf.join('\n'), lang)}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { const n = Math.min(4, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s/.test(l)) {
      const ordered = /^\s*\d/.test(l), items = [];
      while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*([-*+]|\d+[.)])\s/.test(lines[i]) && !/^\s{4,}/.test(lines[i])) items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const t = ordered ? 'ol' : 'ul';
      out.push(`<${t}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${t}>`);
      continue;
    }
    if (/^\|/.test(l) && /^\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const buf = [l];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------- highlighting ----------

const KW = {
  python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self cls match case',
  js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield null undefined true false interface type enum implements private public protected readonly as',
  lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while self',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class public private protected virtual template typename namespace using new delete nullptr this',
  shell: 'if then else elif fi for while do done case esac in function return local export echo exit set',
  css: '',
  sql: 'select from where insert into update delete create table index join left right inner outer on group by order having limit and or not null as primary key values',
};
const FAMILY = { python: 'python', javascript: 'js', typescript: 'js', js: 'js', ts: 'js', lua: 'lua', go: 'go', rust: 'rust', c: 'c', cpp: 'c', java: 'c', csharp: 'c', kotlin: 'c', swift: 'c', glsl: 'c', zig: 'rust', shell: 'shell', bash: 'shell', sh: 'shell', sql: 'sql', ruby: 'python', php: 'js', gdscript: 'python', css: 'css', py: 'python' };
const sets = {};
const kwset = f => sets[f] || (sets[f] = new Set(KW[f].split(' ')));

export function highlight(code, lang) {
  const fam = FAMILY[lang] || (lang === 'html' ? 'html' : null);
  if (!fam || fam === 'css' || fam === 'html') return fam ? markup(code, fam) : esc(code);
  const kws = kwset(fam);
  const hashCom = ['python', 'shell'].includes(fam), dashCom = fam === 'lua' || fam === 'sql';
  let out = '', i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i], rest = code.slice(i, i + 3);
    let m;
    if ((hashCom && c === '#') || (!hashCom && !dashCom && rest.startsWith('//')) || (dashCom && rest.startsWith('--') && !code.startsWith('--[[', i))) {
      const e = code.indexOf('\n', i); const end = e < 0 ? n : e;
      out += `<span class="t-com">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if ((!hashCom && !dashCom && rest.startsWith('/*')) || (dashCom && code.startsWith('--[[', i))) {
      const close = dashCom ? ']]' : '*/'; const e = code.indexOf(close, i + 2); const end = e < 0 ? n : e + 2;
      out += `<span class="t-com">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if (fam === 'python' && (rest === '"""' || rest === "'''")) {
      const e = code.indexOf(rest, i + 3); const end = e < 0 ? n : e + 3;
      out += `<span class="t-str">${esc(code.slice(i, end))}</span>`; i = end; continue;
    }
    if (c === '"' || c === "'" || (c === '`' && fam === 'js')) {
      let j = i + 1;
      while (j < n && code[j] !== c && !(code[j] === '\n' && c !== '`')) j += code[j] === '\\' ? 2 : 1;
      out += `<span class="t-str">${esc(code.slice(i, j + 1))}</span>`; i = j + 1; continue;
    }
    if ((m = /^\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|^0x[\da-fA-F]+/.exec(code.slice(i, i + 40))) && !/[\w$]/.test(code[i - 1] || '')) {
      out += `<span class="t-num">${m[0]}</span>`; i += m[0].length; continue;
    }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 80)))) {
      const w = m[0], after = code.slice(i + w.length).match(/^\s*\(/);
      if (kws.has(w)) out += `<span class="t-kw">${w}</span>`;
      else if (after) out += `<span class="t-fn">${w}</span>`;
      else if (/^[A-Z][a-z]/.test(w)) out += `<span class="t-type">${w}</span>`;
      else out += w;
      i += w.length; continue;
    }
    out += esc(c); i++;
  }
  return out;
}

function markup(code, fam) {
  // Good enough for HTML/CSS: comments, strings, tags/properties.
  let s = esc(code);
  s = s.replace(/(&lt;!--[\s\S]*?--&gt;|\/\*[\s\S]*?\*\/)/g, '<span class="t-com">$1</span>');
  s = s.replace(/(&quot;[^&\n]*?&quot;|&#39;[^&\n]*?&#39;)/g, '<span class="t-str">$1</span>');
  if (fam === 'html') s = s.replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span class="t-kw">$2</span>');
  else s = s.replace(/^(\s*)([a-z-]+)(\s*:)/gm, '$1<span class="t-fn">$2</span>$3');
  return s;
}

// Highlight a whole file once and split into lines, carrying open multi-line tokens across line breaks.
export function highlightLines(code, lang) {
  const html = highlight(code, lang);
  const lines = [];
  let open = [];
  for (const raw of html.split('\n')) {
    let line = open.join('') + raw;
    const stack = [...open];
    for (const m of raw.matchAll(/<span class="[^"]+">|<\/span>/g)) m[0] === '</span>' ? stack.pop() : stack.push(m[0]);
    line += '</span>'.repeat(stack.length);
    open = stack;
    lines.push(line);
  }
  return lines;
}
