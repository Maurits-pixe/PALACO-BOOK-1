import test from 'node:test';
import assert from 'node:assert/strict';
import { planTestFiles, TEST_TIMEOUT_MS } from '../scripts/run-tests-bounded.mjs';

test('discovers every JS and TS test file, sorted without filtering permitted suites', () => {
  const files = planTestFiles(['z.test.ts', 'README.md', 'b.test.mjs', 'a.test.mjs']);
  assert.deepEqual(files.map((item) => item.name), ['a.test.mjs', 'b.test.mjs', 'z.test.ts']);
  assert.deepEqual(files[0].args, ['--test', 'tests/a.test.mjs']);
  assert.deepEqual(files[2].args, ['--import', 'tsx', '--test', 'tests/z.test.ts']);
});

test('refuses missing language suites and does not treat arbitrary files as tests', () => {
  assert.throws(() => planTestFiles(['only.test.mjs']), /Both JS and TS/);
  assert.throws(() => planTestFiles(['only.test.ts']), /Both JS and TS/);
  assert.throws(() => planTestFiles(['ignore.ts', 'foo.test.mjs.bak']), /Both JS and TS/);
});

test('test execution remains explicitly bounded', () => {
  assert.ok(TEST_TIMEOUT_MS > 0);
  assert.ok(TEST_TIMEOUT_MS <= 120_000);
});
