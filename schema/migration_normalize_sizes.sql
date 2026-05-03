-- Migration: Normalize size data in productsizecolors
-- Creates canonical sizes reference table and cleans up dirty size strings.

-- ============================================================
-- 1. SIZES REFERENCE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS sizes (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  size_type  TEXT NOT NULL CHECK (size_type IN ('letter','chest','waist','kids','kids_letter','special')),
  numeric_in INTEGER,   -- inch equivalent for letter sizes; null for special/kids
  sort_order INTEGER NOT NULL
);

INSERT INTO sizes (code, label, size_type, numeric_in, sort_order) VALUES
  -- Letter sizes (S/M/L system, chest-based)
  ('XS',           'X Small',       'letter',      34,   10),
  ('S',            'Small',         'letter',      36,   20),
  ('M',            'Medium',        'letter',      38,   30),
  ('L',            'Large',         'letter',      40,   40),
  ('XL',           'X Large',       'letter',      42,   50),
  ('2XL',          '2X Large',      'letter',      44,   60),
  ('3XL',          '3X Large',      'letter',      46,   70),
  ('4XL',          '4X Large',      'letter',      48,   80),
  ('5XL',          '5X Large',      'letter',      50,   90),
  ('6XL',          '6X Large',      'letter',      52,  100),
  ('7XL',          '7X Large',      'letter',      54,  110),

  -- Chest numeric sizes (tops labeled by supplier in inches)
  ('36',           '36',            'chest',       36,  120),
  ('38',           '38',            'chest',       38,  130),
  ('40',           '40',            'chest',       40,  140),
  ('42',           '42',            'chest',       42,  150),
  ('44',           '44',            'chest',       44,  160),

  -- Waist numeric sizes (bottoms/trousers)
  ('28',           '28',            'waist',       28,  170),
  ('30',           '30',            'waist',       30,  180),
  ('32',           '32',            'waist',       32,  190),
  ('34',           '34',            'waist',       34,  200),

  -- Kids numeric sizes
  ('1',            '1',             'kids',  NULL,  210),
  ('2',            '2',             'kids',  NULL,  220),
  ('3',            '3',             'kids',  NULL,  230),
  ('4',            '4',             'kids',  NULL,  240),
  ('5',            '5',             'kids',  NULL,  250),
  ('6',            '6',             'kids',  NULL,  260),
  ('7',            '7',             'kids',  NULL,  270),
  ('8',            '8',             'kids',  NULL,  280),
  ('9',            '9',             'kids',  NULL,  290),
  ('10',           '10',            'kids',  NULL,  300),
  ('11',           '11',            'kids',  NULL,  310),
  ('12',           '12',            'kids',  NULL,  320),
  ('13',           '13',            'kids',  NULL,  330),
  ('14',           '14',            'kids',  NULL,  340),
  ('16',           '16',            'kids',  NULL,  350),

  -- Kids letter sizes (size 0)
  ('S(0)',          'Small (0)',     'kids_letter', NULL, 360),
  ('M(0)',          'Medium (0)',    'kids_letter', NULL, 370),
  ('L(0)',          'Large (0)',     'kids_letter', NULL, 380),

  -- Special / non-fitted
  ('FREE',          'Free Size',    'special', NULL, 400),
  ('UNSTITCHED',    'Unstitched',   'special', NULL, 410),
  ('SEMI-STITCHED', 'Semi-stitched','special', NULL, 420)

ON CONFLICT (code) DO NOTHING;
