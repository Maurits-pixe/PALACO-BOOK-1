PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS source_states(
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK(source_version>0),
  state_version INTEGER NOT NULL CHECK(state_version>0),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  replacement_source_version INTEGER,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  supersedes_state_version INTEGER,
  PRIMARY KEY(source_id,source_version,state_version),
  FOREIGN KEY(source_id,source_version) REFERENCES sources(id,version),
  FOREIGN KEY(source_id,replacement_source_version) REFERENCES sources(id,version)
);

INSERT OR IGNORE INTO source_states(
  source_id,source_version,state_version,status,replacement_source_version,reason,created_at,actor,supersedes_state_version
)
SELECT id,version,1,'ACTIVE',NULL,'MIGRATED_EXISTING_SOURCE',created_at,'MIGRATION',NULL
FROM sources;

CREATE TRIGGER IF NOT EXISTS source_states_capture_source
AFTER INSERT ON sources
BEGIN
  INSERT OR IGNORE INTO source_states(
    source_id,source_version,state_version,status,replacement_source_version,reason,created_at,actor,supersedes_state_version
  ) VALUES(
    NEW.id,NEW.version,1,'ACTIVE',NULL,'SOURCE_REGISTERED',NEW.created_at,'RUNTIME',NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS source_states_no_update
BEFORE UPDATE ON source_states
BEGIN SELECT RAISE(ABORT,'SOURCE_STATE_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS source_states_no_delete
BEFORE DELETE ON source_states
BEGIN SELECT RAISE(ABORT,'SOURCE_STATE_APPEND_ONLY'); END;

CREATE INDEX IF NOT EXISTS idx_source_states_latest
ON source_states(source_id,source_version,state_version);

CREATE INDEX IF NOT EXISTS idx_source_states_status
ON source_states(status,created_at);
