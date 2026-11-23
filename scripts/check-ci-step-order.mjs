#!/usr/bin/env node
// Scope: exact ordered, named gates in PALACO-BOOK-1's single CI job.
// In-workflow consistency check; not a full YAML parser or branch protection.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_STEPS = Object.freeze([
  'Check pinned Actions and checkout credential policy',
  'Check required CI verification steps and order',
  'Check tracked sensitive files',
  'Check declared dependency sources',
  'Require committed npm lockfile',
  'Verify committed lockfile before installation',
  'Record committed lockfile digest',
  'Install from committed lockfile',
  'Verify dependency metadata after installation',
  'Verify npm ci did not modify lockfile',
  'Generate deterministic dependency review inventory',
  'Typecheck',
  'Unit and integration tests',
  'Build',
  'Collect npm vulnerability audit evidence',
  'Independently verify clean audit provenance',
  'Verify inventory against audit and committed lockfile',
  'Upload dependency inventory for review',
  'Upload sanitized npm audit summary',
]);

export const APPROVED_ARTIFACT_UPLOAD_TAIL = "      - name: Upload dependency inventory for review\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          name: npm-dependency-inventory\n          path: npm-dependency-inventory.json\n          if-no-files-found: error\n          retention-days: 7\n      - name: Upload sanitized npm audit summary\n        if: always()\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          name: npm-audit-summary\n          path: npm-audit-summary.json\n          if-no-files-found: warn\n          retention-days: 7\n";

export function checkCiStepOrder(workflow) {
  if (typeof workflow !== 'string' || !workflow.trim()) {
    return ['Missing CI workflow'];
  }
  const errors = [];
  // This repository's workflow has one job and uses exactly four external
  // action invocations. Named local gates must be ordered as declared.
  const names = [...workflow.matchAll(/^\s+- name:\s*([^\n#]+?)\s*$/gm)]
    .map((match) => match[1].trim());
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_STEPS)) {
    errors.push('Required CI steps are missing, duplicated, reordered or unexpected');
  }
  const unnamedCommands = [...workflow.matchAll(/^\s+- run\s*:/gm)];
  if (unnamedCommands.length !== 0) {
    errors.push('Unnamed run steps are prohibited');
  }
  const jobsBlock = workflow.split(/^jobs:\s*$/m)[1] ?? '';
  const jobs = [...jobsBlock.matchAll(/^  [a-z][a-z0-9_-]*:\s*$/gm)];
  if (jobs.length !== 1 || !/^  verify:\s*$/m.test(workflow)) {
    errors.push('CI must contain exactly one verify job');
  }
  // Assertions for the most sensitive commands: step labels cannot stand
  // in for a removed validation gate.
  const commands = [
    'node scripts/check-ci-action-pins.mjs',
    'node scripts/check-ci-step-order.mjs',
    'node scripts/check-tracked-sensitive.mjs',
    'node scripts/check-dependency-sources.mjs',
    'git ls-files --error-unmatch package-lock.json',
    'node scripts/verify-lockfile.mjs',
    'sha256sum package-lock.json > package-lock.sha256',
    'npm ci',
    'node scripts/verify-lockfile.mjs',
    'sha256sum -c package-lock.sha256',
    'node scripts/build-dependency-inventory.mjs',
    'npm run typecheck',
    'npm test',
    'npm run build',
    'node scripts/verify-audit-evidence.mjs',
    'node scripts/verify-dependency-inventory.mjs',
  ];
  const lines = [...workflow.matchAll(/^\s+run:\s*([^\n]+)$/gm)]
    .map((match) => match[1].trim()).filter((value) => value !== '|');
  // The exact run list above only recognizes canonical `run:` keys.
  // Count all YAML whitespace variants to prevent hidden extra commands
  // such as `run : echo bypass` from escaping that comparison.
  const allRunKeys = [...workflow.matchAll(/^[ \t]*-?[ \t]*run[ \t]*:/gm)];
  const canonicalRunKeys = [...workflow.matchAll(/^[ \t]+run:/gm)];
  if (allRunKeys.length !== canonicalRunKeys.length) {
    errors.push('Noncanonical or unreviewed run key detected');
  }
  // The npm audit step has a multiline shell body and is tested separately.
  if (JSON.stringify(lines) !== JSON.stringify(commands)) {
    errors.push('CI validation commands do not match the approved sequence');
  }
  // Reconstruct the entire approved audit shell body. Merely searching for
  // required commands is insufficient: an extra command or reordered trap
  // can silently weaken the fail-closed scanner or leak raw scanner output.
  const auditStep = workflow.match(
    /^      - name: Collect npm vulnerability audit evidence\n        shell: bash\n        run: \|\n((?:          [^\n]*\n)+)/m,
  );
  const expectedAuditCommands = [
    "trap 'rm -f npm-audit.raw.json' EXIT",
    'set +e',
    'npm audit --json --audit-level=low > npm-audit.raw.json',
    'audit_exit=$?',
    'set -e',
    'node scripts/summarize-npm-audit.mjs "$audit_exit"',
  ];
  const actualAuditCommands = auditStep?.[1]?.split('\n')
    .filter((line) => line.length > 0).map((line) => line.slice(10)) ?? [];
  if (JSON.stringify(actualAuditCommands) !== JSON.stringify(expectedAuditCommands)) {
    errors.push('Mandatory npm vulnerability scan shell body differs from approved commands');
  }
  // Publication must use the exact reviewed sanitized files. Comparing the
  // entire final step blocks rejects altered names, globs, unknown settings,
  // retention changes, upload permissions and any trailing extra steps.
  const uploadOffset = workflow.indexOf('      - name: Upload dependency inventory for review');
  if (uploadOffset < 0 ||
      workflow.slice(uploadOffset) !== APPROVED_ARTIFACT_UPLOAD_TAIL) {
    errors.push('Audit and inventory artifact publication differs from approved configuration');
  }
  return errors;
}

export function main() {
  try {
    const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
    const errors = checkCiStepOrder(workflow);
    for (const error of errors) console.error('CI order FAILED:', error);
    if (errors.length > 0) return 1;
    console.log('CI step sequence PASS (required gates and commands in order)');
    return 0;
  } catch {
    console.error('CI order FAILED: unreadable workflow');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
