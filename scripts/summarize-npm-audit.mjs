#!/usr/bin/env node
// Summarize npm audit results without publishing detailed advisory payloads.
// Any npm advisory finding blocks CI; all results remain evidence, not release authorization.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];

export function summarizeAudit(input, exitCode) {
  const statusCode = Number(exitCode);
  // npm audit uses exit 0 for clean scans and exit 1 for vulnerability
  // findings. Any other code is treated as an infrastructure/scanner error.
  if (!Number.isInteger(statusCode) || (statusCode !== 0 && statusCode !== 1)) {
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
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) ||
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
  if (result?.status === 'NO_FINDINGS') return 0;
  if (result?.status === 'FINDINGS') return 1;
  // Unexpected or absent states never mean successful security verification.
  return 2;
}

// Bind a sanitized npm audit report to the exact Git commit and lockfile.
// Refuse missing/untrusted commit metadata rather than claiming provenance.
export function makeAuditProvenance(commitSha, lockfileContent) {
  if (typeof commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(commitSha) ||
      !(typeof lockfileContent === 'string' || Buffer.isBuffer(lockfileContent))) {
    throw new Error('Invalid commit or lockfile for audit provenance');
  }
  return {
    git_commit_sha: commitSha,
    lockfile_sha256: createHash('sha256').update(lockfileContent).digest('hex'),
  };
}

export function main() {
  const exitCode = process.argv[2];
  let result;
  let provenance = null;
  let affected = { detail_status: 'UNAVAILABLE', packages: [] };
  try {
    provenance = makeAuditProvenance(process.env.GITHUB_SHA,
      readFileSync(resolve('package-lock.json')));
  } catch {
    // Missing or corrupt source metadata must not yield clean audit evidence.
    result = { status: 'ERROR', reason: 'Missing valid provenance', counts: null };
  }
  try {
    const raw = JSON.parse(readFileSync(resolve('npm-audit.raw.json'), 'utf8'));
    result = summarizeAudit(raw, exitCode);
    affected = extractAffectedPackages(raw);
    if (!provenance || (result.status === 'FINDINGS' && affected.detail_status === 'INVALID')) {
      result = { status: 'ERROR', reason: 'Invalid audit provenance or package detail', counts: null };
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
    provenance,
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
