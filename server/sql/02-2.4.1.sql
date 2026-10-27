-- SEKCIJA: server/schema-2.4.1.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.4.1 — MIGRACIJA (odgovara aktuelnom backend adapteru)
-- Pokreni u Supabase SQL Editor-u posle server/schema.sql.
-- Idempotentna je; može se izvršiti više puta.
--
-- Backend koristi forum_threads.category_id i users lookup za autora.
-- NE dodavati duplirane subforum/author_name kolone.
-- Service role zaobilazi RLS; anon/authenticated nemaju public policies.
-- ============================================================

-- ---------- 1. NORMALIZOVANE KOLONE ----------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username_lower VARCHAR(30)
    GENERATED ALWAYS AS (lower(btrim(username))) STORED;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_lower VARCHAR(255)
    GENERATED ALWAYS AS (lower(btrim(email))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(username_lower);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower);

-- User profile extras — API ih čita/piše direktno kad su kolone dostupne.
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS connected_accounts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Schema baseline constrains vote_type to `upvote`/`downvote`; API koristi `up`/`down`.
ALTER TABLE forum_votes DROP CONSTRAINT IF EXISTS forum_votes_vote_type_check;
UPDATE forum_votes SET vote_type = 'up' WHERE vote_type = 'upvote';
UPDATE forum_votes SET vote_type = 'down' WHERE vote_type = 'downvote';
ALTER TABLE forum_votes ADD CONSTRAINT forum_votes_vote_type_check
  CHECK (vote_type IN ('up', 'down'));

-- ---------- 2. INDEKSI ZA LISTE ----------
CREATE INDEX IF NOT EXISTS idx_forum_threads_author_created
  ON forum_threads(author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_replies_author_created
  ON forum_replies(author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forum_threads_reply_at
  ON forum_threads(last_reply_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_users_karma_desc ON users(karma DESC);

-- ---------- 3. POKRETAČI ZA DENORMALIZOVANE BROJAČE ----------
-- reply_count se održava na nivou baze, ne u aplikaciji.
CREATE OR REPLACE FUNCTION sync_thread_reply_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE forum_threads
      SET reply_count = COALESCE(reply_count, 0) + 1,
          last_reply_at = GREATEST(COALESCE(last_reply_at, NEW.created_at), NEW.created_at)
      WHERE id = NEW.thread_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE forum_threads
      SET reply_count = GREATEST(COALESCE(reply_count, 1) - 1, 0)
      WHERE id = OLD.thread_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_forum_replies_count ON forum_replies;
DROP TRIGGER IF EXISTS trg_forum_replies_count ON forum_replies;
CREATE TRIGGER trg_forum_replies_count
  AFTER INSERT OR DELETE ON forum_replies
  FOR EACH ROW EXECUTE FUNCTION sync_thread_reply_count();

-- ---------- 4. PREGLEDI BEZ WRITE-A NA SVAKI READ ----------
-- Aplikacija zove RPC `increment_thread_views` (jedan UPDATE, bez selekcije reda).
CREATE OR REPLACE FUNCTION increment_thread_views(p_thread_id UUID) RETURNS void
LANGUAGE sql AS $$
  UPDATE forum_threads SET views = COALESCE(views, 0) + 1 WHERE id = p_thread_id;
$$;

CREATE OR REPLACE FUNCTION increment_article_views(p_article_id UUID) RETURNS void
LANGUAGE sql AS $$
  UPDATE articles SET views = COALESCE(views, 0) + 1 WHERE id = p_article_id;
$$;

-- Karma target u jednoj atomichnoj operaciji (bez read-modify-write race-a)
CREATE OR REPLACE FUNCTION apply_thread_karma(p_thread_id UUID, p_delta INTEGER) RETURNS void
LANGUAGE sql AS $$
  UPDATE forum_threads SET karma = COALESCE(karma, 0) + p_delta WHERE id = p_thread_id;
$$;

CREATE OR REPLACE FUNCTION apply_reply_karma(p_reply_id UUID, p_delta INTEGER) RETURNS void
LANGUAGE sql AS $$
  UPDATE forum_replies SET karma = COALESCE(karma, 0) + p_delta WHERE id = p_reply_id;
$$;

-- ---------- 5. ADMIN AUDIT LOG ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);

-- ---------- 6. RLS DENY-BY-DEFAULT ----------
-- Service-role API key bypass-uje RLS. Browser anon/authenticated nema policies,
-- pa nema direktnog pristupa tabelama čak i ako anon key procuri.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- connected_accounts already has RLS enabled above. `user_extras` is not a DB table;
-- it is a local JSON fallback and therefore needs no RLS policy.
-- No policies are created here: browser roles remain denied by default.

-- Provera posle migracije (treba da vrati true za svaku navedenu tabelu):
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'users','connected_accounts','badges','user_badges','quests','user_quests',
--     'articles','article_reactions','article_bookmarks','article_comments',
--     'forum_categories','forum_threads','forum_replies','forum_votes','forum_bookmarks',
--     'newsletter_subscribers','notifications','forum_polls','forum_poll_votes','audit_log'
--   )
-- ORDER BY tablename;

-- ======================================================================
