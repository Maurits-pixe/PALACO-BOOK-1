import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDependencySources } from '../scripts/check-dependency-sources.mjs';

test('accepts standard semver dependency declarations', () => {
  assert.deepEqual(validateDependencySources({
    dependencies: { next: '^15.5.0', react: '^19.1.0' },
    devDependencies: { typescript: '~5.9.0' },
  }), []);
});

test('rejects Git, remote URL, local path and npm alias sources', () => {
  const unsafe = ['git+ssh://host/repo', 'git@host:repo', 'github:owner/repo', 'https://host/tarball.tgz', 'file:../local', 'link:../local', 'workspace:*', 'npm:other@1.0.0'];
  for (const spec of unsafe) {
    assert.equal(validateDependencySources({ dependencies: { package: spec } }).length, 1, spec);
  }
});

test('checks every supported dependency section', () => {
  const m = { optionalDependencies: { a: 'file:../a' }, peerDependencies: { b: 'git+https://example/repo' } };
  assert.equal(validateDependencySources(m).length, 2);
});

test('rejects malformed dependency sections and empty specs', () => {
  assert.equal(validateDependencySources({ dependencies: [] }).length, 1);
  assert.equal(validateDependencySources({ devDependencies: { typescript: '' } }).length, 1);
  assert.equal(validateDependencySources(null).length, 1);
});
