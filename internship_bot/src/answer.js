// Turns a form's questions into answers. Order: standard fields → learned answers → Claude.
// Anything Claude can't back with Ben's own facts comes back in `needs` instead of being guessed.
//
// Question shape (same for every ATS): { key, label, type, options, required }
//   type: text | textarea | select | multiselect | file | checkbox
import YAML from 'yaml';
import { loadProfile, resumeFor, filePath, normQ } from './profile.js';
import { askClaude } from './llm.js';

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
- "How did you hear about us": pick the option closest to an online job board, else "Other".
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

// Fixed answers by field key, for fields every ATS shares.
function standard(q, facts) {
  const f = facts, eeo = f.eeo || {};
  const byKey = {
    first_name: f.name.first, last_name: f.name.last, preferred_name: f.name.first, full_name: f.name.full, name: f.name.full,
    email: f.email, phone: f.phone,
    gender: eeo.gender, race: eeo.race, hispanic_ethnicity: eeo.hispanic_or_latino ? 'Yes' : 'No',
    veteran_status: /not/i.test(eeo.veteran) ? 'I am not a protected veteran' : eeo.veteran,
    disability_status: /^no/i.test(eeo.disability) ? "No, I don't have a disability" : eeo.disability,
  };
  const v = byKey[q.key];
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

export async function answerAll(questions, job, { llm = askClaude } = {}) {
  const banned = questions.find(q => NO_AI.test(q.label));
  if (banned) return { answers: {}, needs: [], manual: `asks you to certify no AI was used: "${banned.label.slice(0, 120)}..."` };
  const { facts, stories, bank } = loadProfile();
  const resume = resumeFor(job);
  const answers = {}, needs = [], ask = [];

  for (const q of questions) {
    if (q.type === 'file') {
      const path = fileFor(q, resume);
      if (path) answers[q.key] = path;
      else if (q.required) needs.push({ key: q.key, label: q.label, why: 'needs a file Ben has not provided', file: true });
      continue;
    }
    const std = standard(q, facts);
    if (std !== undefined) { answers[q.key] = std; continue; }
    const learned = bank.find(b => normQ(b.q) === normQ(q.label));
    const val = learned && (q.type === 'select' ? matchOption(q.options, learned.a) : learned.a);
    if (val) answers[q.key] = val;
    else ask.push(q);
  }

  if (ask.length) {
    const prompt = [
      '# PROFILE\n' + YAML.stringify(facts),
      '# LEARNED ANSWERS\n' + YAML.stringify(bank),
      '# RESUME\n' + resume.text,
      '# STORIES\n' + stories,
      `# JOB\n${job.company}: ${job.title}\n${(job.description || '').slice(0, 6000)}`,
      '# QUESTIONS\n' + JSON.stringify(ask.map(({ key, label, type, options, required }) =>
        ({ key, label, type, required, ...(options?.length ? { options } : {}) })), null, 1),
    ].join('\n\n');
    const out = await llm(SYSTEM, prompt, SCHEMA);
    const got = new Map(out.answers.map(a => [a.key, a]));
    for (const q of ask) {
      const a = got.get(q.key);
      let v = a?.answer ?? null;
      if (v != null && q.type === 'select') v = matchOption(q.options, v);
      if (v != null && q.type === 'multiselect') {
        v = String(v).split('|').map(s => matchOption(q.options, s.trim())).filter(Boolean);
        if (!v.length) v = null;
      }
      if (v != null && v !== '') answers[q.key] = v;
      else if (q.required) needs.push({ key: q.key, label: q.label, options: q.options, why: a?.need_human_reason || 'no valid answer' });
    }
  }
  return { answers, needs, resume: resume.path };
}
