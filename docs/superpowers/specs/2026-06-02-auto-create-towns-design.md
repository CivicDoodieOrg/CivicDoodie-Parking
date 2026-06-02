# Auto-Create Towns + Doodie Index

**Date:** 2026-06-02  
**Files touched:** `mockups/civicdoodies.html`, `src/routes/doodies.ts`, `migrations/0007_town_meter_index.sql`

---

## Problem

Reports from cities not in the seed list (e.g. Greenwich CT) currently fail silently: the frontend picks the nearest existing town by geometric distance (usually a wrong city), and the backend 404s if a derived slug doesn't exist. There is also no composite index covering the `(town_id, type, moderation_status)` query pattern used for per-town type breakdowns.

---

## Solution Overview

1. Extract state abbreviation and country code from the already-fetched Nominatim response in `reverseGeocode()`.
2. Frontend computes the town slug directly from city + state abbreviation and passes town metadata as extra form fields.
3. Backend auto-creates the town row (INSERT OR IGNORE) when the slug is missing and valid creation fields are present, then proceeds with doodie insertion as normal.
4. New migration adds a composite index for the town × type × status aggregation query.

---

## Section 1 — `reverseGeocode()` extension (mockup only)

Nominatim already returns `ISO3166-2-lvl4` (e.g. `"US-CT"`) and `country_code` (e.g. `"us"`) in every response. The current function discards them. Add two fields to the return object:

```js
stateCode:   (a['ISO3166-2-lvl4'] || '').split('-').pop().toUpperCase(), // "US-CT" → "CT"
countryCode: (a.country_code || '').toUpperCase(),                        // "us" → "US"
```

`state.loc` gains `stateCode` and `countryCode` everywhere `reverseGeocode` is consumed (EXIF path and GPS path).

---

## Section 2 — Frontend town resolution (`submitReport`)

Slug helper (added once near the top of the script section):

```js
function toTownSlug(city, stateCode) {
  return (city + '-' + stateCode)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

Replace the `nearestTownSlug` call in `submitReport` with:

- **Happy path** (`state.loc.city` and `state.loc.stateCode` both non-empty): compute slug directly, no extra network call. Append five extra fields to FormData:
  - `town_city`, `town_state` (stateCode, e.g. "CT"), `town_country` (countryCode, e.g. "US"), `town_lat`, `town_lng`
- **Fallback** (city or stateCode missing, e.g. reverse-geocode failed): keep existing distance-based `nearestTownSlug` lookup; send no town creation fields.

---

## Section 3 — Backend auto-create (`src/routes/doodies.ts`)

In the `POST /` handler, after `loadTown` returns null and before returning 404:

1. Read `town_city`, `town_state`, `town_country`, `town_lat`, `town_lng` from multipart body.
2. Validate all five present; lat in [-90,90], lng in [-180,180]; city and state non-empty strings.
3. Recompute slug server-side using same formula (do not trust the URL slug alone):
   ```ts
   function townSlugFrom(city: string, state: string): string {
     return `${city}-${state}`
       .toLowerCase()
       .normalize('NFD').replace(/\p{M}/gu, '')
       .replace(/[^a-z0-9]+/g, '-')
       .replace(/^-|-$/g, '');
   }
   ```
4. `INSERT OR IGNORE INTO town (id, slug, name, state_or_region, country, lat, lng) VALUES (slug, slug, city, stateCode, countryCode, lat, lng)` — `OR IGNORE` handles races.
5. `loadTown` again by computed slug. If still null (insert failed for unexpected reason), return 404.
6. Continue with doodie insertion using the resolved town.

**No change to the URL structure.** The URL slug is still derived from the form fields, so existing town slugs continue to work exactly as before.

---

## Section 4 — Migration `migrations/0007_town_meter_index.sql`

```sql
-- 0007_town_meter_index.sql
-- Composite index for per-town type breakdown queries.
-- Column order: town_id (equality), type (group-by), moderation_status (filter).
-- The existing idx_doodie_town_type covers only (town_id, type); adding
-- moderation_status turns the approved-only count into a pure index scan.
CREATE INDEX IF NOT EXISTS idx_doodie_town_type_status
  ON doodie(town_id, type, moderation_status);
```

---

## Edge Cases

| Situation | Behaviour |
|---|---|
| Town already exists (race or second report from same city) | `INSERT OR IGNORE` is a no-op; `loadTown` returns the existing row |
| Reverse-geocode fails (offline, rate-limited) | Fallback to distance-based lookup; no auto-create |
| Non-US location (no 2-letter state code) | `stateCode` may be empty; fallback path used |
| Malformed lat/lng in form fields | Validation rejects; 400 returned |
| Frontend sends wrong slug in URL but valid town fields | Backend recomputes slug from fields, ignores URL slug for creation purposes |
