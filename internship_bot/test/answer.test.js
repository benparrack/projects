import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerAll, matchOption } from '../src/answer.js';

const job = { company: 'Acme', title: 'Software Engineering Intern' };
const fakeLLM = canned => async (_s, prompt) => {
  fakeLLM.lastPrompt = prompt;
  return { answers: canned };
};

test('matchOption', () => {
  assert.equal(matchOption(['Yes', 'No'], 'yes'), 'Yes');
  assert.equal(matchOption(['3.7 or Higher', '3.5 - 3.6'], '3.5 - 3.6'), '3.5 - 3.6');
  assert.equal(matchOption(['Yes', 'No'], 'Maybe'), null);
});

test('standard fields and EEO never hit the LLM', async () => {
  const qs = [
    { key: 'first_name', label: 'First Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'text', required: true },
    { key: 'resume', label: 'Resume/CV', type: 'file', required: true },
    { key: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Decline To Self Identify'] },
    { key: 'veteran_status', label: 'VeteranStatus', type: 'select', options: ["I don't wish to answer", 'I identify as one or more of the classifications of a protected veteran', 'I am not a protected veteran'] },
  ];
  const r = await answerAll(qs, job, { llm: () => assert.fail('LLM should not be called') });
  assert.equal(r.answers.first_name, 'Ben');
  assert.equal(r.answers.gender, 'Male');
  assert.equal(r.answers.veteran_status, 'I am not a protected veteran');
  assert.match(r.answers.resume, /resume-swe\.pdf$/);
  assert.deepEqual(r.needs, []);
});

test('embedded roles get the embedded resume', async () => {
  const r = await answerAll([{ key: 'resume', label: 'Resume', type: 'file', required: true }],
    { company: 'X', title: 'Firmware Intern' }, { llm: () => assert.fail() });
  assert.match(r.answers.resume, /resume-emb\.pdf$/);
});

test('null or off-list LLM answers on required questions escalate; optional ones are dropped', async () => {
  const qs = [
    { key: 'q1', label: 'Who referred you?', type: 'text', required: true },
    { key: 'q2', label: 'GPA?', type: 'select', options: ['3.7 or Higher', '3.5 - 3.6'], required: true },
    { key: 'q3', label: 'Favorite color?', type: 'text', required: false },
    { key: 'q4', label: 'Authorized to work?', type: 'select', options: ['Yes', 'No'], required: true },
  ];
  const r = await answerAll(qs, job, { llm: fakeLLM([
    { key: 'q1', answer: null, need_human_reason: 'no referral in profile' },
    { key: 'q2', answer: '3.5 - 3.6' },
    { key: 'q3', answer: null, need_human_reason: 'optional' },
    { key: 'q4', answer: 'Definitely' },
  ]) });
  assert.equal(r.answers.q2, '3.5 - 3.6');
  assert.deepEqual(r.needs.map(n => n.key), ['q1', 'q4']);
  assert.match(fakeLLM.lastPrompt, /Virginia Tech/);
});

test('missing required file escalates', async () => {
  const r = await answerAll([{ key: 'question_9', label: 'Upload your portfolio', type: 'file', required: true }], job, { llm: () => assert.fail() });
  assert.equal(r.needs[0].key, 'question_9');
});

test('no-AI certifications are never answered, even from the answer bank', async () => {
  const label = 'By agreeing below, I certify that I personally completed this application and that it was not filled out, in whole or in part, by another person or by an artificial intelligence (AI) tool on my behalf.';
  const r = await answerAll([{ key: 'q', label, type: 'select', options: ['Yes'], required: true }], job, { llm: () => assert.fail() });
  assert.match(r.manual, /certify no AI/);
  const ok = await answerAll([{ key: 'q', label: 'I certify the information provided is true and complete.', type: 'select', options: ['Yes'], required: true }], job, { llm: fakeLLM([{ key: 'q', answer: 'Yes' }]) });
  assert.equal(ok.manual, undefined);
});

test('queue: "12 answer" is learned, "skip 12" drops', async () => {
  process.env.NO_NOTIFY = '1';
  const { db } = await import('../src/db.js');
  const { enqueue, handleReply } = await import('../src/queue.js');
  const label = 'Test-only question ' + Date.now();
  await enqueue({ company: 'T', url: 'https://x' }, [{ label, options: [] }]);
  const q = db.prepare('SELECT * FROM questions WHERE label=?').get(label);
  assert.equal(handleReply('hello'), null);
  assert.equal(handleReply(`skip ${q.id}`), q.id);
  assert.equal(db.prepare('SELECT status FROM questions WHERE id=?').get(q.id).status, 'skipped');
  db.prepare('DELETE FROM questions WHERE id=?').run(q.id);
});
