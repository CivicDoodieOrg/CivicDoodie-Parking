-- 0002_towns.sql — Town entity + initial seed
-- Predefined seed list per Phase 1 product decision; expanded later via admin UI
-- or follow-up migrations. Seed IDs use the slug for stable references.

CREATE TABLE IF NOT EXISTS town (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  state_or_region TEXT,
  country TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_town_country_state ON town(country, state_or_region);

-- Seed: ~50 US municipalities (top metros + a handful of dense college towns
-- where parking is a recurring civic concern).
INSERT INTO town (id, slug, name, state_or_region, country, lat, lng) VALUES
  ('new-york-ny',       'new-york-ny',       'New York',          'NY', 'US', 40.7128,  -74.0060),
  ('los-angeles-ca',    'los-angeles-ca',    'Los Angeles',       'CA', 'US', 34.0522, -118.2437),
  ('chicago-il',        'chicago-il',        'Chicago',           'IL', 'US', 41.8781,  -87.6298),
  ('houston-tx',        'houston-tx',        'Houston',           'TX', 'US', 29.7604,  -95.3698),
  ('phoenix-az',        'phoenix-az',        'Phoenix',           'AZ', 'US', 33.4484, -112.0740),
  ('philadelphia-pa',   'philadelphia-pa',   'Philadelphia',      'PA', 'US', 39.9526,  -75.1652),
  ('san-antonio-tx',    'san-antonio-tx',    'San Antonio',       'TX', 'US', 29.4241,  -98.4936),
  ('san-diego-ca',      'san-diego-ca',      'San Diego',         'CA', 'US', 32.7157, -117.1611),
  ('dallas-tx',         'dallas-tx',         'Dallas',            'TX', 'US', 32.7767,  -96.7970),
  ('san-jose-ca',       'san-jose-ca',       'San Jose',          'CA', 'US', 37.3382, -121.8863),
  ('austin-tx',         'austin-tx',         'Austin',            'TX', 'US', 30.2672,  -97.7431),
  ('jacksonville-fl',   'jacksonville-fl',   'Jacksonville',      'FL', 'US', 30.3322,  -81.6557),
  ('fort-worth-tx',     'fort-worth-tx',     'Fort Worth',        'TX', 'US', 32.7555,  -97.3308),
  ('columbus-oh',       'columbus-oh',       'Columbus',          'OH', 'US', 39.9612,  -82.9988),
  ('indianapolis-in',   'indianapolis-in',   'Indianapolis',      'IN', 'US', 39.7684,  -86.1581),
  ('charlotte-nc',      'charlotte-nc',      'Charlotte',         'NC', 'US', 35.2271,  -80.8431),
  ('san-francisco-ca',  'san-francisco-ca',  'San Francisco',     'CA', 'US', 37.7749, -122.4194),
  ('seattle-wa',        'seattle-wa',        'Seattle',           'WA', 'US', 47.6062, -122.3321),
  ('denver-co',         'denver-co',         'Denver',            'CO', 'US', 39.7392, -104.9903),
  ('washington-dc',     'washington-dc',     'Washington',        'DC', 'US', 38.9072,  -77.0369),
  ('nashville-tn',      'nashville-tn',      'Nashville',         'TN', 'US', 36.1627,  -86.7816),
  ('oklahoma-city-ok',  'oklahoma-city-ok',  'Oklahoma City',     'OK', 'US', 35.4676,  -97.5164),
  ('el-paso-tx',        'el-paso-tx',        'El Paso',           'TX', 'US', 31.7619, -106.4850),
  ('boston-ma',         'boston-ma',         'Boston',            'MA', 'US', 42.3601,  -71.0589),
  ('portland-or',       'portland-or',       'Portland',          'OR', 'US', 45.5152, -122.6784),
  ('las-vegas-nv',      'las-vegas-nv',      'Las Vegas',         'NV', 'US', 36.1699, -115.1398),
  ('detroit-mi',        'detroit-mi',        'Detroit',           'MI', 'US', 42.3314,  -83.0458),
  ('memphis-tn',        'memphis-tn',        'Memphis',           'TN', 'US', 35.1495,  -90.0490),
  ('louisville-ky',     'louisville-ky',     'Louisville',        'KY', 'US', 38.2527,  -85.7585),
  ('baltimore-md',      'baltimore-md',      'Baltimore',         'MD', 'US', 39.2904,  -76.6122),
  ('milwaukee-wi',      'milwaukee-wi',      'Milwaukee',         'WI', 'US', 43.0389,  -87.9065),
  ('albuquerque-nm',    'albuquerque-nm',    'Albuquerque',       'NM', 'US', 35.0844, -106.6504),
  ('tucson-az',         'tucson-az',         'Tucson',            'AZ', 'US', 32.2226, -110.9747),
  ('fresno-ca',         'fresno-ca',         'Fresno',            'CA', 'US', 36.7378, -119.7871),
  ('sacramento-ca',     'sacramento-ca',     'Sacramento',        'CA', 'US', 38.5816, -121.4944),
  ('kansas-city-mo',    'kansas-city-mo',    'Kansas City',       'MO', 'US', 39.0997,  -94.5786),
  ('atlanta-ga',        'atlanta-ga',        'Atlanta',           'GA', 'US', 33.7490,  -84.3880),
  ('omaha-ne',          'omaha-ne',          'Omaha',             'NE', 'US', 41.2565,  -95.9345),
  ('colorado-springs-co','colorado-springs-co','Colorado Springs','CO', 'US', 38.8339, -104.8214),
  ('raleigh-nc',        'raleigh-nc',        'Raleigh',           'NC', 'US', 35.7796,  -78.6382),
  ('long-beach-ca',     'long-beach-ca',     'Long Beach',        'CA', 'US', 33.7701, -118.1937),
  ('virginia-beach-va', 'virginia-beach-va', 'Virginia Beach',    'VA', 'US', 36.8529,  -75.9780),
  ('miami-fl',          'miami-fl',          'Miami',             'FL', 'US', 25.7617,  -80.1918),
  ('oakland-ca',        'oakland-ca',        'Oakland',           'CA', 'US', 37.8044, -122.2712),
  ('minneapolis-mn',    'minneapolis-mn',    'Minneapolis',       'MN', 'US', 44.9778,  -93.2650),
  -- Dense college / inner-suburb towns where parking issues are persistent
  ('cambridge-ma',      'cambridge-ma',      'Cambridge',         'MA', 'US', 42.3736,  -71.1097),
  ('berkeley-ca',       'berkeley-ca',       'Berkeley',          'CA', 'US', 37.8716, -122.2728),
  ('ann-arbor-mi',      'ann-arbor-mi',      'Ann Arbor',         'MI', 'US', 42.2808,  -83.7430),
  ('madison-wi',        'madison-wi',        'Madison',           'WI', 'US', 43.0731,  -89.4012),
  ('providence-ri',     'providence-ri',     'Providence',        'RI', 'US', 41.8240,  -71.4128),
  ('brookline-ma',      'brookline-ma',      'Brookline',         'MA', 'US', 42.3318,  -71.1212),
  ('somerville-ma',     'somerville-ma',     'Somerville',        'MA', 'US', 42.3876,  -71.0995);
