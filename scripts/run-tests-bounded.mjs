#!/usr/bin/env node
// Fail closed and identify the exact test file that stalls CI.
// All .test.mjs and .test.ts files are mandatory; no retries or skips.
import { readdirSync, lstatSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEST_TIMEOUT_MS = 90_000;

// Include the test runner and npm test entrypoint in the immutable scope.
export const TEST_INTEGRITY_PATHS = Object.freeze([
  'tests',
  'scripts/run-tests-bounded.mjs',
  'package.json',
]);

export function planTestFiles(filenames) {
  const names = filenames
    .filter((name) => /\.test\.(?:mjs|ts)$/.test(name))
    .sort();
  if (!names.some((name) => name.endsWith('.test.mjs')) ||
      !names.some((name) => name.endsWith('.test.ts'))) {
    throw new Error('Both JS and TS test suites must be present');
  }
  return names.map((name) => ({
    name,
    args: name.endsWith('.test.ts')
      ? ['--import', 'tsx', '--test', 'tests/' + name]
      : ['--test', 'tests/' + name],
  }));
}

// Only Git-indexed test files may run. The index and disk must agree
// exactly, preventing untracked injections and silently missing tracked tests.
export function validateTrackedTestInventory(planned, trackedPaths) {
  if (!Array.isArray(trackedPaths) ||
      trackedPaths.some((path) => typeof path !== 'string')) {
    throw new Error('Tracked test inventory is unavailable');
  }
  // Recursive test files are outside the approved flat-suite layout.
  // Refuse them instead of silently excluding them from execution.
  const nested = trackedPaths.filter((path) =>
    path.startsWith('tests/') &&
    path.slice('tests/'.length).includes('/') &&
    (path.endsWith('.test.mjs') || path.endsWith('.test.ts')));
  if (nested.length > 0) {
    throw new Error('Nested tracked test files are not approved');
  }
  const expected = trackedPaths
    .filter((path) => /^tests\/[^/]+\.test\.(?:mjs|ts)$/.test(path))
    .map((path) => path.slice('tests/'.length))
    .sort();
  const actual = planned.map(({ name }) => name).sort();
  if (expected.length === 0 ||
      JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Test files differ from tracked Git inventory');
  }
}

// Never follow symbolic links or execute directories masquerading as test files.
// The callback makes this rule independently testable without changing the runner.
export function validateTestFileTypes(planned, inspect) {
  for (const { name } of planned) {
    const metadata = inspect(name);
    if (!metadata || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Test entry is not a regular file: ' + name);
    }
  }
}

// The tests directory itself must not redirect discovery through a symlink.
export function validateTestDirectory(metadata) {
  if (!metadata || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Tests root is not a regular directory');
  }
}

// Compare working test sources with the checked-out commit, including staged
// and unstaged edits. Status 1 (drift) and Git failures both fail closed.
export function verifyCleanTestSources(result) {
  if (!result || result.error || result.signal || result.status !== 0) {
    throw new Error('Tracked test sources differ from checkout HEAD or Git check failed');
  }
}

function checkTestSourceIntegrity() {
  verifyCleanTestSources(spawnSync('git',
    ['diff', 'HEAD', '--quiet', '--', ...TEST_INTEGRITY_PATHS], {
      cwd: process.cwd(),
      stdio: 'ignore',
      timeout: 5000,
      killSignal: 'SIGKILL',
    }));
}

export function main() {
  let planned;
  try {
    validateTestDirectory(lstatSync(resolve('tests')));
    planned = planTestFiles(readdirSync(resolve('tests')));
    const trackedOutput = execFileSync('git',
      ['ls-files', '--cached', '-z', '--', 'tests'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    validateTrackedTestInventory(planned, trackedOutput.split('\0').filter(Boolean));
    validateTestFileTypes(planned, (name) => lstatSync(resolve('tests', name)));
    checkTestSourceIntegrity();
  } catch (error) {
    console.error('Test discovery FAILED:', error.message);
    return 2;
  }
  console.log('Required test files:', planned.length);
  for (const { name, args } of planned) {
    try {
      checkTestSourceIntegrity();
    } catch (error) {
      console.error('Test integrity FAILED before execution:', error.message);
      return 1;
    }
    console.log('RUN TEST FILE:', name);
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      timeout: TEST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (result.error || result.signal || result.status !== 0) {
      console.error('TEST FILE FAILED:', name,
        'status=' + String(result.status),
        'signal=' + String(result.signal),
        'error=' + (result.error?.code ?? 'none'));
      return 1;
    }
    try {
      checkTestSourceIntegrity();
    } catch (error) {
      console.error('Test integrity FAILED after execution:', name, error.message);
      return 1;
    }
    console.log('PASS TEST FILE:', name);
  }
  console.log('All required JS and TS test files PASS:', planned.length);
  return 0;
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
