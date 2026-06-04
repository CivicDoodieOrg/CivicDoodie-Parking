-- 0010_user_name_fields.sql
-- Store the first/last name collected at sign-up. (city, state_or_region and
-- country columns already exist from 0001_init.sql.) All nullable so the
-- Google OAuth sign-up path, which doesn't collect these, is unaffected.
ALTER TABLE "user" ADD COLUMN first_name TEXT;
ALTER TABLE "user" ADD COLUMN last_name TEXT;
