import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCiActionPins, checkTrackedWorkflowPaths, checkLegacyWorkflowBlobs, LEGACY_WORKFLOW_BLOBS, APPROVED_ACTIONS } from '../scripts/check-ci-action-pins.mjs';

const checkout = APPROVED_ACTIONS['actions/checkout'];
const setup = APPROVED_ACTIONS['actions/setup-node'];
const upload = APPROVED_ACTIONS['actions/upload-artifact'];
const good = `name: CI
on:
  push:
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@${checkout} # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@${setup} # v4.4.0
        with:
          node-version: 22
      - name: Check pinned Actions and checkout credential policy
      - name: Upload inventory
        uses: actions/upload-artifact@${upload} # approved
        with:
          name: reviewed-evidence
      - name: Upload sanitized npm audit summary
        if: always()
        uses: actions/upload-artifact@${upload} # approved
        with:
          name: reviewed-evidence
`;

test('accepts exactly approved action SHAs, usage counts and credential policy', () => {
  assert.deepEqual(checkCiActionPins(good), []);
});
test('rejects a mutable tag or arbitrary 40-digit SHA for an approved action', () => {
  assert.ok(checkCiActionPins(good.replace(`setup-node@${setup}`, 'setup-node@v4')).length);
  assert.ok(checkCiActionPins(good.replace(`setup-node@${setup}`, 'setup-node@' + 'a'.repeat(40))).length);
});
test('rejects even pinned Actions from unapproved repositories', () => {
  assert.ok(checkCiActionPins(good.replace(`actions/setup-node@${setup}`, 'thirdparty/setup-node@' + 'a'.repeat(40)))
    .some((error) => error.includes('Unapproved')));
});
test('detects missing, duplicated or replaced mandatory Actions', () => {
  assert.ok(checkCiActionPins(good.replace(`      - name: Upload sanitized npm audit summary
        if: always()
        uses: actions/upload-artifact@${upload} # approved
`, '')).some((error) => error.includes('Expected 2')));
  assert.ok(checkCiActionPins(good + `      - uses: actions/upload-artifact@${upload}\n`)
    .some((error) => error.includes('Expected 2')));
  assert.ok(checkCiActionPins('name: CI\npermissions:\n  contents: read\n').length);
});
test('requires non-persistent checkout credentials and read-only token', () => {
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false', 'persist-credentials: true')).length);
  assert.ok(checkCiActionPins(good.replace('persist-credentials: false', '')).length);
  assert.ok(checkCiActionPins(good.replace('contents: read', 'contents: write')).length);
  assert.ok(checkCiActionPins(null).length);
});

