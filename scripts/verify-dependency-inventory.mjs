#!/usr/bin/env node
// Cross-check deterministic package inventory and npm audit evidence against
// the same exact checked-out source. This is CI consistency, not an attestation.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDependencyInventory } from './build-dependency-inventory.mjs';
import { verifyAuditEvidence } from './verify-audit-evidence.mjs';

export function verifyInventoryEvidence(manifest, lockfileBytes, checkoutSha, inventory, audit) {
  const errors = [];
  let expected;
  try {
    expected = buildDependencyInventory(manifest, lockfileBytes, checkoutSha);
  } catch {
    return ['Cannot reconstruct inventory from the committed lockfile'];
  }
  // Byte-for-byte semantic object equivalence rejects altered counts, omissions,
  // invented packages, changed ordering, extraneous fields and authorization.
  if (JSON.stringify(inventory) !== JSON.stringify(expected)) {
    errors.push('Inventory does not match deterministic committed-lockfile reconstruction');
  }
  errors.push(...verifyAuditEvidence(audit, lockfileBytes, checkoutSha)
    .map((error) => `Audit mismatch: ${error}`));
  if (inventory?.git_checkout_sha !== audit?.provenance?.git_commit_sha) {
    errors.push('Inventory and audit refer to different Git commits');
  }
  if (inventory?.lockfile_sha256 !== audit?.provenance?.lockfile_sha256) {
    errors.push('Inventory and audit refer to different lockfiles');
  }
  return errors;
}

export function main() {
  try {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const bytes = readFileSync(resolve('package-lock.json'));
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const inventory = JSON.parse(readFileSync(resolve('npm-dependency-inventory.json'), 'utf8'));
    const audit = JSON.parse(readFileSync(resolve('npm-audit-summary.json'), 'utf8'));
    const errors = verifyInventoryEvidence(manifest, bytes, sha, inventory, audit);
    if (errors.length) {
      for (const error of errors) console.error(`Inventory verification FAILED: ${error}`);
      return 1;
    }
    console.log('Inventory verification PASS: exact lockfile, matching audit and Git HEAD');
    console.log('Production authorization remains DENY');
    return 0;
  } catch {
    console.error('Inventory verification FAILED: unreadable or missing evidence');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
