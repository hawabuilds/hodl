-- Portfolio allocation targets (Portfolio → Allocation). Safe to re-run.
--
-- One row per user: their target weight for each holding, as a JSON map of
-- "token:0x…" / "rwa:nvda" → percent (0–100, summing to 100).
--
-- The app reads and writes this with the service role and checks the caller
-- itself. RLS is on so nothing else can: anon sees nothing, and a signed-in
-- user token (Privy DID in `sub`) can only read and change its own row.

CREATE TABLE IF NOT EXISTS allocation_targets (
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  targets    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(targets) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE allocation_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allocation_targets own read" ON allocation_targets;
CREATE POLICY "allocation_targets own read" ON allocation_targets
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "allocation_targets own insert" ON allocation_targets;
CREATE POLICY "allocation_targets own insert" ON allocation_targets
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "allocation_targets own update" ON allocation_targets;
CREATE POLICY "allocation_targets own update" ON allocation_targets
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'))
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

DROP POLICY IF EXISTS "allocation_targets own delete" ON allocation_targets;
CREATE POLICY "allocation_targets own delete" ON allocation_targets
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));
