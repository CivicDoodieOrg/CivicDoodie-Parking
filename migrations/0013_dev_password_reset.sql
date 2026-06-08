-- 0013_dev_password_reset.sql
-- DEV ONLY: stores password-reset tokens so a localhost endpoint can show the
-- "reset code" on screen (the app has no email service yet). In production,
-- sendResetPassword emails the token instead and the dev endpoint is disabled.
CREATE TABLE IF NOT EXISTS dev_password_reset (
  email      TEXT NOT NULL,
  token      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dev_password_reset_email ON dev_password_reset(email, created_at);
