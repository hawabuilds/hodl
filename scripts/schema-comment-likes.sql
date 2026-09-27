-- Likes on comments.
-- Additive. Safe to re-run. Paste into the Supabase SQL editor.
--
-- One row per person per comment, so the primary key is the uniqueness rule
-- rather than something the application has to remember to enforce: liking
-- twice is an upsert that changes nothing, and the count is always a count of
-- distinct people.
--
-- Deleting a comment takes its likes with it.
--
-- Note for anyone embedding users on comments: this table gives PostgREST a
-- second path from comments to users (comments -> comment_likes -> users), so
-- a bare `users(...)` embed becomes ambiguous and returns PGRST201. Name the
-- foreign key — `users!comments_user_id_fkey(...)` — as social-live.ts does.

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- Counting a comment's likes, and answering "did this person like it", both
-- read by comment_id; the primary key already covers that prefix. This index
-- is for the other direction — everything one person liked.
CREATE INDEX IF NOT EXISTS comment_likes_user_id
  ON comment_likes (user_id, created_at DESC);

ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
