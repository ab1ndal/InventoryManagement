-- Add contact person name and support for multiple phone numbers (e.g. landlines) on suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_person varchar;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS additional_phones text[] NOT NULL DEFAULT '{}';