test('blocks privileged workflow triggers and replacement of approved events', () => {
  assert.ok(checkCiActionPins(good.replace('  pull_request:\n', '  pull_request_target:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('  push:\n', '  workflow_dispatch:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('  pull_request:\n', '  pull_request:\n  workflow_run:\n'))
    .some((error) => error.includes('trigger only')));
  assert.ok(checkCiActionPins(good.replace('on:\n  push:\n  pull_request:\n', ''))
    .some((error) => error.includes('trigger only')));
});

test('blocks job-level permissions overriding global read-only access', () => {
  const jobOverride = good.replace('  verify:\n', '  verify:\n    permissions:\n      contents: write\n');
  assert.ok(checkCiActionPins(jobOverride)
    .some((error) => error.includes('permissions override')));
  assert.ok(checkCiActionPins(good.replace('  contents: read', '  contents: read\n  id-token: write'))
    .some((error) => error.includes('permissions override')));
});

test('global permissions remain exactly one contents-read entry', () => {
  const withOidc = good.replace('  contents: read', '  contents: read\n  id-token: write');
  assert.ok(checkCiActionPins(withOidc).some((error) =>
    error.includes('permissions override')));
  const withPackages = good.replace('  contents: read', '  contents: read\n  packages: read');
  assert.ok(checkCiActionPins(withPackages).some((error) =>
    error.includes('permissions override')));
  const duplicated = good.replace('jobs:\n', 'permissions:\n  contents: read\njobs:\n');
  assert.ok(checkCiActionPins(duplicated).some((error) =>
    error.includes('permissions override')));
});

test('requires explicit Ubuntu 24.04 instead of mutable or self-hosted runners', () => {
  assert.ok(checkCiActionPins(good.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-latest'))
    .some((error) => error.includes('ubuntu-24.04 runner')));
  assert.ok(checkCiActionPins(good.replace('runs-on: ubuntu-24.04', 'runs-on: self-hosted'))
    .some((error) => error.includes('ubuntu-24.04 runner')));
  assert.ok(checkCiActionPins(good + '      runs-on: ubuntu-24.04\n')
    .some((error) => error.includes('ubuntu-24.04 runner')));
});

test('requires exactly one bounded 20-minute CI job timeout', () => {
  assert.ok(checkCiActionPins(good.replace('timeout-minutes: 20', 'timeout-minutes: 360'))
    .some((error) => error.includes('20-minute timeout')));
  assert.ok(checkCiActionPins(good.replace('    timeout-minutes: 20\n', ''))
    .some((error) => error.includes('20-minute timeout')));
  assert.ok(checkCiActionPins(good + '      timeout-minutes: 120\n')
    .some((error) => error.includes('20-minute timeout')));
});

test('fails closed on continue-on-error even when set to false', () => {
  for (const value of ['true', 'false', '${{ true }}']) {
    const changed = good.replace('        with:\n          node-version: 22',
      `        continue-on-error: ${value}\n        with:\n          node-version: 22`);
    assert.ok(checkCiActionPins(changed)
      .some((error) => error.includes('continue-on-error')));
  }
});

test('allows unconditional audit artifact upload only, not bypassed checks', () => {
  assert.deepEqual(checkCiActionPins(good), []);
  const bypass = good.replace('        with:\n          node-version: 22',
    '        if: always()\n        with:\n          node-version: 22');
  assert.ok(checkCiActionPins(bypass).some((error) => error.includes('Only audit evidence')));
  const removed = good.replace('        if: always()\n', '');
  assert.ok(checkCiActionPins(removed).some((error) => error.includes('Only audit evidence')));
});

test('rejects any extra conditional verification step, including false and expressions', () => {
  for (const condition of ['false', 'success()', '${{ false }}', 'always()']) {
    const modified = good.replace('        with:\n          node-version: 22',
      `        if: ${condition}\n        with:\n          node-version: 22`);
    assert.ok(checkCiActionPins(modified)
      .some((error) => error.includes('if condition')), condition);
  }
});

test('rejects altered audit condition and job-level conditional execution', () => {
  const changed = good.replace('        if: always()', '        if: success()');
  assert.ok(checkCiActionPins(changed).some((error) =>
    error.includes('if condition')));
  const skippedJob = good.replace('    runs-on: ubuntu-24.04',
    '    if: false\n    runs-on: ubuntu-24.04');
  assert.ok(checkCiActionPins(skippedJob).some((error) =>
    error.includes('if condition')));
});

test('rejects unreviewed checkout ref, repository and fetch settings', () => {
  for (const inserted of ['          repository: unrelated/project\n',
    '          ref: untrusted\n', '          fetch-depth: 0\n']) {
    const modified = good.replace('          persist-credentials: false\n',
      '          persist-credentials: false\n' + inserted);
    assert.ok(checkCiActionPins(modified)
      .some((error) => error.includes('setup inputs')));
  }
});

test('requires reviewed Node 22 setup and no extra cache, registry or token inputs', () => {
  for (const modified of [
    good.replace('node-version: 22', 'node-version: 20'),
    good.replace('node-version: 22', 'node-version: 24'),
    good.replace('          node-version: 22\n', '          node-version: 22\n          cache: npm\n'),
    good.replace('          node-version: 22\n', '          node-version: 22\n          registry-url: https://example.invalid\n'),
    good.replace('          node-version: 22\n', '          node-version: 22\n          token: ${{ secrets.ANOTHER_TOKEN }}\n'),
  ]) {
    assert.ok(checkCiActionPins(modified)
      .some((error) => error.includes('setup inputs')));
  }
});

test('requires per-ref concurrency and cancel-in-progress', () => {
  const cases = [
    good.replace('cancel-in-progress: true', 'cancel-in-progress: false'),
    good.replace('ci-${{ github.workflow }}-${{ github.ref }}', 'ci-global'),
    good.replace('concurrency:\n', 'concurrency:\n  group: ci-unreviewed\n'),
    good.replace('  cancel-in-progress: true\n', ''),
    good.replace('concurrency:\n  group: ci-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\n', ''),
  ];
  for (const item of cases) {
    assert.ok(checkCiActionPins(item).some((error) =>
      error.includes('concurrency group')), item);
  }
});

test('rejects job-level concurrency override or duplicate top-level block', () => {
  const jobOverride = good.replace('  verify:\n',
    '  verify:\n    concurrency: unsafe-group\n');
  assert.ok(checkCiActionPins(jobOverride).some((error) =>
    error.includes('concurrency group')));
  const duplicate = good.replace('jobs:\n',
    'concurrency:\n  group: another\n  cancel-in-progress: false\njobs:\n');
  assert.ok(checkCiActionPins(duplicate).some((error) =>
    error.includes('concurrency group')));
});

test('rejects injected workflow, job and step environments or secret maps', () => {
  const cases = [
    good.replace('jobs:\n', 'env:\n  NODE_OPTIONS: --require ./untrusted.cjs\njobs:\n'),
    good.replace('  verify:\n', '  verify:\n    environment: production\n'),
    good.replace('  verify:\n', '  verify:\n    secrets:\n      token: unexpected\n'),
    good.replace('        with:\n          node-version: 22', '        env:\n          NODE_OPTIONS: unsafe\n        with:\n          node-version: 22'),
  ];
  for (const workflow of cases) {
    assert.ok(checkCiActionPins(workflow).some((error) =>
      error.includes('Unreviewed CI execution context')));
  }
});

test('rejects unreviewed container, service, matrix and default execution contexts', () => {
  const cases = [
    '    container: node:22\n',
    '    services:\n      database:\n        image: postgres:latest\n',
    '    strategy:\n      matrix:\n        node: [20, 22]\n',
    '    defaults:\n      run:\n        shell: bash\n',
  ];
  for (const inserted of cases) {
    const changed = good.replace('    runs-on: ubuntu-24.04\n',
      inserted + '    runs-on: ubuntu-24.04\n');
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Unreviewed CI execution context')), inserted);
  }
});

test('accepts exactly the established tracked GitHub workflow inventory', () => {
  const approved = [
    '.github/workflows/ci.yml',
    '.github/workflows/live-provider-conformance-launcher.yml',
    '.github/workflows/live-provider-conformance.yml',
    '.github/workflows/registry-contract.yml',
    '.github/workflows/veldgids-runtime-ci.yml',
  ];
  assert.deepEqual(checkTrackedWorkflowPaths(approved), []);
  assert.deepEqual(checkTrackedWorkflowPaths([...approved].reverse()), []);
  assert.deepEqual(checkTrackedWorkflowPaths(['README.md', ...approved]), []);
});

test('rejects new, missing, renamed or duplicate tracked workflows', () => {
  const approved = [
    '.github/workflows/ci.yml',
    '.github/workflows/live-provider-conformance-launcher.yml',
    '.github/workflows/live-provider-conformance.yml',
    '.github/workflows/registry-contract.yml',
    '.github/workflows/veldgids-runtime-ci.yml',
  ];
  for (const paths of [
    [],
    approved.slice(1),
    [...approved, '.github/workflows/deploy.yml'],
    [...approved, '.github/workflows/manual.yaml'],
    [...approved, approved[0]],
    approved.map((p) => p === '.github/workflows/ci.yml' ? '.github/workflows/ci.yaml' : p),
    null,
    [...approved, null],
  ]) {
    assert.ok(checkTrackedWorkflowPaths(paths).length, String(paths));
  }
});

test('accepts the exact original content hashes of four legacy workflows', () => {
  assert.deepEqual(checkLegacyWorkflowBlobs({ ...LEGACY_WORKFLOW_BLOBS }), []);
});

test('refuses altered, deleted or unavailable legacy workflow content', () => {
  const [path] = Object.keys(LEGACY_WORKFLOW_BLOBS);
  const altered = { ...LEGACY_WORKFLOW_BLOBS, [path]: '0'.repeat(40) };
  assert.ok(checkLegacyWorkflowBlobs(altered).some((error) =>
    error.includes(path)));
  const missing = { ...LEGACY_WORKFLOW_BLOBS };
  delete missing[path];
  assert.ok(checkLegacyWorkflowBlobs(missing).some((error) =>
    error.includes(path)));
  assert.ok(checkLegacyWorkflowBlobs(null).length);
});

test('blocks noncanonical YAML uses keys that bypass action reference scanning', () => {
  const hidden = good.replace('      - name: Upload inventory\n',
    '      - uses : untrusted/action@v1\n      - name: Upload inventory\n');
  assert.ok(checkCiActionPins(hidden).some((error) =>
    error.includes('Noncanonical or unreviewed uses key')));
  const hiddenNested = good.replace('    steps:\n',
    '    steps:\n      - uses  : ./local-action\n');
  assert.ok(checkCiActionPins(hiddenNested).some((error) =>
    error.includes('Noncanonical or unreviewed uses key')));
});

test('blocks whitespace-varied mandatory action keys rather than accepting incorrect counts', () => {
  const modified = good.replace('      - uses: actions/setup-node@',
    '      - uses : actions/setup-node@');
  assert.ok(checkCiActionPins(modified).some((error) =>
    error.includes('Noncanonical or unreviewed uses key')));
});

test('blocks alternative YAML if keys that hide conditional bypasses', () => {
  for (const injected of [
    good.replace('      - name: Upload inventory\n',
      '      - name: Unexpected condition\n        if : false\n      - name: Upload inventory\n'),
    good.replace('    steps:\n', '    if  : false\n    steps:\n'),
    good.replace('        if: always()', '        if : always()'),
  ]) {
    assert.ok(checkCiActionPins(injected).some((error) =>
      error.includes('Noncanonical or unreviewed if key')));
  }
});

test('rejects extra root-level workflow settings without changing approved steps', () => {
  for (const modified of [
    good.replace('jobs:\n', 'run-name: unchecked\njobs:\n'),
    good.replace('jobs:\n', 'workflow_call: {}\njobs:\n'),
    good.replace('jobs:\n', 'permissions:\n  contents: write\njobs:\n'),
    good.replace('name: CI\n', 'name: CI\nname: Second CI\n'),
    good.replace('name: CI\n', 'name : CI\n'),
  ]) {
    assert.ok(checkCiActionPins(modified).some((error) =>
      error.includes('CI root keys differ')), modified);
  }
});

test('rejects deleted or reordered top-level workflow policy sections', () => {
  const changed = good.replace(
    'permissions:\n  contents: read\nconcurrency:',
    'concurrency:');
  assert.ok(checkCiActionPins(changed).some((error) =>
    error.includes('CI root keys differ')));
  const reordered = good.replace('name: CI\non:', 'on:');
  assert.ok(checkCiActionPins(reordered).some((error) =>
    error.includes('CI root keys differ')));
});

test('rejects quoted YAML action and condition keys hidden from plain-key scanners', () => {
  for (const [key, value] of [
    ["'uses'", 'untrusted/action@v1'],
    ['"uses"', './local-action'],
    ["'if'", 'false'],
    ['"if"', 'always()'],
    ["'run'", 'echo bypass'],
  ]) {
    const workflow = good.replace('      - name: Upload inventory\n',
      `      - ${key}: ${value}\n      - name: Upload inventory\n`);
    assert.ok(checkCiActionPins(workflow).some((error) =>
      error.includes('Quoted CI security key')), key);
  }
});

test('rejects quoted YAML privilege, execution and error suppression keys', () => {
  for (const key of [
    "'continue-on-error'", '"permissions"', "'env'", '"environment"',
    "'secrets'", '"container"', "'strategy'", '"shell"',
    "'working-directory'", '"timeout-minutes"',
  ]) {
    const workflow = good.replace('    steps:\n',
      `    ${key}: true\n    steps:\n`);
    assert.ok(checkCiActionPins(workflow).some((error) =>
      error.includes('Quoted CI security key')), key);
  }
});

test('rejects YAML anchors and aliases in security-sensitive workflow mappings', () => {
  const cases = [
    good.replace('    steps:\n', '    security: &injected\n    steps:\n'),
    good.replace('    steps:\n', '    security: *injected\n    steps:\n'),
    good.replace('    steps:\n', "    'security': &injected\n    steps:\n"),
    good.replace('    steps:\n', '    security : *injected # reuses hidden value\n    steps:\n'),
  ];
  for (const workflow of cases) {
    assert.ok(checkCiActionPins(workflow).some((error) =>
      error.includes('YAML anchors, aliases or merge keys')), workflow);
  }
});

test('rejects YAML mapping merges and permits ordinary ampersands in quoted values', () => {
  for (const workflow of [
    good.replace('    steps:\n', '    <<: *unsafe_config\n    steps:\n'),
    good.replace('    steps:\n', '    << : *unsafe_config\n    steps:\n'),
  ]) {
    assert.ok(checkCiActionPins(workflow).some((error) =>
      error.includes('YAML anchors, aliases or merge keys')));
  }
  assert.equal(checkCiActionPins(good)
    .some((error) => error.includes('YAML anchors, aliases or merge keys')), false);
});

test('rejects extra YAML document boundaries and directives', () => {
  for (const changed of [
    '---\n' + good,
    good + '...\n',
    good + '--- # additional YAML document\n',
    '%YAML 1.2\n' + good,
    '%TAG !repo! tag:example.com,2026:workflow/\n' + good,
  ]) {
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Unreviewed YAML document boundary')), changed);
  }
});

test('rejects tab indentation hidden inside the reviewed workflow', () => {
  for (const changed of [
    good.replace('    steps:\n', '\tsteps:\n'),
    good.replace('    steps:\n', '  \tsteps:\n'),
    good.replace('    steps:\n', '    \tif: false\n    steps:\n'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Unreviewed YAML document boundary')));
  }
  assert.equal(checkCiActionPins(good).some((error) =>
    error.includes('Unreviewed YAML document boundary')), false);
});

test('blocks unreviewed job dependencies and job output mappings', () => {
  for (const added of [
    '    needs: privileged\n',
    '    outputs:\n      token: secret\n',
    "    'needs': privileged\n",
    '    outputs : {}\n',
  ]) {
    const changed = good.replace('    steps:\n', added + '    steps:\n');
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Unreviewed CI job or step dataflow key')), added);
  }
});

test('blocks step IDs and output references that alter evidence dataflow', () => {
  for (const added of [
    '        id: injected\n',
    '        id : injected\n',
    '        "id": injected\n',
    "        'outputs': {}\n",
  ]) {
    const changed = good.replace('      - name: Upload inventory\n',
      '      - name: Upload inventory\n' + added);
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Unreviewed CI job or step dataflow key')), added);
  }
});

test('rejects duplicate action input maps and unreviewed whitespace variants', () => {
  for (const changed of [
    good.replace('          node-version: 22\n',
      '          node-version: 22\n        with:\n          token: secret\n'),
    good.replace('        with:\n          node-version: 22',
      '        with :\n          node-version: 22'),
    good.replace('        with:\n          name: reviewed-evidence',
      '        with  :\n          name: reviewed-evidence'),
    good.replace('        with:\n          name: reviewed-evidence',
      '        "with":\n          name: reviewed-evidence'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('Action input maps must be canonical')), changed);
  }
});

test('rejects missing action input maps for artifact publication', () => {
  const missing = good.replace('        with:\n          name: reviewed-evidence\n', '');
  assert.ok(checkCiActionPins(missing).some((error) =>
    error.includes('Action input maps must be canonical')));
});

test('rejects runner overrides hidden by YAML whitespace before colon', () => {
  for (const changed of [
    good.replace('    runs-on: ubuntu-24.04\n',
      '    runs-on: ubuntu-24.04\n    runs-on : self-hosted\n'),
    good.replace('    runs-on: ubuntu-24.04',
      '    runs-on : ubuntu-24.04'),
    good.replace('    timeout-minutes: 20\n',
      '    runs-on : self-hosted\n    timeout-minutes: 20\n'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((e) =>
      e.includes('Noncanonical or duplicate CI runs-on key')), changed);
  }
});

test('rejects timeout overrides hidden by YAML whitespace before colon', () => {
  for (const changed of [
    good.replace('    timeout-minutes: 20\n',
      '    timeout-minutes: 20\n    timeout-minutes : 0\n'),
    good.replace('    timeout-minutes: 20',
      '    timeout-minutes : 20'),
    good.replace('    timeout-minutes: 20\n',
      '    timeout-minutes : 120\n    timeout-minutes: 20\n'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((e) =>
      e.includes('Noncanonical or duplicate CI timeout-minutes key')), changed);
  }
});

test('rejects BOM, CRLF and CR-only workflow encoding variants', () => {
  for (const changed of [
    '\uFEFF' + good,
    good.replaceAll('\n', '\r\n'),
    good.replaceAll('\n', '\r'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((e) =>
      e.includes('noncanonical control character')));
  }
});

test('rejects invisible control bytes inserted into YAML mapping lines', () => {
  for (const control of ['\u0000', '\u0008', '\u000c', '\u001b', '\u007f']) {
    const changed = good.replace('    steps:', '    steps:' + control);
    assert.ok(checkCiActionPins(changed).some((e) =>
      e.includes('noncanonical control character')));
  }
  assert.equal(checkCiActionPins(good).some((e) =>
    e.includes('noncanonical control character')), false);
});

// Quoted Action-input mappings are semantically equivalent YAML keys.
// A second quoted "with" must not override the reviewed input map.
test('rejects quoted Action input mapping keys, including shadow maps', () => {
  for (const key of ["'with':", '"with":']) {
    const shadow = good.replace(
      '          persist-credentials: false',
      '          persist-credentials: false\n        ' + key + '\n          persist-credentials: true',
    );
    assert.ok(checkCiActionPins(shadow).some((error) => error.includes('Quoted CI security key')), key);
    const replacement = good.replace('        with:', '        ' + key);
    assert.ok(checkCiActionPins(replacement).some((error) => error.includes('Quoted CI security key')), key);
  }
});

// YAML explicit-key indicators are another way to spell a mapping key.
test('rejects explicit YAML mapping keys in job and action configuration', () => {
  for (const changed of [
    good.replace('    runs-on: ubuntu-24.04',
      '    ? runs-on\\n    : self-hosted\\n    runs-on: ubuntu-24.04'),
    good.replace('        with:\\n          node-version: 22',
      '        ? with\\n        : { node-version: 99 }\\n        with:\\n          node-version: 22'),
    good.replace('jobs:\\n', '? jobs\\n: {}\\njobs:\\n'),
  ]) {
    assert.ok(checkCiActionPins(changed).some((error) =>
      error.includes('explicit mapping key indicator')));
  }
  assert.deepEqual(checkCiActionPins(good), []);
});

test('explicit-key check allows blank lines, comments and ordinary query-mark text', () => {
  const harmless = good.replace('on:\\n',
    'on:\\n\\n  # ? question in a comment\\n');
  assert.deepEqual(checkCiActionPins(harmless), []);
  assert.deepEqual(checkCiActionPins(good), []);
});

// A failed checkout map must not force a pathological backtracking search.
test('checkout validation fails promptly on long or missing credential maps', () => {
  const padding = '          unrelated: value\\n'.repeat(1500);
  const mutated = good.replace('          persist-credentials: false', padding + '          persist-credentials: true');
  const start = performance.now();
  assert.ok(checkCiActionPins(mutated).some((error) =>
    error.includes('Checkout must set persist-credentials: false')));
  assert.ok(performance.now() - start < 2500, 'checkout scanner should remain bounded');
});
