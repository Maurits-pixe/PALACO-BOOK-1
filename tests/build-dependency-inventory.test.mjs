import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyInventory } from '../scripts/build-dependency-inventory.mjs';

const sha = 'a'.repeat(40);
const digest = 'sha512-' + Buffer.alloc(64).toString('base64');
const root = { name: 'inventory-fixture', version: '1.0.0', dependencies: { alpha: '^1.0.0' } };
const tarball = (name, version) => ({
  version, integrity: digest,
  resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
});
function fixture() {
  return Buffer.from(JSON.stringify({
    name: root.name, version: root.version, lockfileVersion: 3,
    packages: {
      '': { ...root },
      'node_modules/alpha': tarball('alpha', '1.1.0'),
      'node_modules/beta': tarball('beta', '2.0.0'),
      'node_modules/alpha/node_modules/beta': tarball('beta', '1.0.0'),
    },
  }) + '\n');
}

test('produces ordered inventory and identifies divergent transitive versions', () => {
  const result = buildDependencyInventory(root, fixture(), sha);
  assert.equal(result.schema, 'palaco.dependency-inventory.v1');
  assert.equal(result.package_locations, 3);
  assert.equal(result.unique_package_names, 2);
  assert.deepEqual(result.multiple_version_packages, [{ name: 'beta', versions: ['1.0.0', '2.0.0'] }]);
  assert.equal(result.packages.find(x => x.name === 'alpha').direct, true);
  assert.equal(result.release_authorization, 'DENY');
});

test('inventory hash binds to exact source bytes without changing package counts', () => {
  const a = buildDependencyInventory(root, fixture(), sha);
  const b = buildDependencyInventory(root, Buffer.from(fixture().toString().replace('  ', ' ')), sha);
  assert.equal(a.lockfile_sha256, b.lockfile_sha256);
  assert.match(a.lockfile_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(a.git_checkout_sha, 'b'.repeat(40));
});

test('rejects missing checkout identity and invalid npm graph', () => {
  assert.throws(() => buildDependencyInventory(root, fixture(), 'short'));
  assert.throws(() => buildDependencyInventory(root, Buffer.from('{}'), sha));
  assert.throws(() => buildDependencyInventory(root, null, sha));
});
