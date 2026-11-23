import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCiActionPins, APPROVED_ACTIONS } from '../scripts/check-ci-action-pins.mjs';

const checkout = APPROVED_ACTIONS['actions/checkout'];
const setup = APPROVED_ACTIONS['actions/setup-node'];
const upload = APPROVED_ACTIONS['actions/upload-artifact'];
const good = `name: CI
permissions:
  contents: read
jobs:
  verify:
    steps:
      - uses: actions/checkout@${checkout} # approved
        with:
          persist-credentials: false
      - uses: actions/setup-node@${setup} # approved
        with:
          node-version: 22
      - name: Upload inventory
        uses: actions/upload-artifact@${upload} # approved
      - name: Upload audit
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
  assert.ok(checkCiActionPins(good.replace(`      - name: Upload audit
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
