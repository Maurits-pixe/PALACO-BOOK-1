#!/usr/bin/env node
// Fail closed on unapproved external GitHub Actions, not just mutable tags.
// This deliberately tight allowlist applies to the repository's CI workflow.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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


// Preserve the exact existing tracked workflow inventory. New workflows
// require explicit review instead of silently bypassing CI's policy checks.
export const APPROVED_WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/live-provider-conformance-launcher.yml',
  '.github/workflows/live-provider-conformance.yml',
  '.github/workflows/registry-contract.yml',
  '.github/workflows/veldgids-runtime-ci.yml',
]);

export function checkTrackedWorkflowPaths(paths) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
    return ['Could not enumerate tracked GitHub workflow paths'];
  }
  const workflows = paths.filter((path) => path.startsWith('.github/workflows/')).sort();
  const approved = [...APPROVED_WORKFLOW_PATHS].sort();
  if (JSON.stringify(workflows) !== JSON.stringify(approved)) {
    return ['Tracked workflow inventory differs from the approved baseline'];
  }
  return [];
}

// Freeze the existing four legacy workflows at the reviewed Git blob IDs.
// This detects edits but does NOT assert the legacy workflows are secure.
export const LEGACY_WORKFLOW_BLOBS = Object.freeze({
  '.github/workflows/live-provider-conformance-launcher.yml': 'eeecf248f72d74706fca5408f828ceff2da851f6',
  '.github/workflows/live-provider-conformance.yml': '40421c0686734bb7bdbccc79917c695cbbee5d80',
  '.github/workflows/registry-contract.yml': '3784532def0cba62a4d6ba8532c517acd1865eec',
  '.github/workflows/veldgids-runtime-ci.yml': '0131c5613a7a24721492a44d2435429db05a6bc3',
});

export function checkLegacyWorkflowBlobs(blobs) {
  if (!blobs || typeof blobs !== 'object' || Array.isArray(blobs)) {
    return ['Legacy workflow blob inventory is unavailable'];
  }
  return Object.entries(LEGACY_WORKFLOW_BLOBS).flatMap(([path, expected]) =>
    blobs[path] === expected ? [] : [`Legacy workflow content changed: ${path}`]);
}

