import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCiActionPins } from '../scripts/check-ci-action-pins.mjs';

const sha = 'a'.repeat(40);
const good = `name: CI
permissions:
  contents: read
jobs:
  verify:
    steps:
      - uses: actions/checkout@${sha}
        with:
          persist-credentials: false
      - uses: actions/setup-node@${sha}
        with:
          node-version: 22
`;

test('accepts pinned Actions with read-only permissions and no saved checkout token', () => {
  assert.deepEqual(checkCiActionPins(good), []);
});
test('rejects mutable tags and dynamic action references', () => {
  assert.ok(checkCiActionPins(good.replace(`setup-node@${sha}`, 'setup-node@v4')).length);
  assert.ok(checkCiActionPins(good.replace(`setup-node@${sha}`, 'setup-node@${{ inputs.ref }}')).length);
});
test('requires checkout credentials not be persisted', () => {
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false','persist-credentials: true')).length);
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false','')).length);
});
test('requires read-only permissions and action declarations', () => {
  assert.ok(checkCiActionPins(good.replace('contents: read','contents: write')).length);
  assert.ok(checkCiActionPins('name: CI\npermissions:\n  contents: read\n').length);
  assert.ok(checkCiActionPins(null).length);
});
