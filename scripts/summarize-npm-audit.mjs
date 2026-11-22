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

// Export only constrained package identifiers and remediation availability.
// Do not copy advisory descriptions, URLs, proof-of-concept text or raw payloads.
export function extractAffectedPackages(input) {
  if (!input || !input.vulnerabilities || typeof input.vulnerabilities !== 'object' ||
      Array.isArray(input.vulnerabilities)) return { detail_status: 'UNAVAILABLE', packages: [] };
  const entries = Object.entries(input.vulnerabilities);
  if (entries.length > 200) return { detail_status: 'TRUNCATED', packages: [] };
  const packages = [];
  for (const [name, entry] of entries) {
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) ||
        name.length > 128 || !entry || typeof entry !== 'object' ||
        !LEVELS.includes(entry.severity)) {
      return { detail_status: 'INVALID', packages: [] };
    }
    packages.push({
      package: name,
      severity: entry.severity,
      direct: entry.isDirect === true,
      fix_available: entry.fixAvailable === false ? 'NO' :
        entry.fixAvailable === true || (entry.fixAvailable && typeof entry.fixAvailable === 'object') ? 'YES' : 'UNKNOWN',
    });
  }
  packages.sort((a, b) => a.package.localeCompare(b.package));
  return { detail_status: 'AVAILABLE', packages };
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
  let affected = { detail_status: 'UNAVAILABLE', packages: [] };
  try {
    const raw = JSON.parse(readFileSync(resolve('npm-audit.raw.json'), 'utf8'));
    result = summarizeAudit(raw, exitCode);
    affected = extractAffectedPackages(raw);
    if (result.status === 'FINDINGS' && affected.detail_status === 'INVALID') {
      result = { status: 'ERROR', reason: 'Invalid vulnerability package detail', counts: null };
    }
  } catch {
    result = { status: 'ERROR', reason: 'Could not parse scanner output', counts: null };
  }
  const summary = {
    schema: 'palaco.npm-audit-summary.v1',
    status: result.status,
    reason: result.reason,
    counts: result.counts,
    affected_packages: affected.packages,
    package_detail_status: affected.detail_status,
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