export function checkCiActionPins(workflow) {
  if (typeof workflow !== 'string' || !workflow.trim()) {
    return ['Missing GitHub Actions workflow'];
  }
  const errors = [];
  // The approved workflow is plain UTF-8 text with LF line endings.
  // Reject BOMs and hidden controls before applying line-based validators.
  // CRLF and CR-only lines must not change how keys or commands match.
  if (workflow.charCodeAt(0) === 0xfeff || /[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(workflow)) {
    errors.push('CI workflow contains a BOM or noncanonical control character');
  }
  // This policy covers one plain YAML document. Multiple documents,
  // directives and tab-indented mappings are outside the reviewed CI
  // grammar and must not be interpreted as additional instructions.
  const documentControls = [...workflow.matchAll(
    /^(?:---|\.\.\.)(?:[ \t]*(?:#.*)?)?$/gm,
  )];
  const directives = [...workflow.matchAll(/^%(?:YAML|TAG)(?:[ \t]|$)/gm)];
  const tabIndentation = [...workflow.matchAll(/^[ \t]*\t[ \t]*\S/gm)];
  if (documentControls.length || directives.length || tabIndentation.length) {
    errors.push('Unreviewed YAML document boundary, directive or tab indentation');
  }
  // Refuse alternate root-level keys, duplicates and reordered policy
  // sections. A changed root key could alter workflow behavior without
  // changing any approved action or verification step.
  const topLevelKeys = [...workflow.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)]
    .map((match) => match[1]);
  const expectedTopLevelKeys = ['name', 'on', 'permissions', 'concurrency', 'jobs'];
  if (JSON.stringify(topLevelKeys) !== JSON.stringify(expectedTopLevelKeys)) {
    errors.push('CI root keys differ from the reviewed workflow structure');
  }
  // YAML quoted mapping keys can carry the same meaning as plain keys.
  // Do not let `'uses':`, `"if":`, or quoted privilege fields bypass
  // the canonical key scanners on which the CI gates rely.
  const quotedSecurityKeys = [...workflow.matchAll(
    /^[ \t]*-?[ \t]*(['"])(uses|with|if|run|permissions|continue-on-error|env|environment|secrets|container|services|strategy|defaults|shell|working-directory|runs-on|timeout-minutes)\1[ \t]*:/gm,
  )].map((match) => match[2]);
  if (quotedSecurityKeys.length > 0) {
    errors.push('Quoted CI security key detected: ' + quotedSecurityKeys.join(', '));
  }
  // YAML anchors, aliases and merge mappings can indirect configuration
  // through other keys. This canonical CI workflow has no such constructs.
  // Match YAML mappings only, avoiding shell content and comment prose.
  const yamlMergeKeys = [...workflow.matchAll(
    /^[ \t]*-?[ \t]*<<[ \t]*:/gm,
  )];
  const yamlReferences = [...workflow.matchAll(
    /^[ \t]*-?[ \t]*(?:[A-Za-z_][A-Za-z0-9_-]*|['"][^'"\n]+['"])[ \t]*:[ \t]*[&*][A-Za-z0-9_-]+(?:[ \t]*(?:#.*)?)?$/gm,
  )];
  if (yamlMergeKeys.length || yamlReferences.length) {
    errors.push('YAML anchors, aliases or merge keys are not approved in CI');
  }
  const refs = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((match) => match[1]);
  // A YAML key may legally contain whitespace before ':'. The canonical
  // uses: regex above intentionally enforces one spelling; now reject every
  // noncanonical uses key so a hidden action cannot evade its action counts.
  const actionKeys = [...workflow.matchAll(/^[ \t]*-?[ \t]*uses[ \t]*:/gm)];
  if (actionKeys.length !== refs.length) {
    errors.push('Noncanonical or unreviewed uses key detected');
  }
  // Every approved external Action has exactly one reviewed input map.
  // Duplicate `with` blocks or YAML whitespace variants may change action
  // inputs without altering their approved uses: SHA or canonical setup.
  const withKeys = [...workflow.matchAll(/^[ \t]*-?[ \t]*with[ \t]*:/gm)];
  const canonicalWithKeys = [...workflow.matchAll(/^        with:$/gm)];
  if (withKeys.length !== refs.length ||
      canonicalWithKeys.length !== refs.length) {
    errors.push('Action input maps must be canonical and exactly one per Action');
  }
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

  // Enforce the entire reviewed input configuration for both setup actions.
  // An otherwise pinned checkout could fetch a different repository/ref, or
  // setup-node could silently change runtimes, cache or registry settings.
  const expectedSetup = [
    `      - uses: actions/checkout@${APPROVED_ACTIONS['actions/checkout']} # v4.2.2`,
    '        with:',
    '          persist-credentials: false',
    `      - uses: actions/setup-node@${APPROVED_ACTIONS['actions/setup-node']} # v4.4.0`,
    '        with:',
    '          node-version: 22',
    '      - name: Check pinned Actions and checkout credential policy',
  ].join('\n');
  if (!workflow.includes(expectedSetup)) {
    errors.push('Checkout and Node setup inputs differ from the reviewed CI configuration');
  }
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
  // Preserve the per-ref cancellation policy and avoid unreviewed
  // job-level concurrency overrides or global group collisions.
  const concurrencyHeaders = [...workflow.matchAll(/^[ \t]*concurrency\s*:/gm)];
  const expectedConcurrency = "concurrency:\n  group: ci-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\n";
  const concurrencyBlock = workflow.match(/^concurrency:[^\n]*\n((?:[ \t]+[^\n]*\n)*)/m);
  if (concurrencyHeaders.length !== 1 ||
      !concurrencyBlock ||
      'concurrency:\n' + concurrencyBlock[1] !== expectedConcurrency) {
    errors.push('CI concurrency group and cancellation policy differ from reviewed configuration');
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
  // A second YAML mapping with spaces before its colon can override the
  // reviewed runner or timeout while avoiding the canonical value regex.
  // Require one key of each kind and no alternate key spellings.
  for (const [key, canonicalCount] of [
    ['runs-on', runners.length],
    ['timeout-minutes', timeouts.length],
  ]) {
    const variants = [...workflow.matchAll(
      new RegExp('^[ \t]*' + key + '[ \t]*:', 'gm'),
    )];
    if (variants.length !== canonicalCount) {
      errors.push('Noncanonical or duplicate CI ' + key + ' key detected');
    }
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
  const allConditions = [...workflow.matchAll(/^[ \t]*if:\s*([^\n]*)$/gm)]
    .map((match) => match[1].trim());
  // YAML accepts `if :` as a mapping key too. Detect every alternate
  // spelling before validating the sole approved audit-upload condition.
  const conditionKeys = [...workflow.matchAll(/^[ \t]*-?[ \t]*if[ \t]*:/gm)];
  if (conditionKeys.length !== allConditions.length) {
    errors.push('Noncanonical or unreviewed if key detected');
  }
  if (allConditions.length !== 1 || allConditions[0] !== 'always()' ||
      !/^[ \t]*- name: Upload sanitized npm audit summary\n[ \t]+if: always\(\)\s*$/m.test(workflow)) {
    errors.push('Only audit evidence upload may declare an if condition');
  }
  // The verification job has no outputs, dependencies, or named step IDs.
  // These add cross-job dataflow or indirect references not covered by the
  // reviewed single-job, fixed-command policy.
  const indirectKeys = [...workflow.matchAll(
    /^[ \t]*-?[ \t]*(?:['"])?(id|outputs|needs)(?:['"])?[ \t]*:/gm,
  )].map((match) => match[1]);
  if (indirectKeys.length > 0) {
    errors.push('Unreviewed CI job or step dataflow key: ' + indirectKeys.join(', '));
  }
  // Disallow unreviewed execution context that can bypass the existing
  // deterministic single-job verification, inject credentials or launch
  // containers/services. This deliberately does not parse arbitrary YAML.
  const forbiddenContexts = [...workflow.matchAll(
    /^[ \t]*(env|environment|secrets|container|services|strategy|defaults)\s*:/gm,
  )].map((match) => match[1]);
  if (forbiddenContexts.length > 0) {
    errors.push('Unreviewed CI execution context: ' + forbiddenContexts.join(', '));
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
  let trackedPaths;
  try {
    const output = execFileSync('git', ['ls-files', '--cached', '-z', '--', '.github/workflows'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    trackedPaths = output.split('\0').filter(Boolean);
  } catch {
    console.error('CI action pin check FAILED: unreadable tracked workflows');
    return 2;
  }
  const blobs = {};
  try {
    for (const path of Object.keys(LEGACY_WORKFLOW_BLOBS)) {
      blobs[path] = execFileSync('git', ['hash-object', '--', path], {
        encoding: 'utf8',
        maxBuffer: 4096,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    }
  } catch {
    console.error('CI action pin check FAILED: cannot hash legacy workflow files');
    return 2;
  }
  const errors = [
    ...checkCiActionPins(workflow),
    ...checkTrackedWorkflowPaths(trackedPaths),
    ...checkLegacyWorkflowBlobs(blobs),
  ];
  for (const error of errors) console.error(`CI action pin check FAILED: ${error}`);
  if (errors.length) return 1;
  console.log('CI action pin check PASS (exact approved SHAs, expected counts, no persisted checkout token)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
