-- 0006_anonymous_reporting.sql
-- Allow anonymous (unauthenticated) Doodie submissions.
-- SQLite cannot ALTER a column constraint, so we recreate the doodie table
-- with reporter_id nullable and ON DELETE SET NULL instead of CASCADE.

PRAGMA foreign_keys = OFF;

CREATE TABLE doodie_new (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL,
  town_id           TEXT NOT NULL,
  reporter_id       TEXT,            -- NULL = anonymous submission
  type              TEXT NOT NULL CHECK (type IN ('enforcement', 'meter', 'garage')),
  description       TEXT NOT NULL DEFAULT '',
  disability_related INTEGER NOT NULL DEFAULT 0,
  lat               REAL,
  lng               REAL,
  upvotes_count     INTEGER NOT NULL DEFAULT 0,
  downvotes_count   INTEGER NOT NULL DEFAULT 0,
  comments_count    INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'flagged', 'removed')),
  reporter_ip       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  report_count      INTEGER NOT NULL DEFAULT 1,
  last_reported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  fix_state         TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (fix_state IN ('unresolved', 'investigating', 'resolved_unconfirmed')),
  reporter_name TEXT,
  FOREIGN KEY (town_id)    REFERENCES town(id)   ON DELETE CASCADE,
  FOREIGN KEY (reporter_id) REFERENCES "user"(id) ON DELETE SET NULL,
  UNIQUE(town_id, slug)
);

INSERT INTO doodie_new SELECT * FROM doodie;
DROP TABLE doodie;
ALTER TABLE doodie_new RENAME TO doodie;

CREATE INDEX IF NOT EXISTS idx_doodie_town_recent   ON doodie(town_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_town_top      ON doodie(town_id, upvotes_count DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_reporter      ON doodie(reporter_id);
CREATE INDEX IF NOT EXISTS idx_doodie_moderation    ON doodie(moderation_status);
CREATE INDEX IF NOT EXISTS idx_doodie_town_type     ON doodie(town_id, type);
CREATE INDEX IF NOT EXISTS idx_doodie_last_reported ON doodie(town_id, last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_fix_state     ON doodie(town_id, fix_state);

PRAGMA foreign_keys = ON;
