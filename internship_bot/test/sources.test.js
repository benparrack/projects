import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_NO_WARNINGS = '1';
const { normUrl, parseTable, parseSimplify } = await import('../src/sources.js');
const { skipReason } = await import('../src/filter.js');

test('same posting from two repos dedupes', () => {
  assert.equal(normUrl('https://job-boards.greenhouse.io/x/jobs/1?utm_source=Simplify&ref=Simplify'),
    normUrl('https://job-boards.greenhouse.io/x/jobs/1/'));
  assert.equal(normUrl('https://www.amazon.jobs/jobs/105/apply'), normUrl('https://www.amazon.jobs/jobs/105'));
});

test('parses speedyapply-style html table', () => {
  const md = `| Company | Position | Location | Salary | Posting | Age |
|---|---|---|---|---|---|
| <a href="https://d.com"><strong>DoorDash</strong></a> | Software Engineer - Intern | San Francisco, CA | $55/hr | <a href="https://job-boards.greenhouse.io/d/jobs/8"><img alt="Apply"/></a> | 3d |
| <a href="https://d.com"><strong>DoorDash</strong></a> | Product Designer | NYC | - | <a href="https://x.io/9">x</a> | 1d |`;
  const [j, ...rest] = parseTable(md, 't');
  assert.equal(rest.length, 0);
  assert.equal(j.company, 'DoorDash');
  assert.equal(j.url, 'https://job-boards.greenhouse.io/d/jobs/8');
  assert.deepEqual(j.locations, ['San Francisco, CA']);
});

test('simplify keeps only active summer 2027', () => {
  const base = { active: true, company_name: 'A', title: 'SWE Intern', url: 'https://a.com/1', locations: ['Austin, TX'], date_posted: 1 };
  const got = parseSimplify(JSON.stringify([{ ...base, terms: ['Summer 2027'] }, { ...base, url: 'https://a.com/2', terms: ['Fall 2026'] }, { ...base, url: 'https://a.com/3', active: false, terms: ['Summer 2027'] }]));
  assert.equal(got.length, 1);
});

test('filter', () => {
  const j = o => ({ title: 'Software Engineer Intern', degrees: [], locations: ['Austin, TX'], ...o });
  assert.equal(skipReason(j()), null);
  assert.equal(skipReason(j({ locations: ['Remote in USA'] })), null);
  assert.equal(skipReason(j({ locations: ['Toronto, ON, Canada'] })), 'not in the US');
  assert.equal(skipReason(j({ title: 'PhD Research Intern' })), 'grad-only title');
  assert.equal(skipReason(j({ degrees: ["Master's", 'PhD'] })), 'no bachelor eligibility');
  assert.equal(skipReason(j({ title: 'SWE Intern - Fall 2027' })), 'not a summer term');
});

test('graduate co-ops are skipped, undergraduate ones are not', () => {
  const j = t => ({ title: t, degrees: [], locations: ['Boston, MA'] });
  assert.equal(skipReason(j('Embedded Software Engineer Graduate Co-op')), 'grad-only title');
  assert.equal(skipReason(j('Undergraduate Research Intern')), null);
});
