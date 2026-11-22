#!/usr/bin/env node
// Allow only explicit registry semver specifications in direct dependencies.
// This is not a transitive dependency or lockfile integrity audit.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const VERSION = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const COMPARATOR = new RegExp(`^(?:\\^|~|>=|<=|>|<|=)?${VERSION}$`);

export function isRegistryVersionSpec(spec) {
  if (typeof spec !== 'string' || !spec.trim()) return false;
  return spec.trim().split(/\s*\|\|\s*/).every((range) => {
    const parts = range.trim().split(/\s+/);
    return parts.length > 0 && parts.every((part) => COMPARATOR.test(part));
  });
}

export function validateDependencySources(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['Manifest must be a JSON object'];
  }
  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (deps === undefined) continue;
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) {
      errors.push(`${section} must be an object`);
      continue;
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (!isRegistryVersionSpec(spec)) {
        errors.push(`${section}.${name}: expected explicit registry semver version/range`);
      }
    }
  }
  return errors.sort();
}

export function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
  } catch {
    console.error('Dependency source check: failed to read valid package.json');
    return 2;
  }
  const errors = validateDependencySources(manifest);
  if (errors.length > 0) {
    console.error('Dependency source check FAILED:');
    for (const error of errors) console.error(` - ${error}`);
    return 1;
  }
  console.log('Dependency source check PASS (direct registry semver sources only)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
