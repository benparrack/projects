import { test } from 'node:test';
import assert from 'node:assert/strict';

test('off-cycle co-ops are caught from the posting text', async () => {
  const { offCycle } = await import('../src/filter.js');
  assert.ok(offCycle('<p>a Software Engineer Co-op for 2027 Spring Semester</p>'));
  assert.ok(offCycle('for the spring co-op cycle, for at least 6 months from January through June 2027'));
  assert.ok(offCycle('header_text":"MORSE Corp Spring 2027 Co-op Opportunities'));
  assert.ok(offCycle('Co-op, Hardware Development Engineer (Jan - July 2027)'));
  assert.equal(offCycle('Spring or Summer 2027 internship'), null);
  assert.equal(offCycle('12-week internship'), null);
});
