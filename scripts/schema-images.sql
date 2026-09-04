-- Additive. Safe to re-run. Paste into the Supabase SQL editor.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_source text;
