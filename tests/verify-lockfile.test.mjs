import test from 'node:test';
import assert from 'node:assert/strict';
import { hasValidIntegrity, validateLockfile } from '../scripts/verify-lockfile.mjs';

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
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
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

test('rejects missing direct package despite matching root declarations', () => {
  const lock = validLock();
  delete lock.packages['node_modules/alpha'];
  assert.ok(validateLockfile(manifest, lock).some((e) => e.includes('Missing direct package')));
});

test('enforces checksum length and canonical encoding', () => {
  assert.equal(hasValidIntegrity(`sha512-${Buffer.alloc(64).toString('base64')}`), true);
  assert.equal(hasValidIntegrity(`sha384-${Buffer.alloc(48).toString('base64')}`), true);
  assert.equal(hasValidIntegrity('sha512-AA=='), false);
  assert.equal(hasValidIntegrity('sha256-' + Buffer.alloc(32).toString('base64')), false);
  assert.equal(hasValidIntegrity('sha512-not*base64'), false);
});

test('accepts a matching pinned PostCSS override in the lockfile', () => {
  const lock = validLock();
  lock.packages['node_modules/postcss'] = {
    version: '8.5.33',
    resolved: 'https://registry.npmjs.org/postcss/-/postcss-8.5.33.tgz',
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
  };
  assert.deepEqual(validateLockfile({ ...manifest, overrides: { postcss: '8.5.33' } }, lock), []);
});

test('rejects absent and mismatched pinned override packages, including nested copies', () => {
  const overrideManifest = { ...manifest, overrides: { postcss: '8.5.33' } };
  assert.ok(validateLockfile(overrideManifest, validLock()).some((error) => error.includes('Unresolved override')));
  const lock = validLock();
  lock.packages['node_modules/postcss'] = {
    version: '8.4.31',
    resolved: 'https://registry.npmjs.org/postcss/-/postcss-8.4.31.tgz',
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
  };
  lock.packages['node_modules/alpha/node_modules/postcss'] = {
    version: '8.5.33',
    resolved: 'https://registry.npmjs.org/postcss/-/postcss-8.5.33.tgz',
    integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
  };
  const errors = validateLockfile(overrideManifest, lock);
  assert.ok(errors.some((error) => error.includes('Override version mismatch')));
});
