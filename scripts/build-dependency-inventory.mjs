#!/usr/bin/env node
// Deterministic dependency inventory from an already verified npm lockfile.
// This is dependency review evidence, not an SBOM certification or release gate.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateLockfile } from './verify-lockfile.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function buildDependencyInventory(manifest, bytes, checkoutSha) {
  if (!Buffer.isBuffer(bytes) || !/^[a-f0-9]{40}$/.test(checkoutSha ?? '')) {
    throw new Error('Missing exact lockfile bytes or checkout commit');
  }
  const lock = JSON.parse(bytes.toString('utf8'));
  const errors = validateLockfile(manifest, lock);
  if (errors.length > 0) throw new Error('Invalid npm lockfile: ' + errors[0]);
  const directNames = new Set(['dependencies','devDependencies','optionalDependencies','peerDependencies']
    .flatMap((section) => Object.keys(manifest[section] ?? {})));
  const rows = Object.entries(lock.packages)
    .filter(([location]) => location !== '')
    .map(([location, pkg]) => {
      const pieces = location.split('/node_modules/');
      const name = pieces[pieces.length - 1].replace(/^node_modules\//, '');
      if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        throw new Error('Invalid package name in lockfile inventory');
      }
      return {
        name,
        version: pkg.version,
        location,
        direct: location === `node_modules/${name}` && directNames.has(name),
        optional: pkg.optional === true,
      };
    }).sort((a, b) => a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version) || a.location.localeCompare(b.location));
  const versionsByName = new Map();
  for (const item of rows) {
    const versions = versionsByName.get(item.name) ?? new Set();
    versions.add(item.version);
    versionsByName.set(item.name, versions);
  }
  const multipleVersionPackages = [...versionsByName].filter(([, versions]) => versions.size > 1)
    .map(([name, versions]) => ({ name, versions: [...versions].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    schema: 'palaco.dependency-inventory.v1',
    git_checkout_sha: checkoutSha,
    lockfile_sha256: sha256(bytes),
    package_locations: rows.length,
    unique_package_names: versionsByName.size,
    multiple_version_packages: multipleVersionPackages,
    packages: rows,
    release_authorization: 'DENY',
  };
}

export function main() {
  try {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    const bytes = readFileSync(resolve('package-lock.json'));
    const sha = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
    const inventory = buildDependencyInventory(manifest, bytes, sha);
    writeFileSync(resolve('npm-dependency-inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
    console.log(`Dependency inventory: ${inventory.package_locations} locations, ${inventory.unique_package_names} distinct names, ${inventory.multiple_version_packages.length} multi-version packages`);
    console.log('Review-only evidence. Production authorization DENY.');
    return 0;
  } catch (error) {
    console.error('Dependency inventory FAILED:', error instanceof Error ? error.message : 'unknown failure');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
