#!/usr/bin/env node
// Check manifest dependency sources before npm installs anything.
// This guard does not assert that package resolution is reproducible.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const FORBIDDEN = /^(?:https?:|git(?:\+[^:]+)?:|git@|github:|gitlab:|bitbucket:|file:|link:|workspace:|npm:)/i;

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
      if (typeof spec !== 'string' || !spec.trim()) {
        errors.push(`${section}.${name}: missing or invalid version specifier`);
      } else if (FORBIDDEN.test(spec.trim())) {
        errors.push(`${section}.${name}: disallowed dependency source`);
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
  console.log('Dependency source check PASS (direct manifest sources only)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
