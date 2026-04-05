-- Phase 2: Create salespersons and bill_salespersons tables (D-12 / SCHEMA-02)
-- Run manually in Supabase SQL Editor

CREATE TABLE salespersons (
  salesperson_id serial PRIMARY KEY,
  name text NOT NULL,
  date_hired date,
  active boolean DEFAULT true
);

CREATE TABLE bill_salespersons (
  billid integer REFERENCES bills(billid) ON DELETE CASCADE,
  salesperson_id integer REFERENCES salespersons(salesperson_id),
  PRIMARY KEY (billid, salesperson_id)
);
