import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyInventory } from '../scripts/build-dependency-inventory.mjs';
import { verifyInventoryEvidence } from '../scripts/verify-dependency-inventory.mjs';

const sha = 'a'.repeat(40);
const integrity = 'sha512-' + Buffer.alloc(64).toString('base64');
const manifest = { name: 'inventory-verification', version: '1.0.0', dependencies: { alpha: '^1.0.0' } };
const bytes = Buffer.from(JSON.stringify({
  name: manifest.name, version: manifest.version, lockfileVersion: 3,
  packages: {
    '': { ...manifest },
    'node_modules/alpha': {
      version: '1.2.0',
      resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.2.0.tgz',
      integrity,
    },
  },
}) + '\n');
function fixtures() {
  const inventory = buildDependencyInventory(manifest, bytes, sha);
  const audit = {
    schema: 'palaco.npm-audit-summary.v1',
    status: 'NO_FINDINGS',
    counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    affected_packages: [],
    package_detail_status: 'AVAILABLE',
    provenance: { git_commit_sha: sha, lockfile_sha256: inventory.lockfile_sha256 },
    release_authorization: 'DENY',
  };
  return { inventory, audit };
}

test('validates exact inventory and audit for same Git commit and lockfile', () => {
  const { inventory, audit } = fixtures();
  assert.deepEqual(verifyInventoryEvidence(manifest, bytes, sha, inventory, audit), []);
});

test('rejects altered inventory names, versions, counts, or unexplained metadata', () => {
  const { inventory, audit } = fixtures();
  inventory.package_locations = 99;
  inventory.packages[0].version = '2.0.0';
  inventory.approved = true;
  assert.ok(verifyInventoryEvidence(manifest, bytes, sha, inventory, audit)
    .some((error) => error.includes('reconstruction')));
});

test('rejects audit with a different commit or lockfile', () => {
  const { inventory, audit } = fixtures();
  audit.provenance.git_commit_sha = 'b'.repeat(40);
  audit.provenance.lockfile_sha256 = '0'.repeat(64);
  const errors = verifyInventoryEvidence(manifest, bytes, sha, inventory, audit);
  assert.ok(errors.some((error) => error.includes('different Git commits')));
  assert.ok(errors.some((error) => error.includes('different lockfiles')));
});

test('fails closed on invalid lockfile and missing audit', () => {
  const { inventory } = fixtures();
  assert.ok(verifyInventoryEvidence(manifest, Buffer.from('{}'), sha, inventory, null).length);
  assert.ok(verifyInventoryEvidence(manifest, bytes, sha, inventory, null).length);
});
