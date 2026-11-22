import test from 'node:test';
import assert from 'node:assert/strict';
import { findSensitivePaths, isSensitiveTrackedPath } from '../scripts/check-tracked-sensitive.mjs';

test('rejects sensitive environment and credential files', () => {
  for (const p of ['.env', '.env.local', 'config/.env.production', 'cert.pem', 'secrets/private.key', 'id.p12']) {
    assert.equal(isSensitiveTrackedPath(p), true, p);
  }
});

test('rejects local SQLite files and sidecars', () => {
  for (const p of ['data/app.db', 'cache/user.sqlite3', 'app.db-wal', 'data/app.sqlite-shm', 'x.db-journal']) {
    assert.equal(isSensitiveTrackedPath(p), true, p);
  }
});

test('allows documented templates, code and ordinary files', () => {
  for (const p of ['.env.example', 'examples/.env.sample', 'src/db.ts', 'SECURITY.md', 'docs/keys.md', 'scripts/readme.js']) {
    assert.equal(isSensitiveTrackedPath(p), false, p);
  }
});

test('produces stable, sorted violations', () => {
  assert.deepEqual(findSensitivePaths(['safe.txt', 'z.db', 'a/.env', 'a/.env.example']), ['a/.env', 'z.db']);
});

test('rejects package registry token configurations and common SSH key names', () => {
  for (const p of ['.npmrc', 'config/.pypirc', 'home/id_rsa', 'ssh/id_ed25519', 'ssh/id_ed25519.pub']) {
    assert.equal(isSensitiveTrackedPath(p), true, p);
  }
});

test('rejects cloud credential JSON filenames but accepts normal JSON', () => {
  for (const p of ['credentials.json', 'secrets/service-account.json', 'config/service_account-prod.json']) {
    assert.equal(isSensitiveTrackedPath(p), true, p);
  }
  for (const p of ['package.json', 'tsconfig.json', 'fixtures/example.json']) {
    assert.equal(isSensitiveTrackedPath(p), false, p);
  }
});
