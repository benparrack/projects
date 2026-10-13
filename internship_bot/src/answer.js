// Turns a form's questions into answers. Order: standard fields → learned answers → Claude.
// Anything Claude can't back with Ben's own facts comes back in `needs` instead of being guessed.
//
// Question shape (same for every ATS): { key, label, type, options, required }
//   type: text | textarea | select | multiselect | file | checkbox
import YAML from 'yaml';
import { loadProfile, resumeFor, filePath, normQ } from './profile.js';
import { askClaude } from './llm.js';
import { db } from './db.js';

const SYSTEM = `You fill out internship applications on behalf of Ben Parrack. You are given his
PROFILE (hard facts), LEARNED ANSWERS (answers he gave before), RESUME, STORIES (essay material) and the JOB.

Rules:
- Factual questions: answer ONLY from PROFILE, LEARNED ANSWERS or RESUME. Plain deductions are fine
  (GPA 3.5 fits "3.5 - 3.6"; graduating May 2028 is "Spring 2028"; a US citizen is authorized and needs
  no sponsorship; he has done an internship, holds a leadership role, is in a university organization).
- If a fact is not in those sources (a referral name, a missing ZIP code, a specific skill or course not
  listed, a yes/no he never stated), set answer to null and say what is missing in need_human_reason.
  Never invent facts, skills, experience or numbers.
- Written questions ("why this company", "tell us about a project"): write in Ben's first-person voice,
  specific to this job and company, using only true material from STORIES and RESUME. Plain, direct,
  warm, no cliches, no em dashes. 60-150 words unless the question sets a limit.
- Select questions: answer must be exactly one of the listed options. Multiselect: options joined by " | ".
- Consent, acknowledgement and "I certify the information is accurate" checkboxes: answer "Yes".
- "How did you hear about us": Simplify/GitHub if listed, else a generic "job board"/"online"/"website" option,
  else "Other". Never a specific site Ben didn't use (Indeed, LinkedIn, Handshake, Glassdoor).
- A question that asks Ben to do outside work (visit a link and answer questions there, take a test,
  solve a coding problem): answer null with need_human_reason "external task".
- Optional questions you can't answer from the sources: answer null with need_human_reason "optional".`;

const SCHEMA = {
  type: 'object', required: ['answers'],
  properties: { answers: { type: 'array', items: {
    type: 'object', required: ['key', 'answer'],
    properties: { key: { type: 'string' }, answer: { type: ['string', 'null'] }, need_human_reason: { type: 'string' } },
  } } },
};

// Exact (case-insensitive) option match, else an option containing the answer or vice versa.
export function matchOption(options, ans) {
  if (ans == null) return null;
  const a = normQ(String(ans));
  return options.find(o => normQ(o) === a)
    ?? options.find(o => normQ(o).includes(a) || (a.length > 2 && a.includes(normQ(o)) && normQ(o).length > 1)) ?? null;
}

