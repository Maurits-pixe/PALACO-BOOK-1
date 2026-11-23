#!/usr/bin/env node
// Fail closed on unapproved external GitHub Actions, not just mutable tags.
// This deliberately tight allowlist applies to the repository's CI workflow.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPROVED_ACTIONS = Object.freeze({
  'actions/checkout': '11bd71901bbe5b1630ceea73d27597364c9af683',
  'actions/setup-node': '49933ea5288caeca8642d1e84afbd3f7d6820020',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
});
const EXPECTED_COUNTS = Object.freeze({
  'actions/checkout': 1,
  'actions/setup-node': 1,
  'actions/upload-artifact': 2,
});

export function checkCiActionPins(workflow) {
  if (typeof workflow !== 'string' || !workflow.trim()) {
    return ['Missing GitHub Actions workflow'];
  }
  const errors = [];
  const refs = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  const counts = Object.fromEntries(Object.keys(EXPECTED_COUNTS).map((action) => [action, 0]));
  if (refs.length === 0) errors.push('Workflow must invoke approved pinned actions');

  for (const ref of refs) {
    const match = /^([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@([a-f0-9]{40})$/.exec(ref);
    if (!match || APPROVED_ACTIONS[match[1]] !== match[2]) {
      errors.push(`Unapproved or mutable action reference: ${ref}`);
      continue;
    }
    counts[match[1]] += 1;
  }
  for (const [action, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[action] !== expected) {
      errors.push(`Expected ${expected} pinned uses of ${action}, got ${counts[action]}`);
    }
  }

  // Keep the checkout token out of persisted git configuration.
  const checkout = workflow.match(/^\s*-\s*uses:\s*actions\/checkout@[a-f0-9]{40}[^\n]*\n\s*with:\s*\n(?:\s+[^\n]*\n)*?\s+persist-credentials:\s*false\s*$/m);
  if (!checkout) errors.push('Checkout must set persist-credentials: false');
  if (!/^permissions:\s*\n\s*contents:\s*read\s*$/m.test(workflow)) {
    errors.push('Global permissions must remain contents: read');
  }
  // Limit workflow execution to the two unprivileged entry points.
  // Disallow new event types that could expose elevated tokens or secrets.
  const trigger = workflow.match(/^on:\s*\n((?:[ \t]+[^\n]*\n)*)/m);
  const events = trigger?.[1]?.split('\n').map((line) => line.trim()).filter(Boolean) ?? [];
  if (events.length !== 2 || events[0] !== 'push:' || events[1] !== 'pull_request:') {
    errors.push('CI may trigger only on push and pull_request');
  }

  // A job-level permissions override would supersede the read-only global
  // permissions declaration. Require exactly one global permissions block.
  const permissionHeaders = [...workflow.matchAll(/^[ \t]*permissions\s*:/gm)];
  const globalBlock = workflow.match(/^permissions:[^\n]*\n((?:[ \t]+[^\n]*\n)*)/m);
  const grantedPermissions = globalBlock?.[1]?.split('\n').map((line) => line.trim()).filter(Boolean) ?? [];
  if (permissionHeaders.length !== 1 || grantedPermissions.length !== 1 ||
      grantedPermissions[0] !== 'contents: read') {
    errors.push('Job-level or unexpected permissions override');
  }
  // Require a predictable GitHub-hosted runner and bounded job runtime.
  // This is an explicit OS release, not a pin of the runner image revision.
  const runners = [...workflow.matchAll(/^[ \t]*runs-on:[ \t]*([^\n#]+)/gm)]
    .map((match) => match[1].trim());
  if (runners.length !== 1 || runners[0] !== 'ubuntu-24.04') {
    errors.push('CI must use exactly one ubuntu-24.04 runner');
  }
  const timeouts = [...workflow.matchAll(/^[ \t]*timeout-minutes:[ \t]*([^\n#]+)/gm)]
    .map((match) => match[1].trim());
  if (timeouts.length !== 1 || timeouts[0] !== '20') {
    errors.push('CI must have a single 20-minute timeout');
  }
  // Never mask a failed verification step or job with continue-on-error.
  // The only intentionally unconditional step is sanitized audit artifact
  // collection, not a bypass of any verification gate.
  const errorOverrides = [...workflow.matchAll(/^[ \t]*continue-on-error\s*:/gm)];
  if (errorOverrides.length > 0) {
    errors.push('CI must not use continue-on-error');
  }
  // Reject ALL additional conditional steps, not just additional always()
  // expressions. A condition such as "if: false" could silently bypass a
  // required verification while allowing the overall job to look green.
  const allConditions = [...workflow.matchAll(/^[ \t]*if\s*:\s*([^\n]*)$/gm)]
    .map((match) => match[1].trim());
  if (allConditions.length !== 1 || allConditions[0] !== 'always()' ||
      !/^[ \t]*- name: Upload sanitized npm audit summary\n[ \t]+if: always\(\)\s*$/m.test(workflow)) {
    errors.push('Only audit evidence upload may declare an if condition');
  }
  return errors;
}

export function main() {
  let workflow;
  try {
    workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
  } catch {
    console.error('CI action pin check FAILED: unreadable workflow');
    return 2;
  }
  const errors = checkCiActionPins(workflow);
  for (const error of errors) console.error(`CI action pin check FAILED: ${error}`);
  if (errors.length) return 1;
  console.log('CI action pin check PASS (exact approved SHAs, expected counts, no persisted checkout token)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
