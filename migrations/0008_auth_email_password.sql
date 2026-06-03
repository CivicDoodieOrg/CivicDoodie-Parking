-- 0008_auth_email_password.sql
-- Adds role column for user/auditor distinction.
-- All existing rows default to 'user'.
ALTER TABLE "user" ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'auditor'));