// Dropdowns with thousands of entries (every university): only send the options that share a
// distinctive word with Ben's profile, plus any "Other".
export function shortList(options, facts) {
  if (options.length <= 80) return options;
  const n = {};
  for (const o of options) for (const w of new Set(normQ(o).split(' '))) n[w] = (n[w] || 0) + 1;
  // Rare shared words count most ("virginia" beats "university"); education facts are what these lists are about.
  const mine = new Set(normQ(YAML.stringify(facts.education ?? facts)).split(' '));
  const score = o => normQ(o).split(' ').reduce((t, w) => t + (mine.has(w) && n[w] ? 1 / n[w] : 0), 0);
  const top = options.map(o => [o, score(o)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(x => x[0]);
  return [...top, ...options.filter(o => /^other\b/i.test(o) && !top.includes(o))];
}

// "a | b" → the matching options, or null if none match.
const pickMany = (options, ans) => {
  const v = String(ans).split('|').map(s => matchOption(options, s.trim())).filter(Boolean);
  return v.length ? v : null;
};

// Fixed answers by field key, for fields every ATS shares.
function standard(q, facts) {
  const f = facts, eeo = f.eeo || {};
  const byKey = {
    first_name: f.name.first, last_name: f.name.last, preferred_name: f.name.first, full_name: f.name.full, name: f.name.full,
    email: f.email, phone: f.phone, today: new Date().toLocaleDateString('en-US'),
    gender: eeo.gender, race: eeo.race, hispanic_ethnicity: eeo.hispanic_or_latino ? 'Yes' : 'No',
    veteran_status: /not/i.test(eeo.veteran) ? 'I am not a protected veteran' : eeo.veteran,
    disability_status: /^no/i.test(eeo.disability) ? "No, I don't have a disability" : eeo.disability,
  };
  const byLabel = { phone: f.phone, 'phone number': f.phone, linkedin: f.links.linkedin, 'linkedin profile': f.links.linkedin,
    'linkedin url': f.links.linkedin, github: f.links.github, 'github url': f.links.github, website: f.links.website,
    portfolio: f.links.website, 'portfolio url': f.links.website, 'website url': f.links.website, 'personal website': f.links.website, name: f.name.full, 'full name': f.name.full,
    // Lever's "Current company": he's a full-time student now, not still at last summer's internship.
    'current company': f.education.school, 'current employer': f.education.school };
  if (q.type === 'education') return 'from profile';
  if (q.type === 'location') return `${f.address.city}, ${f.address.state}`;
  const v = byKey[q.key] ?? (q.type === 'text' ? byLabel[normQ(q.label)] : undefined);
  if (v == null) return undefined;
  if (q.type !== 'select') return v;
  // EEO option wording varies a lot ("I am not a protected veteran" vs "No, I am not ..."): match on gist.
  return matchOption(q.options, v) ?? q.options.find(o => /veteran/.test(q.key) ? /\bnot\b/i.test(o) && /veteran/i.test(o) && !/wish|decline/i.test(o)
    : /disab/.test(q.key) ? /^no\b/i.test(o) : false) ?? undefined;
}

function fileFor(q, resume) {
  const l = `${q.key} ${q.label}`.toLowerCase();
  if (/resume|\bcv\b/.test(l)) return resume.path;
  if (/transcript/.test(l)) return filePath('transcript.pdf');
  if (/cover/.test(l)) return filePath('cover-letter.pdf');
  return null;
}

// Forms that make you swear no AI helped. Ben applies to these himself; the bot never signs them.
export const NO_AI = /(artificial intelligence|\bAI\b|chat ?gpt|language model)[^.]{0,80}(on my behalf|assist|fill|complet|generat|written)|(not|without)[^.]{0,60}(filled|completed|written)[^.]{0,60}(\bAI\b|artificial intelligence)/i;

// Learning from results: written answers from applications that got a response past rejection,
// plus Ben's own edits to drafts in the dashboard (before → after), become style examples.
export function lessons() {
  const wins = db.prepare("SELECT company, outcome, answers FROM jobs WHERE outcome IN ('offer','interview','oa') ORDER BY outcome_at DESC LIMIT 20").all()
    .flatMap(j => { const a = JSON.parse(j.answers || '{}');
      return (a.questions || []).filter(([k, , t]) => t === 'textarea' && String(a.answers?.[k] || '').length > 150)
        .map(([k, label]) => ({ outcome: j.outcome, company: j.company, question: label, answer: a.answers[k] })); })
    .slice(0, 4);
  const edits = JSON.parse(db.prepare("SELECT v FROM meta WHERE k='edits'").get()?.v || '[]').slice(-5);
  return { wins, edits };
}

export async function answerAll(questions, job, { llm = askClaude } = {}) {
  const banned = questions.find(q => NO_AI.test(q.label));
  if (banned) return { answers: {}, needs: [], manual: `asks you to certify no AI was used: "${banned.label.slice(0, 120)}..."` };
  const { facts, stories, bank } = loadProfile();
  const resume = resumeFor(job);
  const answers = {}, needs = [], ask = [];

  for (const q of questions) {
    if (q.type === 'unsupported') {
      if (q.required) needs.push({ key: q.key, label: q.label, why: 'field type the bot cannot fill yet', file: true });
      continue;
    }
    if (q.type === 'file') {
      const path = fileFor(q, resume);
      if (path) answers[q.key] = path;
      else if (q.required) needs.push({ key: q.key, label: q.label, why: 'needs a file Ben has not provided', file: true });
      continue;
    }
    const std = standard(q, facts);
    if (std !== undefined) { answers[q.key] = std; continue; }
    const learned = bank.find(b => normQ(b.q) === normQ(q.label));
    const val = learned && (q.type === 'select' ? matchOption(q.options, learned.a)
      : q.type === 'multiselect' ? pickMany(q.options, learned.a) : learned.a);
    if (val) answers[q.key] = val;
    else ask.push(q);
  }

  if (ask.length) {
    const prompt = [
      '# PROFILE\n' + YAML.stringify(facts),
      '# LEARNED ANSWERS\n' + YAML.stringify(bank),
      '# RESUME\n' + resume.text,
      '# STORIES\n' + stories,
      ...(() => { const { wins, edits } = lessons(); return [
        wins.length ? '# WRITTEN ANSWERS THAT GOT BEN AN INTERVIEW OR OFFER (reuse what worked: tone, which project, structure)\n' + YAML.stringify(wins) : '',
        edits.length ? "# BEN'S EDITS TO YOUR PAST DRAFTS (write the way he edits toward)\n" + YAML.stringify(edits) : '',
      ].filter(Boolean); })(),
      `# JOB\n${job.company}: ${job.title}\n${(job.description || '').slice(0, 6000)}`,
      '# QUESTIONS\n' + JSON.stringify(ask.map(({ key, label, type, options, required, description }) =>
        ({ key, label, type, required, ...(description ? { description } : {}), ...(options?.length ? { options: shortList(options, facts) } : {}) })), null, 1),
    ].join('\n\n');
    const out = await llm(SYSTEM, prompt, SCHEMA);
    const got = new Map(out.answers.map(a => [a.key, a]));
    for (const q of ask) {
      const a = got.get(q.key);
      let v = a?.answer ?? null;
      if (v != null && q.type === 'select') v = matchOption(q.options, v);
      if (v != null && q.type === 'multiselect') v = pickMany(q.options, v);
      if (v != null && v !== '') answers[q.key] = v;
      else if (q.required) needs.push({ key: q.key, label: q.label, options: q.options, why: a?.need_human_reason || 'no valid answer' });
    }
  }
  return { answers, needs, resume: resume.path };
}
