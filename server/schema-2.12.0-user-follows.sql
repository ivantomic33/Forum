-- ============================================================================
-- 2.12.0 — PRAĆENJE KORISNIKA (FOLLOW)
-- ============================================================================
-- Deo `schema-ALL.sql`; ovaj fajl je za baze koje su već puštene ranije.
-- Idempotentno je — bezbedno ga je pokrenuti više puta.
-- ============================================================================
-- Jedan red = jedan vez: `follower_id` prati `following_id`.
--   * UNIQUE par — duplikat „zaprati“ ne pravi dva reda (idempotentno),
--   * `ON DELETE CASCADE` obe strane — brisanje naloga (GDPR) čisti vezove,
--   * CHECK zabranjuje samopraćenje.
-- RLS je deny-by-default; server ide kroz service_role.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_follows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT user_follows_no_self CHECK (follower_id <> following_id),
  CONSTRAINT user_follows_pair UNIQUE (follower_id, following_id)
);

-- „Koga X prati“ — lista pratioca profila i feed praćenih autora.
CREATE INDEX IF NOT EXISTS idx_user_follows_follower
  ON user_follows (follower_id, created_at DESC);
-- „Ko prati X“ — brojač pratilaca na profilu (COUNT po indeksu).
CREATE INDEX IF NOT EXISTS idx_user_follows_following
  ON user_follows (following_id, created_at DESC);

-- ---------- RLS (deny-by-default; service_role zaobilazi) ----------
ALTER TABLE user_follows ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Provera posle puštanja:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname='public' AND tablename IN ('user_follows');
