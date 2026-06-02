-- 0006_anon_submission.sql
-- Enables unauthenticated doodie submissions from the public mockup flow.

-- Fixed sentinel user that owns all anonymous submissions.
-- The zero UUID is never surfaced in the UI or API.
INSERT OR IGNORE INTO "user" (id, name, email, emailVerified, status)
VALUES ('00000000-0000-0000-0000-000000000000',
        'Anonymous', 'anonymous@civicdoodie.internal', 1, 'active');

-- Self-reported display name supplied at submission time.
-- NULL means the doodie was filed by a real authenticated user account.
ALTER TABLE doodie ADD COLUMN reporter_name TEXT;
