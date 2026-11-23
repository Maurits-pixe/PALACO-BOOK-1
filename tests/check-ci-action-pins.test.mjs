import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCiActionPins, APPROVED_ACTIONS } from '../scripts/check-ci-action-pins.mjs';

const checkout = APPROVED_ACTIONS['actions/checkout'];
const setup = APPROVED_ACTIONS['actions/setup-node'];
const upload = APPROVED_ACTIONS['actions/upload-artifact'];
const good = `name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@${checkout} # approved
        with:
          persist-credentials: false
      - uses: actions/setup-node@${setup} # approved
        with:
          node-version: 22
      - name: Upload inventory
        uses: actions/upload-artifact@${upload} # approved
      - name: Upload sanitized npm audit summary
        if: always()
        uses: actions/upload-artifact@${upload} # approved
`;

test('accepts exactly approved action SHAs, usage counts and credential policy', () => {
  assert.deepEqual(checkCiActionPins(good), []);
});
test('rejects a mutable tag or arbitrary 40-digit SHA for an approved action', () => {
  assert.ok(checkCiActionPins(good.replace(`setup-node@${setup}`, 'setup-node@v4')).length);
  assert.ok(checkCiActionPins(good.replace(`setup-node@${setup}`, 'setup-node@' + 'a'.repeat(40))).length);
});
test('rejects even pinned Actions from unapproved repositories', () => {
  assert.ok(checkCiActionPins(good.replace(`actions/setup-node@${setup}`, 'thirdparty/setup-node@' + 'a'.repeat(40)))
    .some((error) => error.includes('Unapproved')));
});
test('detects missing, duplicated or replaced mandatory Actions', () => {
  assert.ok(checkCiActionPins(good.replace(`      - name: Upload sanitized npm audit summary
        if: always()
        uses: actions/upload-artifact@${upload} # approved
`, '')).some((error) => error.includes('Expected 2')));
  assert.ok(checkCiActionPins(good + `      - uses: actions/upload-artifact@${upload}\n`)
    .some((error) => error.includes('Expected 2')));
  assert.ok(checkCiActionPins('name: CI\npermissions:\n  contents: read\n').length);
});
test('requires non-persistent checkout credentials and read-only token', () => {
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false', 'persist-credentials: true')).length);
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false', '')).length);
  assert.ok(checkCiActionPins(good.replace('contents: read', 'contents: write')).length);
  assert.ok(checkCiActionPins(null).length);
});

test('blocks privileged workflow triggers and replacement of approved events', () => {
  assert.ok(checkCiActionPins(good.replace('  pull_request:\n', '  pull_request_target:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('  push:\n', '  workflow_dispatch:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('  pull_request:\n', '  pull_request:\n  workflow_run:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('on:\n  push:\n  pull_request:\n', ''))
    .some((error) => error.includes('trigger only')));
});

test('blocks job-level permissions overriding global read-only access', () => {
  const jobOverride = good.replace('  verify:\n', '  verify:\n    permissions:\n      contents: write\n');
  assert.ok(checkCiActionPins(jobOverride)
    .some((error) => error.includes('permissions override')));
  assert.ok(checkCiActionPins(good.replace('  contents: read', '  contents: read\n  id-token: write'))
    .some((error) => error.includes('permissions override')));
});

test('global permissions remain exactly one contents-read entry', () => {
  const withOidc = good.replace('  contents: read', '  contents: read\n  id-token: write');
  assert.ok(checkCiActionPins(withOidc).some((error) =>
    error.includes('permissions override')));
  const withPackages = good.replace('  contents: read', '  contents: read\n  packages: read');
  assert.ok(checkCiActionPins(withPackages).some((error) =>
    error.includes('permissions override')));
  const duplicated = good.replace('jobs:\n', 'permissions:\n  contents: read\njobs:\n');
  assert.ok(checkCiActionPins(duplicated).some((error) =>
    error.includes('permissions override')));
});

test('requires explicit Ubuntu 24.04 instead of mutable or self-hosted runners', () => {
  assert.ok(checkCiActionPins(good.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest'))
    .some((error) => error.includes('ubuntu-24.04 runner')));
  assert.ok(checkCiActionPins(good.replace('runs-on: ubuntu-24.04', 'runs-on: self-hosted'))
    .some((error) => error.includes('ubuntu-24.04 runner')));
  assert.ok(checkCiActionPins(good + '      runs-on: ubuntu-24.04\n')
    .some((error) => error.includes('ubuntu-24.04 runner')));
});

test('requires exactly one bounded 20-minute CI job timeout', () => {
  assert.ok(checkCiActionPins(good.replace('timeout-minutes: 20', 'timeout-minutes: 360'))
    .some((error) => error.includes('20-minute timeout')));
  assert.ok(checkCiActionPins(good.replace('    timeout-minutes: 20\n', ''))
    .some((error) => error.includes('20-minute timeout')));
  assert.ok(checkCiActionPins(good + '      timeout-minutes: 120\n')
    .some((error) => error.includes('20-minute timeout')));
});

test('fails closed on continue-on-error even when set to false', () => {
  for (const value of ['true', 'false', '${{ true }}']) {
    const changed = good.replace('        with:\n          node-version: 22',
      `        continue-on-error: ${value}\n        with:\n          node-version: 22`);
    assert.ok(checkCiActionPins(changed)
      .some((error) => error.includes('continue-on-error')));
  }
});

test('allows unconditional audit artifact upload only, not bypassed checks', () => {
  assert.deepEqual(checkCiActionPins(good), []);
  const bypass = good.replace('        with:\n          node-version: 22',
    '        if: always()\n        with:\n          node-version: 22');
  assert.ok(checkCiActionPins(bypass).some((error) => error.includes('Only audit evidence')));
  const removed = good.replace('        if: always()\n', '');
  assert.ok(checkCiActionPins(removed).some((error) => error.includes('Only audit evidence')));
});
