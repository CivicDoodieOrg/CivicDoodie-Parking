-- 0009_karma_events.sql
-- Append-only karma/points ledger. This is the SOURCE OF TRUTH for points:
-- user.brownie_points becomes a denormalised cache equal to
-- SUM(karma_event.points) for that user, recomputed after every award.
--
-- Mirrors the doodie_audit philosophy (append-only, FK to user with SET NULL
-- semantics avoided here because a deleted user's points are meaningless — we
-- CASCADE instead so the ledger doesn't outlive its owner).
--
-- The unique partial index on (user_id, dedup_key) makes every award idempotent:
-- fix-awards fire exactly once per (user, doodie) whether triggered by an
-- auditor PATCH or a clean re-check, and novel clean-checks can't be farmed.

CREATE TABLE IF NOT EXISTS karma_event (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  action     TEXT NOT NULL,          -- report | first_report | report_fixed | first_report_fixed | clean_check | clean_recheck_fix | milestone | admin_adjust
  points     INTEGER NOT NULL,
  doodie_id  TEXT,                    -- nullable; related doodie when applicable
  dedup_key  TEXT,                    -- nullable; unique guard against double-award
  details    TEXT,                    -- JSON (milestone track/level, admin reason, fix from/to)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)   REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_karma_user_action  ON karma_event(user_id, action);
CREATE INDEX IF NOT EXISTS idx_karma_user_created ON karma_event(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_karma_dedup ON karma_event(user_id, dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Backfill: preserve any pre-existing nonzero brownie_points as a legacy ledger
-- row so the SUM-based cache stays authoritative from migration onward.
INSERT INTO karma_event (id, user_id, action, points, dedup_key, details)
  SELECT lower(hex(randomblob(16))), id, 'admin_adjust', brownie_points,
         'legacy_backfill', '{"legacy":true}'
  FROM "user" WHERE brownie_points <> 0;
