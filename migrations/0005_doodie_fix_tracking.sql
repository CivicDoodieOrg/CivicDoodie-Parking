-- 0005_doodie_fix_tracking.sql
-- Adds three fields that track the community-reported lifecycle of a Doodie:
--   report_count      — how many times users have filed this same issue
--   last_reported_at  — when it was most recently filed (for "X days ago" display)
--   fix_state         — real-world resolution status, independent of content moderation

ALTER TABLE doodie ADD COLUMN report_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE doodie ADD COLUMN last_reported_at TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE doodie ADD COLUMN fix_state TEXT NOT NULL DEFAULT 'unresolved'
  CHECK (fix_state IN ('unresolved', 'investigating', 'resolved_unconfirmed'));

CREATE INDEX IF NOT EXISTS idx_doodie_last_reported ON doodie(town_id, last_reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_fix_state ON doodie(town_id, fix_state);

-- Tracks which users have re-reported a Doodie (one row per user per doodie)
-- so report_count cannot be inflated by the same person filing repeatedly.
CREATE TABLE IF NOT EXISTS doodie_re_report (
  doodie_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doodie_id, user_id),
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)   REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doodie_re_report_user ON doodie_re_report(user_id);
