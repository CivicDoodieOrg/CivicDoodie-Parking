-- 0004_screen_name_nocase.sql
-- Make screen_name uniqueness case-insensitive while preserving the user's
-- chosen display case in the column itself. Lookups can use COLLATE NOCASE
-- to hit this index.
--
-- The column-level UNIQUE constraint from 0001 stays in place — it's
-- case-sensitive and now strictly redundant (case-insensitive uniqueness
-- already implies case-sensitive uniqueness), but SQLite has no clean way
-- to drop a column-level constraint without recreating the table, and
-- "redundant tighter constraint" is harmless.

DROP INDEX IF EXISTS idx_user_screen_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_screen_name_ci
  ON "user"(screen_name COLLATE NOCASE);
