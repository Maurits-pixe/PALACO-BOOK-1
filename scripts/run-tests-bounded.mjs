#!/usr/bin/env node
// Fail closed and identify the exact test file that stalls CI.
// All .test.mjs and .test.ts files are mandatory; no retries or skips.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEST_TIMEOUT_MS = 90_000;

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

export function main() {
  let planned;
  try {
    planned = planTestFiles(readdirSync(resolve('tests')));
  } catch (error) {
    console.error('Test discovery FAILED:', error.message);
    return 2;
  }
  console.log('Required test files:', planned.length);
  for (const { name, args } of planned) {
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
    console.log('PASS TEST FILE:', name);
  }
  console.log('All required JS and TS test files PASS:', planned.length);
  return 0;
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
