import test from 'node:test';
import assert from 'node:assert/strict';
import { planTestFiles, validateTestDirectory, validateTestFileTypes, validateTrackedTestInventory, TEST_TIMEOUT_MS } from '../scripts/run-tests-bounded.mjs';

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

test('refuses symlink or directory entries impersonating mandatory test files', () => {
  const planned = planTestFiles(['ok.test.mjs', 'ok.test.ts']);
  const regular = { isFile: () => true, isSymbolicLink: () => false };
  assert.doesNotThrow(() => validateTestFileTypes(planned, () => regular));
  assert.throws(() => validateTestFileTypes(planned, (name) =>
    name.endsWith('.test.ts')
      ? { isFile: () => false, isSymbolicLink: () => true }
      : regular), /not a regular file/);
  assert.throws(() => validateTestFileTypes(planned, () =>
    ({ isFile: () => false, isSymbolicLink: () => false })), /not a regular file/);
  assert.throws(() => validateTestFileTypes(planned, () => null), /not a regular file/);
});

test('refuses symlinked or non-directory test roots', () => {
  const dir = { isDirectory: () => true, isSymbolicLink: () => false };
  assert.doesNotThrow(() => validateTestDirectory(dir));
  assert.throws(() => validateTestDirectory({
    isDirectory: () => true, isSymbolicLink: () => true,
  }), /not a regular directory/);
  assert.throws(() => validateTestDirectory({
    isDirectory: () => false, isSymbolicLink: () => false,
  }), /not a regular directory/);
  assert.throws(() => validateTestDirectory(null), /not a regular directory/);
});

test('Git index test inventory must exactly match filesystem discovery', () => {
  const planned = planTestFiles(['alpha.test.mjs', 'beta.test.ts']);
  const tracked = ['tests/beta.test.ts', 'README.md', 'tests/alpha.test.mjs'];
  assert.doesNotThrow(() => validateTrackedTestInventory(planned, tracked));
  assert.doesNotThrow(() => validateTrackedTestInventory(planned, tracked.slice().reverse()));
  assert.throws(() => validateTrackedTestInventory(planned, ['tests/alpha.test.mjs']),
    /differ from tracked/);
  assert.throws(() => validateTrackedTestInventory(planned,
    [...tracked, 'tests/extra.test.mjs']), /differ from tracked/);
  assert.throws(() => validateTrackedTestInventory(planned,
    ['tests/alpha.test.mjs', 'tests/alpha.test.mjs', 'tests/beta.test.ts']),
    /differ from tracked/);
  assert.throws(() => validateTrackedTestInventory(planned, null),
    /inventory is unavailable/);
  assert.throws(() => validateTrackedTestInventory(planned, ['tests/alpha.test.mjs', null]),
    /inventory is unavailable/);
  assert.throws(() => validateTrackedTestInventory(planned, []),
    /differ from tracked/);
});
