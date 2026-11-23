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

test('rejects audit shell injection while retaining all expected commands', () => {
  const injected = approved.replace(
    '          set -e\n',
    '          echo "bypass audit"\n          set -e\n',
  );
  assert.ok(checkCiStepOrder(injected).some((error) =>
    error.includes('shell body')));
});

test('rejects reordered scanner exit handling and missing raw evidence cleanup', () => {
  const reorder = approved.replace(
    '          audit_exit=$?\n          set -e\n',
    '          set -e\n          audit_exit=$?\n',
  );
  assert.ok(checkCiStepOrder(reorder).some((error) =>
    error.includes('shell body')));
  const missingTrap = approved.replace(
    "          trap 'rm -f npm-audit.raw.json' EXIT\n", '',
  );
  assert.ok(checkCiStepOrder(missingTrap).some((error) =>
    error.includes('shell body')));
});

test('rejects different audit shell, not just missing command fragments', () => {
  const alternateShell = approved.replace(
    '        shell: bash\n        run: |\n',
    '        shell: sh\n        run: |\n',
  );
  assert.ok(checkCiStepOrder(alternateShell).some((error) =>
    error.includes('shell body')));
});
