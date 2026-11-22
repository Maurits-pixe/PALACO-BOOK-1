import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLockfile } from '../scripts/verify-lockfile.mjs';

const manifest = {
  name: 'example', version: '1.0.0',
  dependencies: { alpha: '^1.2.3' },
};
function validLock() {
  return {
    name: 'example', version: '1.0.0', lockfileVersion: 3,
    packages: {
      '': { name: 'example', version: '1.0.0', dependencies: { alpha: '^1.2.3' } },
      'node_modules/alpha': {
        version: '1.2.3', resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.3.tgz',
        integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      },
    },
  };
}

test('accepts structurally consistent registry lockfile', () => {
  assert.deepEqual(validateLockfile(manifest, validLock()), []);
});
test('rejects changed root declarations and package identity', () => {
  const lock = validLock();
  lock.packages[''].dependencies.alpha = '^9.9.9';
  lock.packages[''].name = 'other';
  assert.equal(validateLockfile(manifest, lock).length, 2);
});
test('rejects untrusted source and missing integrity', () => {
  const lock = validLock();
  lock.packages['node_modules/alpha'].resolved = 'http://example.org/archive.tgz';
  delete lock.packages['node_modules/alpha'].integrity;
  assert.equal(validateLockfile(manifest, lock).length, 2);
});
test('rejects linked packages, malformed structure and invalid lock version', () => {
  const lock = validLock();
  lock.lockfileVersion = 2;
  lock.packages['node_modules/alpha'].link = true;
  assert.equal(validateLockfile(manifest, lock).length, 2);
  assert.ok(validateLockfile(manifest, { packages: [] }).length > 0);
});
