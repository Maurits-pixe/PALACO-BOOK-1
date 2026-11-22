#!/usr/bin/env node
// Offline structural validation of a reviewed npm package-lock.json.
// No network calls and no claims about package authenticity.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const REGISTRY = 'registry.npmjs.org';

export function hasValidIntegrity(value) {
  if (typeof value !== 'string') return false;
  // npm Subresource Integrity tokens: enforce algorithm and decoded digest size.
  const tokens = value.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    const match = /^(sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    if (!match) return false;
    const decoded = Buffer.from(match[2], 'base64');
    const expected = match[1] === 'sha384' ? 48 : 64;
    return decoded.length === expected && decoded.toString('base64') === match[2];
  });
}

export function validateLockfile(manifest, lock) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      !lock || typeof lock !== 'object' || Array.isArray(lock)) {
    return ['Invalid package manifest or lockfile object'];
  }
  if (lock.lockfileVersion !== 3) errors.push('Expected npm lockfileVersion 3');
  if (!lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
    return [...errors, 'Missing lockfile packages map'].sort();
  }
  const root = lock.packages[''];
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    errors.push('Missing root package metadata');
  } else {
    if (root.name !== manifest.name || root.version !== manifest.version) {
      errors.push('Root package identity/version mismatch');
    }
    for (const section of SECTIONS) {
      const declared = manifest[section] ?? {};
      const locked = root[section] ?? {};
      if (JSON.stringify(Object.entries(declared).sort()) !== JSON.stringify(Object.entries(locked).sort())) {
        errors.push(`Root ${section} does not match package.json`);
      }
    }
  }
  // A matching root declaration alone is insufficient: all direct packages
  // must also be represented in the dependency tree.
  for (const section of SECTIONS) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (!Object.hasOwn(lock.packages, `node_modules/${dependency}`)) {
        errors.push(`Missing direct package: ${dependency}`);
      }
    }
  }
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (name === '') continue;
    if (!name.startsWith('node_modules/') && !name.includes('/node_modules/')) {
      errors.push(`Unrecognized package location: ${name}`);
      continue;
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      errors.push(`Invalid package metadata: ${name}`);
      continue;
    }
    if (pkg.link === true || typeof pkg.version !== 'string' || !pkg.version) {
      errors.push(`Unpinned or linked package: ${name}`);
    }
    if (!hasValidIntegrity(pkg.integrity)) {
      errors.push(`Missing approved integrity checksum: ${name}`);
    }
    try {
      const url = new URL(pkg.resolved);
      if (url.protocol !== 'https:' || url.hostname !== REGISTRY ||
          url.username || url.password || url.port || url.hash) {
        errors.push(`Unapproved package origin: ${name}`);
      }
    } catch {
      errors.push(`Invalid package URL: ${name}`);
    }
  }
  // Confirm exact npm overrides were actually applied to every matching
  // package entry, including nested node_modules installations.
  const overrides = manifest.overrides ?? {};
  for (const [packageName, pinnedVersion] of Object.entries(overrides)) {
    const matching = Object.entries(lock.packages).filter(([path]) =>
      path !== '' && (path === `node_modules/${packageName}` ||
        path.endsWith(`/node_modules/${packageName}`)));
    if (matching.length === 0) {
      errors.push(`Unresolved override package: ${packageName}`);
    }
    for (const [path, entry] of matching) {
      if (entry?.version !== pinnedVersion) {
        errors.push(`Override version mismatch at ${path}`);
      }
    }
  }
  return errors.sort();
}

export function main() {
  let manifest, lock;
  try {
    manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));
  } catch {
    console.error('Lockfile verification requires readable package.json and package-lock.json');
    return 2;
  }
  const errors = validateLockfile(manifest, lock);
  if (errors.length) {
    console.error('Lockfile structural verification FAILED:');
    errors.forEach((error) => console.error(` - ${error}`));
    return 1;
  }
  console.log('Lockfile structural verification PASS (offline metadata only)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
