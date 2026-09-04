-- Token PFPs are normalized at index time into Supabase Storage.
-- Safe to re-run. Paste into the Supabase SQL editor.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_64 text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_128 text;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_color text;

-- Public bucket for the 64/128 WebP pair. The indexer uploads; the feed only reads.
-- Uploads set Cache-Control: 31536000, immutable so tab switches reuse the file.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'token-images',
  'token-images',
  true,
  524288,
  ARRAY['image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 524288,
    allowed_mime_types = ARRAY['image/webp'];

DROP POLICY IF EXISTS "token-images public read" ON storage.objects;
CREATE POLICY "token-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'token-images');
