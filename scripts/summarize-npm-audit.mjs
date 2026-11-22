#!/usr/bin/env node
// Summarize npm audit results without publishing detailed advisory payloads.
// High/Critical findings block CI; all results remain evidence, not release authorization.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];

export function summarizeAudit(input, exitCode) {
  const statusCode = Number(exitCode);
  if (!Number.isInteger(statusCode) || statusCode < 0) {
    return { status: 'ERROR', reason: 'Invalid scanner exit status', counts: null };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.error || !input.metadata?.vulnerabilities ||
      typeof input.metadata.vulnerabilities !== 'object') {
    return { status: 'ERROR', reason: 'Audit result is incomplete or contains an error', counts: null };
  }
  const counts = {};
  for (const level of LEVELS) {
    const value = input.metadata.vulnerabilities[level];
    if (!Number.isSafeInteger(value) || value < 0) {
      return { status: 'ERROR', reason: `Invalid vulnerability count: ${level}`, counts: null };
    }
    counts[level] = value;
  }
  const total = LEVELS.reduce((sum, level) => sum + counts[level], 0);
  const expected = input.metadata.vulnerabilities.total;
  if (!Number.isSafeInteger(expected) || expected !== total) {
    return { status: 'ERROR', reason: 'Vulnerability totals are inconsistent', counts: null };
  }
  const findings = total > 0;
  if ((statusCode === 0 && findings) || (statusCode !== 0 && !findings)) {
    return { status: 'ERROR', reason: 'Scanner exit status inconsistent with findings', counts: null };
  }
  return {
    status: findings ? 'FINDINGS' : 'NO_FINDINGS',
    reason: findings ? 'Review required; authorization remains HOLD' : 'No reported findings in this scan; not a guarantee of safety',
    counts: { ...counts, total },
  };
}

export function auditGateExitCode(result) {
  if (result.status === 'ERROR') return 2;
  if (result.status === 'FINDINGS' && result.counts &&
      (result.counts.high > 0 || result.counts.critical > 0)) return 1;
  return 0;
}

export function main() {
  const exitCode = process.argv[2];
  let result;
  try {
    const raw = JSON.parse(readFileSync(resolve('npm-audit.raw.json'), 'utf8'));
    result = summarizeAudit(raw, exitCode);
  } catch {
    result = { status: 'ERROR', reason: 'Could not parse scanner output', counts: null };
  }
  const summary = {
    schema: 'palaco.npm-audit-summary.v1',
    status: result.status,
    reason: result.reason,
    counts: result.counts,
    release_authorization: 'DENY',
  };
  writeFileSync(resolve('npm-audit-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`npm audit evidence status: ${result.status}; production authorization DENY`);
  if (result.counts) console.log(`Findings by severity: ${JSON.stringify(result.counts)}`);
  return auditGateExitCode(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
