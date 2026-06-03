-- 0009_username.sql
-- Adds username support (better-auth username plugin).
-- `username` is the normalized (lowercased) unique login handle;
-- `displayUsername` preserves the original casing the user typed.
-- Existing rows get NULL username and keep signing in by email only.
-- SQLite allows multiple NULLs in a UNIQUE index, so the index is safe.
ALTER TABLE "user" ADD COLUMN username TEXT;
ALTER TABLE "user" ADD COLUMN displayUsername TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username ON "user"(username);
