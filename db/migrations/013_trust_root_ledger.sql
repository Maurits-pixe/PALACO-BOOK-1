PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS trust_root_keys(
  key_id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK(algorithm='Ed25519'),
  public_key_pem TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL UNIQUE,
  registered_at TEXT NOT NULL,
  actor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_root_key_events(
  epoch INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  status TEXT NOT NULL CHECK(status IN ('REGISTERED','TRUSTED','RETIRED','REVOKED')),
  effective_at TEXT NOT NULL,
  invalid_from TEXT,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_version INTEGER,
  UNIQUE(key_id,version),
  FOREIGN KEY(key_id) REFERENCES trust_root_keys(key_id),
  CHECK(
    (status='REVOKED' AND invalid_from IS NOT NULL)
    OR
    (status<>'REVOKED' AND invalid_from IS NULL)
  )
);

CREATE TRIGGER IF NOT EXISTS trust_root_keys_no_update
BEFORE UPDATE ON trust_root_keys
BEGIN SELECT RAISE(ABORT,'TRUST_ROOT_KEY_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS trust_root_keys_no_delete
BEFORE DELETE ON trust_root_keys
BEGIN SELECT RAISE(ABORT,'TRUST_ROOT_KEY_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS trust_root_key_events_no_update
BEFORE UPDATE ON trust_root_key_events
BEGIN SELECT RAISE(ABORT,'TRUST_ROOT_EVENT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS trust_root_key_events_no_delete
BEFORE DELETE ON trust_root_key_events
BEGIN SELECT RAISE(ABORT,'TRUST_ROOT_EVENT_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_trust_root_events_key
ON trust_root_key_events(key_id,version);

CREATE INDEX IF NOT EXISTS idx_trust_root_events_epoch
ON trust_root_key_events(epoch);

CREATE INDEX IF NOT EXISTS idx_trust_root_events_effective
ON trust_root_key_events(key_id,effective_at,epoch);
