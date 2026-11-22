import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAudit, auditGateExitCode, extractAffectedPackages } from '../scripts/summarize-npm-audit.mjs';

const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
function report(override = {}) {
  return { metadata: { vulnerabilities: { ...counts, ...override } } };
}

test('reports a completed clean audit without granting release', () => {
  assert.equal(summarizeAudit(report(), 0).status, 'NO_FINDINGS');
});
test('records vulnerability findings for human review', () => {
  const result = summarizeAudit(report({ moderate: 2, critical: 1, total: 3 }), 1);
  assert.equal(result.status, 'FINDINGS');
  assert.equal(result.counts.critical, 1);
});
test('fails closed on scanner errors and incomplete output', () => {
  assert.equal(summarizeAudit({ error: { code: 'ENOAUDIT' } }, 1).status, 'ERROR');
  assert.equal(summarizeAudit({}, 1).status, 'ERROR');
  assert.equal(summarizeAudit(null, 1).status, 'ERROR');
});
test('rejects inconsistent totals and exit status', () => {
  assert.equal(summarizeAudit(report({ high: 1, total: 0 }), 1).status, 'ERROR');
  assert.equal(summarizeAudit(report({ low: 1, total: 1 }), 0).status, 'ERROR');
  assert.equal(summarizeAudit(report(), 1).status, 'ERROR');
});

test('blocks high and critical audit findings without treating moderate as clear', () => {
  const moderate = summarizeAudit(report({ moderate: 1, total: 1 }), 1);
  const high = summarizeAudit(report({ high: 1, total: 1 }), 1);
  const critical = summarizeAudit(report({ critical: 1, total: 1 }), 1);
  assert.equal(moderate.status, 'FINDINGS');
  assert.equal(auditGateExitCode(moderate), 0);
  assert.equal(auditGateExitCode(high), 1);
  assert.equal(auditGateExitCode(critical), 1);
  assert.equal(auditGateExitCode(summarizeAudit(report(), 0)), 0);
});

test('scanner error fails closed with dedicated exit code', () => {
  assert.equal(auditGateExitCode(summarizeAudit({}, 1)), 2);
});

test('sanitizes affected package inventory without exposing raw advisory text', () => {
  const input = { vulnerabilities: {
    '@scope/sample': { severity: 'high', isDirect: true, fixAvailable: { name: 'sample', version: '2.0.0' }, via: [{ title: 'untrusted raw advisory' }] },
    'alpha': { severity: 'moderate', isDirect: false, fixAvailable: false },
  } };
  const details = extractAffectedPackages(input);
  assert.equal(details.detail_status, 'AVAILABLE');
  assert.deepEqual(details.packages.map((p) => p.package), ['@scope/sample', 'alpha']);
  assert.equal(details.packages[0].fix_available, 'YES');
  assert.doesNotMatch(JSON.stringify(details), /untrusted raw advisory/);
});

test('invalid package metadata fails closed rather than copying arbitrary content', () => {
  assert.equal(extractAffectedPackages({ vulnerabilities: {
    '../sensitive': { severity: 'high' },
  } }).detail_status, 'INVALID');
  assert.equal(extractAffectedPackages({}).detail_status, 'UNAVAILABLE');
});
