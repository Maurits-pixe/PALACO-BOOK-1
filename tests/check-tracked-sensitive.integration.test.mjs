import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/check-tracked-sensitive.mjs');

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function temporaryRepository(callback) {
  const dir = mkdtempSync(join(tmpdir(), 'palaco-book-gate-'));
  try {
    git(dir, 'init', '-q');
    return callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('git index gate accepts tracked regular files and template examples', () => {
  temporaryRepository((dir) => {
    writeFileSync(join(dir, '.env.example'), 'PLACEHOLDER=example\n');
    writeFileSync(join(dir, 'README.md'), 'Test fixture\n');
    git(dir, 'add', '--', '.env.example', 'README.md');
    const run = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Sensitive-file gate PASS/);
  });
});

test('git index gate rejects tracked credentials without leaking contents', () => {
  temporaryRepository((dir) => {
    const marker = 'PRIVATE_MARKER_NOT_FOR_LOGS';
    writeFileSync(join(dir, '.env.local'), marker);
    git(dir, 'add', '--', '.env.local');
    const run = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /\.env\.local/);
    assert.doesNotMatch(run.stderr + run.stdout, /PRIVATE_MARKER_NOT_FOR_LOGS/);
  });
});

test('git index gate rejects tracked SQLite sidecar files', () => {
  temporaryRepository((dir) => {
    mkdirSync(join(dir, 'data'));
    writeFileSync(join(dir, 'data', 'app.db-wal'), 'not a real database');
    git(dir, 'add', '--', 'data/app.db-wal');
    const run = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /app\.db-wal/);
  });
});

test('git index gate fails closed outside a git working tree', () => {
  temporaryRepository((dir) => {
    const nongit = join(dir, 'outside');
    mkdirSync(nongit);
    const run = spawnSync(process.execPath, [script], { cwd: nongit, encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /could not enumerate the Git index/);
  });
});
