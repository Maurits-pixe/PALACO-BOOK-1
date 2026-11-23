import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCiStepOrder, REQUIRED_STEPS } from '../scripts/check-ci-step-order.mjs';

const approved = readFileSync('.github/workflows/ci.yml', 'utf8');

test('accepts the current reviewed CI verification sequence', () => {
  assert.equal(REQUIRED_STEPS.length, 19);
  assert.deepEqual(checkCiStepOrder(approved), []);
});

test('rejects reordered or missing required verification gates', () => {
  const reordered = approved.replace(
    '      - name: Typecheck\n        run: npm run typecheck\n      - name: Unit and integration tests\n        run: npm test',
    '      - name: Unit and integration tests\n        run: npm test\n      - name: Typecheck\n        run: npm run typecheck',
  );
  assert.ok(checkCiStepOrder(reordered).some((e) => e.includes('reordered')));
  const missing = approved.replace('      - name: Build\n        run: npm run build\n', '');
  assert.ok(checkCiStepOrder(missing).some((e) => e.includes('missing')));
});

test('rejects renamed gate masking an altered run command', () => {
  const altered = approved.replace('run: npm ci', 'run: npm install --ignore-scripts');
  assert.ok(checkCiStepOrder(altered).some((e) => e.includes('commands')));
  const audit = approved.replace('npm audit --json --audit-level=low', 'npm audit --json --audit-level=critical');
  assert.ok(checkCiStepOrder(audit).some((e) => e.includes('vulnerability scan')));
});

test('rejects extra jobs and unnamed shell commands', () => {
  const extraJob = approved + '\n  unauthorized:\n    runs-on: ubuntu-24.04\n';
  assert.ok(checkCiStepOrder(extraJob).some((e) => e.includes('one verify job')));
  const unnamed = approved.replace('      - name: Typecheck', '      - run: echo bypass\n      - name: Typecheck');
  assert.ok(checkCiStepOrder(unnamed).some((e) => e.includes('Unnamed')));
  assert.ok(checkCiStepOrder('').length);
});
