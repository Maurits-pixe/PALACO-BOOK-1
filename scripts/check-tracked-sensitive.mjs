#!/usr/bin/env node
// Prevent accidental tracking of local credentials and persistent databases.
// No third-party dependencies. This gate inspects the Git index, not the
// working directory, and never prints file contents.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export function isSensitiveTrackedPath(path) {
  const name = basename(path.replaceAll('\\', '/')).toLowerCase();
  if (name === '.env.example' || name === '.env.sample') return false;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)(?:-(?:wal|shm|journal))?$/i.test(name)) return true;
  return false;
}

export function findSensitivePaths(paths) {
  return paths.filter(isSensitiveTrackedPath).sort();
}

export function main() {
  let output;
  try {
    output = execFileSync('git', ['ls-files', '--cached', '-z'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    console.error('Sensitive file check could not enumerate the Git index.');
    return 2;
  }
  const paths = output.split('\0').filter(Boolean);
  const violations = findSensitivePaths(paths);
  if (violations.length > 0) {
    console.error('Blocked tracked sensitive file paths:');
    for (const path of violations) console.error(` - ${path}`);
    console.error('Remove from Git tracking and assess any prior exposure.');
    return 1;
  }
  console.log(`Sensitive-file gate PASS (${paths.length} tracked paths checked)`);
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = main();
}
