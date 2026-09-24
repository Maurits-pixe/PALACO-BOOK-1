PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sources(
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  uri TEXT NOT NULL,
  title TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(id,version)
);
CREATE TABLE IF NOT EXISTS provenance_records(
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL REFERENCES knowledge_objects(id),
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id,source_version) REFERENCES sources(id,version)
);
CREATE INDEX IF NOT EXISTS idx_provenance_knowledge ON provenance_records(knowledge_id,created_at);
