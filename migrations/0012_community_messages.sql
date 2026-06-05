-- 0012_community_messages.sql
-- Global community message board. body is stored ALREADY censored;
-- flagged=1 marks messages that tripped the banned-word filter, so offending
-- users are identifiable via (user_id, flagged).
CREATE TABLE IF NOT EXISTS community_message (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  flagged     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_community_message_created ON community_message(created_at);
