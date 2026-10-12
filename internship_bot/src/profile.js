// Ben's facts, essays, learned answers and resumes, re-read on every run so edits apply immediately.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

const P = f => new URL(`../profile/${f}`, import.meta.url).pathname;

export function loadProfile() {
  return {
    facts: YAML.parse(readFileSync(P('profile.yaml'), 'utf8')),
    stories: readFileSync(P('stories.md'), 'utf8'),
    bank: YAML.parse(readFileSync(P('answers.yaml'), 'utf8')) || [],
  };
}

// Embedded/automation roles get the hardware-first resume.
export function resumeFor(job) {
  const emb = /embedded|firmware|hardware|electrical|controls?\b|plc|automation|robotics|mechatronic/i.test(`${job.title} ${job.category || ''}`);
  const path = P(emb ? 'resume-emb.pdf' : 'resume-swe.pdf');
  return { path, text: execFileSync('pdftotext', ['-layout', path, '-']).toString() };
}

export const filePath = name => (existsSync(P(name)) ? P(name) : null);

export const normQ = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Called when Ben answers a queued question: saved once, reused forever.
export function learn(question, answer) {
  const bank = loadProfile().bank.filter(b => normQ(b.q) !== normQ(question));
  bank.push({ q: question, a: answer });
  writeFileSync(P('answers.yaml'), '# Learned answers: edit or delete freely.\n' + YAML.stringify(bank));
}
