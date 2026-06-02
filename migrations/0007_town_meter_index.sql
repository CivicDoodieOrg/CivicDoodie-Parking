-- 0007_town_meter_index.sql
-- Composite index for per-town type breakdown queries filtered by moderation_status.
-- Column order: town_id (equality), type (group-by), moderation_status (filter).
-- The existing idx_doodie_town_type covers only (town_id, type); adding
-- moderation_status turns approved-only counts into a pure index scan.
CREATE INDEX IF NOT EXISTS idx_doodie_town_type_status
  ON doodie(town_id, type, moderation_status);
