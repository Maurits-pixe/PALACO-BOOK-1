import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyAuditEvidence } from '../scripts/verify-audit-evidence.mjs';

const sha = 'a'.repeat(40);
const lock = Buffer.from('{"lockfileVersion":3}\n');
function clean() {
  return {
    schema: 'palaco.npm-audit-summary.v1',
    status: 'NO_FINDINGS',
    counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
    affected_packages: [],
    package_detail_status: 'AVAILABLE',
    provenance: { git_commit_sha: sha, lockfile_sha256: createHash('sha256').update(lock).digest('hex') },
    release_authorization: 'DENY',
  };
}

test('accepts a complete clean report tied to exact checkout and lockfile', () => {
  assert.deepEqual(verifyAuditEvidence(clean(), lock, sha), []);
});
test('rejects changed lockfile bytes or wrong Git checkout', () => {
  assert.ok(verifyAuditEvidence(clean(), Buffer.from('different'), sha).some((s) => s.includes('digest')));
  assert.ok(verifyAuditEvidence(clean(), lock, 'b'.repeat(40)).some((s) => s.includes('Git HEAD')));
});
test('rejects report with findings, missing counts or modified authorization', () => {
  const findings = clean();
  findings.status = 'FINDINGS';
  findings.counts.moderate = 1;
  assert.ok(verifyAuditEvidence(findings, lock, sha).length >= 2);
  const missing = clean();
  delete missing.counts.low;
  missing.release_authorization = 'ALLOW';
  assert.ok(verifyAuditEvidence(missing, lock, sha).length >= 2);
});
test('rejects incomplete package evidence and invalid provenance', () => {
  const empty = clean();
  empty.package_detail_status = 'UNAVAILABLE';
  empty.affected_packages = [{ package: 'unsafe' }];
  assert.ok(verifyAuditEvidence(empty, lock, sha).length >= 2);
  assert.ok(verifyAuditEvidence(null, lock, sha).length > 0);
  assert.ok(verifyAuditEvidence(clean(), null, sha).length > 0);
});
