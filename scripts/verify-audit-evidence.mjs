#!/usr/bin/env node
// Independently validate the sanitized npm audit evidence against checkout bytes.
// A matching hash establishes consistency, not release authorization.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export function verifyAuditEvidence(report, lockfileBytes, checkoutSha) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return ['Audit summary must be an object'];
  }
  if (report.schema !== 'palaco.npm-audit-summary.v1') errors.push('Unknown audit schema');
  if (report.release_authorization !== 'DENY') errors.push('Release authorization must be DENY');
  if (report.status !== 'NO_FINDINGS') errors.push('Audit status is not NO_FINDINGS');
  if (!report.counts || typeof report.counts !== 'object' || Array.isArray(report.counts)) {
    errors.push('Missing audit severity counts');
  } else {
    for (const key of [...SEVERITIES, 'total']) {
      if (report.counts[key] !== 0) errors.push(`Nonzero or missing audit count: ${key}`);
    }
  }
  if (!Array.isArray(report.affected_packages) || report.affected_packages.length !== 0) {
    errors.push('Clean audit must have empty affected package list');
  }
  if (report.package_detail_status !== 'AVAILABLE') {
    errors.push('Audit package detail must be complete');
  }
  if (typeof checkoutSha !== 'string' || !/^[a-f0-9]{40}$/.test(checkoutSha)) {
    errors.push('Checkout commit SHA is malformed');
  }
  if (!report.provenance || typeof report.provenance !== 'object' ||
      report.provenance.git_commit_sha !== checkoutSha) {
    errors.push('Audit checkout SHA does not match Git HEAD');
  }
  if (!Buffer.isBuffer(lockfileBytes)) {
    errors.push('Missing lockfile bytes');
  } else {
    const digest = createHash('sha256').update(lockfileBytes).digest('hex');
    if (report.provenance?.lockfile_sha256 !== digest) {
      errors.push('Audit lockfile digest does not match checked-out file');
    }
  }
  return errors;
}

export function main() {
  let report, bytes, sha;
  try {
    report = JSON.parse(readFileSync(resolve('npm-audit-summary.json'), 'utf8'));
    bytes = readFileSync(resolve('package-lock.json'));
    sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Audit evidence verification FAILED: unavailable input or Git HEAD');
    return 2;
  }
  const errors = verifyAuditEvidence(report, bytes, sha);
  if (errors.length) {
    for (const error of errors) console.error(`Audit evidence verification FAILED: ${error}`);
    return 1;
  }
  console.log('Audit evidence verification PASS (zero findings; exact Git HEAD and lockfile)');
  console.log('Production release authorization remains DENY');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
