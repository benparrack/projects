// Pulls postings from community-maintained GitHub internship lists.
import { createHash } from 'node:crypto';
import { meta } from './db.js';

export const SOURCES = [
  { repo: 'SimplifyJobs/Summer2027-Internships', branch: 'dev', file: '.github/scripts/listings.json', kind: 'simplify' },
  { repo: 'speedyapply/2027-SWE-College-Jobs', branch: 'main', file: 'README.md', kind: 'table' },
];

// Same posting shows up in several repos with different tracking params.
export function normUrl(u) {
  const x = new URL(u);
  for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref|source|gh_src|src)/i.test(k)) x.searchParams.delete(k);
  return (x.host + x.pathname).replace(/\/(apply|application)\/?$/, '').replace(/\/$/, '').toLowerCase() + x.search;
}
const idFor = url => createHash('sha1').update(normUrl(url)).digest('hex').slice(0, 16);

export function parseSimplify(text) {
  return JSON.parse(text)
    .filter(j => j.active && j.is_visible !== false && (j.terms || []).some(t => /summer 2027/i.test(t)))
    .map(j => ({
      id: idFor(j.url), source: 'simplify', company: j.company_name, title: j.title, url: j.url,
      locations: j.locations || [], category: j.category, degrees: j.degrees || [], posted: j.date_posted * 1000,
    }));
}

const cellText = c => c.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

// Markdown/HTML tables: | Company | Position | Location | ... | <a href=apply> | Age |
export function parseTable(text, source) {
  const out = [];
  let header = null, lastCompany = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) { header = null; continue; }
    const cells = line.split('|').slice(1, -1);
    if (!header) { header = cells.map(c => cellText(c).toLowerCase()); continue; }
    if (/^\s*:?-+/.test(cells[0])) continue;
    const col = name => cells[header.findIndex(h => h.includes(name))] ?? '';
    const link = [...(col('posting') || col('apply') || col('application') || line)
      .matchAll(/href="([^"]+)"|\]\((https?:[^)]+)\)/g)].map(m => m[1] || m[2]).at(-1);
    if (!link) continue;
    let company = cellText(col('company'));
    if (company === '↳' || !company) company = lastCompany; else lastCompany = company;
    const title = cellText(col('position') || col('role') || col('title'));
    if (!/intern|co-?op/i.test(title)) continue;
    out.push({
      id: idFor(link), source, company, title, url: link,
      locations: cellText(col('location')).split(/<br>|;|\s\/\s/).map(s => s.trim()).filter(Boolean),
      category: null, degrees: [], posted: Date.now(),
    });
  }
  return out;
}

async function headSha({ repo, branch }) {
  const r = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, { headers: { Accept: 'application/vnd.github.sha' } });
  return r.ok ? (await r.text()).trim() : null;
}

// Returns postings from every source whose repo changed since last time (or all, with force).
export async function fetchAll({ force = false } = {}) {
  const jobs = [];
  for (const s of SOURCES) {
    const sha = await headSha(s).catch(() => null);
    if (!force && sha && meta.get('sha:' + s.repo) === sha) continue;
    const r = await fetch(`https://raw.githubusercontent.com/${s.repo}/${s.branch}/${s.file}`);
    if (!r.ok) { console.error(`source ${s.repo}: HTTP ${r.status}`); continue; }
    const text = await r.text();
    const got = s.kind === 'simplify' ? parseSimplify(text) : parseTable(text, s.repo.split('/')[0]);
    jobs.push(...got);
    if (sha) meta.set('sha:' + s.repo, sha);
  }
  return jobs;
}
