-- Add role column to distinguish normal users from auditors and admins.
-- Auditors can update fix_state on any doodie (the audit page).
-- Admins retain full moderation rights (moderation_status, etc.).
-- Default is 'user'. The ADMIN_USER_IDS env var still works as an
-- additional admin check in the application layer.

ALTER TABLE "user" ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
