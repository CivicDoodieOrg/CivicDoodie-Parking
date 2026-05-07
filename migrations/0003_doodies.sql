-- 0003_doodies.sql — Domain schema: Doodies, images, votes, comments, audit, reports.
-- A "Doodie" is a reported parking issue (enforcement, meter, or garage) scoped to a town.

-- ============================================================
-- Doodie (the reported issue)
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  town_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('enforcement', 'meter', 'garage')),
  description TEXT NOT NULL DEFAULT '',
  disability_related INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  upvotes_count INTEGER NOT NULL DEFAULT 0,
  downvotes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  moderation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'flagged', 'removed')),
  reporter_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (town_id) REFERENCES town(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_id) REFERENCES "user"(id) ON DELETE CASCADE,
  UNIQUE(town_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_doodie_town_recent ON doodie(town_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_town_top ON doodie(town_id, upvotes_count DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_reporter ON doodie(reporter_id);
CREATE INDEX IF NOT EXISTS idx_doodie_moderation ON doodie(moderation_status);
CREATE INDEX IF NOT EXISTS idx_doodie_town_type ON doodie(town_id, type);

-- ============================================================
-- Doodie images (max 4 per Doodie, position 0–3)
-- R2 object stored at doodies/{doodie_id}/{position}.{ext}; r2_key holds the full key.
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie_image (
  id TEXT PRIMARY KEY,
  doodie_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 3),
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE CASCADE,
  UNIQUE(doodie_id, position)
);

CREATE INDEX IF NOT EXISTS idx_doodie_image_doodie ON doodie_image(doodie_id);

-- ============================================================
-- Votes on Doodies (upvotes and downvotes tallied separately per spec)
-- One row per (doodie, user); switching vote updates vote_type, removing deletes the row.
-- doodie.upvotes_count / downvotes_count maintained by application code.
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie_vote (
  doodie_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doodie_id, user_id),
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doodie_vote_user ON doodie_vote(user_id);

-- ============================================================
-- Comments on Doodies
-- ip_address tracked per spec ("we track IP address for accountability").
-- censored=1 hides body from non-admins; row is preserved for audit.
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie_comment (
  id TEXT PRIMARY KEY,
  doodie_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  ip_address TEXT,
  upvotes_count INTEGER NOT NULL DEFAULT 0,
  downvotes_count INTEGER NOT NULL DEFAULT 0,
  censored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doodie_comment_doodie ON doodie_comment(doodie_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_comment_user ON doodie_comment(user_id);

-- ============================================================
-- Comment votes (same shape as doodie_vote)
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie_comment_vote (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id),
  FOREIGN KEY (comment_id) REFERENCES doodie_comment(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_doodie_comment_vote_user ON doodie_comment_vote(user_id);

-- ============================================================
-- Audit log (append-only)
-- Captures who did what to a Doodie: created, edited, deleted, censored,
-- approved, flagged, moderated. actor_id nullable so user-deletion preserves history.
-- ============================================================

CREATE TABLE IF NOT EXISTS doodie_audit (
  id TEXT PRIMARY KEY,
  doodie_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (doodie_id) REFERENCES doodie(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES "user"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_doodie_audit_doodie ON doodie_audit(doodie_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doodie_audit_actor ON doodie_audit(actor_id);

-- ============================================================
-- Reports (polymorphic — Doodie or Comment)
-- target_type + target_id pair instead of two FK columns to keep moderation
-- queue queries simple. App layer enforces target existence.
-- ============================================================

CREATE TABLE IF NOT EXISTS report (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('doodie', 'comment')),
  target_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_at TEXT,
  reviewer_notes TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (reporter_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_target ON report(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_report_status ON report(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_reporter ON report(reporter_id);
