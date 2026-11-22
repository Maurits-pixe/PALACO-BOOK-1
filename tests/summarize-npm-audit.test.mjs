import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAudit } from '../scripts/summarize-npm-audit.mjs';

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
