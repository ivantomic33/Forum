-- ============================================================
-- NEXUS — KOMPLETNA ŠEMA BAZE (JEDINI SQL FAJL)
--
-- Ovo je jedini fajl koji se pušta: Supabase → SQL Editor → Run.
-- Idempotentan je — bezbedno ga je pokrenuti ponovo (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP … IF EXISTS pre svakog CONSTRAINT/TRIGGER-a).
--
-- Redosled sekcija je bitan (FK zavisnosti):
--   core → 2.4.1 → 2.4.3 → 2.4.4 → 2.5.1 → 2.5.2 → 2.5.3 → 2.5.4
--   → polls → 2.6.0-deals → 2.6.1-presence → 2.6.2-presence-away
--   → 2.6.2-storage → 2.6.2-search-lexicon → 2.6.2-search
--   → 2.6.2-search-lang (no-op) → 2.6.4-sharing → 2.6.5-rpc-fixes
--
-- VAŽNO za pretragu: leksikalni sloj (fold_srpski/stem_srpski/search_doc)
-- mora biti PRE `search_articles/-threads/-deals`, jer Postgres za SQL
-- funkcije proverava da li pozvana funkcija postoji u trenutku CREATE FUNCTION.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ======================================================================
-- SEKCIJA: server/schema.sql
-- ======================================================================

-- NEXUS GAMING PORTAL DATABASE SCHEMA
-- Execute this in Supabase SQL Editor

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =======================
-- USERS TABLE
-- ============================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(30) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(50),
  avatar_url TEXT,
  bio TEXT,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  karma INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'away', 'offline')),
  is_verified BOOLEAN DEFAULT false,
  is_banned BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_karma ON users(karma DESC);
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);

-- ============================
-- CONNECTED ACCOUNTS TABLE
-- =======================
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(30) NOT NULL CHECK (platform IN ('steam', 'discord', 'twitch', 'youtube', 'epic', 'riot')),
  platform_username VARCHAR(255) NOT NULL,
  connected_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user ON connected_accounts(user_id);

-- ============================
-- BADGES TABLE
-- ============================
CREATE TABLE IF NOT EXISTS badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon_url TEXT,
  tier VARCHAR(20) DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
  xp_reward INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  badge_id UUID REFERENCES badges(id) ON DELETE CASCADE,
  earned_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id);

-- ============================
-- QUESTS TABLE
-- ============================
CREATE TABLE IF NOT EXISTS quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  xp_reward INTEGER DEFAULT 0,
  badge_reward UUID REFERENCES badges(id),
  target_count INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS user_quests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  quest_id UUID REFERENCES quests(id) ON DELETE CASCADE,
  progress INTEGER DEFAULT 0,
  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMP,
  UNIQUE(user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_quests_user ON user_quests(user_id);

-- =========================
-- ARTICLES TABLE (Portal/News)
-- ============================
CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  title VARCHAR(300) NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  cover_image TEXT,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL,
  tags TEXT[],
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_featured BOOLEAN DEFAULT false,
  views INTEGER DEFAULT 0,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_author ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_featured ON articles(is_featured);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_views ON articles(views DESC);

-- ============================
-- ARTICLE REACTIONS TABLE
-- ============================
CREATE TABLE IF NOT EXISTS article_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  reaction VARCHAR(20) NOT NULL CHECK (reaction IN ('like', 'gg', 'hype', 'fire', 'mind_blown')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(article_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_article_reactions_article ON article_reactions(article_id);
CREATE INDEX IF NOT EXISTS idx_article_reactions_user ON article_reactions(user_id);

-- ============================
-- ARTICLE BOOKMARKS TABLE
-- =======================
CREATE TABLE IF NOT EXISTS article_bookmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_article_bookmarks_user ON article_bookmarks(user_id);

-- ========================
-- ARTICLE COMMENTS TABLE
-- =======================
CREATE TABLE IF NOT EXISTS article_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_comment_id UUID REFERENCES article_comments(id) ON DELETE CASCADE,
  is_edited BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_comments_article ON article_comments(article_id);
CREATE INDEX IF NOT EXISTS idx_article_comments_user ON article_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_article_comments_parent ON article_comments(parent_comment_id);

-- ============================
-- FORUM CATEGORIES TABLE
-- ========================
CREATE TABLE IF NOT EXISTS forum_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  color VARCHAR(7),
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);
INSERT INTO forum_categories (slug, name, description, icon, color, sort_order) VALUES
('pc-gaming', 'PC Gaming', 'Discussions about PC titles, optimization, mods, and hardware', 'monitor', '#38BDF8', 1),
('consoles', 'Consoles', 'PlayStation, Xbox, Nintendo, and other console platforms', 'gamepad', '#A855F7', 2),
('esports', 'Esports', 'Pro tournaments, competitive matches, and esports teams', 'trophy', '#F59E0B', 3),
('hardware', 'Hardware', 'GPUs, CPUs, cooling, and custom build discussions', 'cpu', '#10B981', 4),
('lfg', 'LFG', 'Looking for group — find teammates for co-op and multiplayer', 'users', '#EC4899', 5),
('off-topic', 'Off-Topic', 'Free chat, humor, and general gaming talk', 'message-circle', '#6366F1', 6)
ON CONFLICT (slug) DO NOTHING;

-- ========================
-- FORUM THREADS TABLE
-- =======================
CREATE TABLE IF NOT EXISTS forum_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES forum_categories(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(300) NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[],
  is_pinned BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  is_spoiler BOOLEAN DEFAULT false,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  karma INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  last_reply_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_karma ON forum_threads(karma DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_created ON forum_threads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_last_reply ON forum_threads(last_reply_at DESC);

-- 2.6.6 (F-3) — tema otvorena iz deal-a („Diskutuj o ovom popustu“).
-- NAMERNO bez `REFERENCES deals(id)`: `deals` se pravi kasnije u ovom skriptu
-- (sekcija 2.6.0), a `schema-ALL.sql` se pušta kao jedna transakcija. FK se
-- dodaje u `sql/20-2.6.6-deal-topic.sql`, posle `10-2.6.0-deals.sql`.
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS deal_id UUID;
CREATE INDEX IF NOT EXISTS idx_forum_threads_deal ON forum_threads(deal_id);

-- ============================
-- FORUM REPLIES TABLE
-- ============================
CREATE TABLE IF NOT EXISTS forum_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  parent_reply_id UUID REFERENCES forum_replies(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  karma INTEGER DEFAULT 0,
  is_spoiler BOOLEAN DEFAULT false,
  is_edited BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread ON forum_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_author ON forum_replies(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_parent ON forum_replies(parent_reply_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_karma ON forum_replies(karma DESC);

-- ========================
-- FORUM VOTES TABLE
-- ============================
CREATE TABLE IF NOT EXISTS forum_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  reply_id UUID REFERENCES forum_replies(id) ON DELETE CASCADE,
  vote_type VARCHAR(10) CHECK (vote_type IN ('upvote', 'downvote')),
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (
    (thread_id IS NOT NULL AND reply_id IS NULL) OR
    (thread_id IS NULL AND reply_id IS NOT NULL)
  ),
  UNIQUE(user_id, thread_id),
  UNIQUE(user_id, reply_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_votes_user ON forum_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_thread ON forum_votes(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_reply ON forum_votes(reply_id);

-- ============================
-- FORUM BOOKMARKS TABLE
-- ============================
CREATE TABLE IF NOT EXISTS forum_bookmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_bookmarks_user ON forum_bookmarks(user_id);

-- ============================
-- NEWSLETTER TABLE
-- ============================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  subscribed_at TIMESTAMP DEFAULT NOW(),
  unsubscribed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);

-- ======================
-- NOTIFICATIONS TABLE
-- ============================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('reply', 'mention', 'upvote', 'badge_earned', 'quest_completed', 'system')),
  title VARCHAR(200),
  message TEXT,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);

-- ============================
-- UPDATE TRIGGERS
-- ============================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_articles_updated_at ON articles;
CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_forum_threads_updated_at ON forum_threads;
CREATE TRIGGER update_forum_threads_updated_at BEFORE UPDATE ON forum_threads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_forum_replies_updated_at ON forum_replies;
CREATE TRIGGER update_forum_replies_updated_at BEFORE UPDATE ON forum_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================
-- SEED DATA: BADGES
-- =====================
-- Ovaj blok je LEGACY (schema.sql). Aktuelni katalog i opisi (identični kodu i
-- frontendu) su u `schema-2.5.1.sql` — pokreni tu migraciju.
INSERT INTO badges (code, name, description, tier, xp_reward) VALUES
('first_post', 'Prva objava', 'Objavite prvu temu ili odgovor', 'bronze', 10),
('first_reply', 'Prvi odgovor (legacy)', 'Objavite prvi odgovor (legacy) — koristi se bedž first_post', 'bronze', 5),
('helpful', 'Pomoćnik', 'Napišite 25 odgovora', 'silver', 50),
('veteran', 'Veteran', 'Dostignite 5.000 XP', 'gold', 100),
('influencer', 'Influenser', 'Povežite 4 gaming naloga', 'platinum', 500)
ON CONFLICT (code) DO NOTHING;

-- ============================
-- SEED DATA: Initial Quests
-- ========================
INSERT INTO quests (code, title, description, xp_reward, target_count) VALUES
('welcome', 'Welcome to Nexus', 'Complete your profile by adding a bio and avatar', 25, 1),
('social_butterfly', 'Social Butterfly', 'Connect at least 3 gaming accounts', 50, 3),
('first_discussion', 'First Discussion', 'Create your first forum thread', 20, 1),
('voice_of_reason', 'Voice of Reason', 'Reply to 10 different threads', 100, 10)
ON CONFLICT (code) DO NOTHING;

-- ============================
-- ADMIN NALOG
-- =====================
-- Namerno NEMA seed admina u šemi: ranije je svaka baza imala
-- `nexus_admin` / `admin123` (poznata lozinka, javni pristup admin panelu).
-- Admin se kreira ručno (Supabase SQL Editor) ili lokalno kroz
-- `SEED_ADMIN_PASSWORD` u `server/.env` (vidi `server/lib/seed.ts`).

-- Provera admin naloga (bez prikazivanja hash-a):
-- SELECT username, email, role FROM users WHERE role = 'admin';

-- ======================================================================
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
-- SEKCIJA: server/schema-2.4.3.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.4.3 — PRIORITY 1 MIGRACIJA
-- Pokreni nakon schema.sql i schema-2.4.1.sql
-- Dodaje tabele za: reports, bans, auth_tokens, user_blocks
-- ============================================================

-- ---------- 1. AUTH TOKENS (email verification, password reset) ----------
CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('verify_email', 'reset_password')),
  hash VARCHAR(64) NOT NULL, -- SHA-256 hex
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);

-- Automatsko brisanje isteklih tokena (cron job ili periodičko čišćenje)
CREATE OR REPLACE FUNCTION cleanup_expired_tokens() RETURNS void
LANGUAGE sql AS $$
  DELETE FROM auth_tokens WHERE expires_at < NOW();
$$;

-- ---------- 2. REPORTS (content reporting) ----------
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('thread', 'reply', 'article', 'comment', 'user')),
  target_id UUID NOT NULL,
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'resolved', 'dismissed')),
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);

-- ---------- 3. BANS (with reason and expiration) ----------
CREATE TABLE IF NOT EXISTS bans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ, -- NULL = permanent ban
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_bans_user ON bans(user_id);
CREATE INDEX IF NOT EXISTS idx_bans_expires ON bans(expires_at);

-- Helper function za proveru aktivnog bana
CREATE OR REPLACE FUNCTION is_user_banned(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(
    SELECT 1 FROM bans 
    WHERE user_id = p_user_id 
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- ---------- 4. USER BLOCKS (harassment protection) ----------
CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- ---------- 5. THREAD TRACKING (follow threads) ----------
CREATE TABLE IF NOT EXISTS thread_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_user ON thread_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_thread ON thread_subscriptions(thread_id);

-- ---------- 6. MENTIONS ----------
-- Parsira @username u content-u i kreira notifikacije
CREATE OR REPLACE FUNCTION extract_mentions(content TEXT) RETURNS TEXT[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  mentions TEXT[];
BEGIN
  SELECT array_agg(DISTINCT lower(match[1]))
  INTO mentions
  FROM regexp_matches(content, '@(\w{3,30})', 'g') AS match;
  RETURN COALESCE(mentions, '{}');
END;
$$;

-- ---------- 7. ENHANCE NOTIFICATIONS ----------
-- Dodaj polje za link i metadata
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_actor ON notifications(actor_id);

-- ---------- 8. EDITING POSTS ----------
-- is_edited i is_deleted već postoje u schema.sql
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- -------- 9. RLS ZA NOVE TABELE ----------
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_subscriptions ENABLE ROW LEVEL SECURITY;

-- Brisanje isteklih banove automatski
CREATE OR REPLACE FUNCTION cleanup_expired_bans() RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET is_banned = false 
  WHERE id IN (
    SELECT user_id FROM bans 
    WHERE expires_at IS NOT NULL AND expires_at <= NOW()
  );
  DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= NOW();
$$;

-- Migracija završena

-- ======================================================================
-- SEKCIJA: server/schema-2.4.4.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.4.4 — POVEZIVANJE (front ⇄ API ⇄ baza)
-- Pokreni nakon schema.sql, schema-2.4.1.sql i schema-2.4.3.sql.
-- Idempotentna je; bezbedna za višestruko pokretanje.
--
-- Cilj: ukloniti mesta gde je funkcionalnost postojala samo kao ekran
-- ili samo kao tabela.
-- ============================================================

-- ---------- 1. BADGES / CONNECTED ACCOUNTS — fallback kolone ----------
-- Adapter koristi ove kolone kao materializovani keš; izvor istine su
-- `user_badges` i `connected_accounts` tabele (backfill ispod).
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS connected_accounts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill postojećih user_badges → users.badges (jednokratno i bez duplikata)
UPDATE users u
SET badges = COALESCE(sub.codes, '{}'::text[])
FROM (
  SELECT ub.user_id, array_agg(b.code ORDER BY b.code) AS codes
  FROM user_badges ub
  JOIN badges b ON b.id = ub.badge_id
  GROUP BY ub.user_id
) sub
WHERE u.id = sub.user_id
  AND (u.badges IS NULL OR u.badges = '{}');

-- Backfill connected_accounts → users.connected_accounts
UPDATE users u
SET connected_accounts = COALESCE(sub.accounts, '{}'::jsonb)
FROM (
  SELECT user_id, jsonb_object_agg(platform, platform_username) AS accounts
  FROM connected_accounts
  GROUP BY user_id
) sub
WHERE u.id = sub.user_id
  AND (u.connected_accounts IS NULL OR u.connected_accounts = '{}'::jsonb);

-- ---------- 2. AUTH TOKENS — dovršavanje 2.4.3 tabele ----------
-- `auth_tokens` je već napravljena u 2.4.3. Sigurnosna pravila:
--   * nikad se ne čuva plain token, samo SHA-256 hash
--   * token se troši atomski (UPDATE ... WHERE used_at IS NULL)
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION consume_auth_token(p_hash TEXT, p_type VARCHAR)
RETURNS TABLE (user_id UUID)
LANGUAGE sql AS $$
  UPDATE auth_tokens
  SET used_at = NOW()
  WHERE hash = p_hash
    AND type = p_type
    AND used_at IS NULL
    AND expires_at > NOW()
  RETURNING auth_tokens.user_id;
$$;

-- ---------- 3. SUBFORUM STATISTIKA U BAZI ----------
-- Broj tema/poruka se računa SQL-om (jeden upit), ne skeniranjem liste u aplikaciji.
CREATE OR REPLACE FUNCTION forum_category_stats()
RETURNS TABLE (
  id UUID,
  slug VARCHAR,
  name VARCHAR,
  description TEXT,
  icon VARCHAR,
  color VARCHAR,
  thread_count BIGINT,
  post_count BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.slug,
    c.name,
    c.description,
    c.icon,
    c.color,
    COUNT(DISTINCT t.id) AS thread_count,
    COUNT(DISTINCT t.id) + COUNT(rep.reply_id) AS post_count
  FROM forum_categories c
  LEFT JOIN forum_threads t
    ON t.category_id = c.id
   AND t.is_deleted IS NOT TRUE
  LEFT JOIN LATERAL (
    SELECT rr.id AS reply_id
    FROM forum_replies rr
    WHERE rr.thread_id = t.id
      AND rr.is_deleted IS NOT TRUE
  ) rep ON TRUE
  WHERE c.is_active IS NOT FALSE
  GROUP BY c.id, c.slug, c.name, c.description, c.icon, c.color
  ORDER BY c.sort_order NULLS LAST, c.name;
$$;

-- ---------- 4. KARMA AUTORA — atomični RPC ----------
-- Glas menja temu/odgovor i autorovu karmu u istom pozivu.
CREATE OR REPLACE FUNCTION apply_user_karma(p_user_id UUID, p_delta INTEGER) RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET karma = COALESCE(karma, 0) + p_delta WHERE id = p_user_id;
$$;

-- ---------- 5. KARMA LEADERBOARD IZ STVARNIH GLASOVA ----------
-- Keš u users.karma je brz za čitanje; ovaj RPC služi za administrativnu
-- rekalkulaciju (npr. posle migracije podataka).
CREATE OR REPLACE FUNCTION recalculate_user_karma(p_user_id UUID) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  total INTEGER;
BEGIN
  SELECT
    COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_threads t ON t.id = v.thread_id
      WHERE t.author_id = p_user_id AND v.vote_type = 'up'), 0)
    - COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_threads t ON t.id = v.thread_id
      WHERE t.author_id = p_user_id AND v.vote_type = 'down'), 0)
    + COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_replies r ON r.id = v.reply_id
      WHERE r.author_id = p_user_id AND v.vote_type = 'up'), 0)
    - COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_replies r ON r.id = v.reply_id
      WHERE r.author_id = p_user_id AND v.vote_type = 'down'), 0)
  INTO total;

  UPDATE users SET karma = total WHERE id = p_user_id;
  RETURN total;
END;
$$;

-- ---------- 6. QUEST PROGRESS NA SERVERU ----------
-- awardXp() zove `advance_quest` — jedan atomični UPDATE po kvestu.
CREATE OR REPLACE FUNCTION advance_quest(p_user_id UUID, p_code VARCHAR, p_amount INTEGER DEFAULT 1)
RETURNS TABLE (code VARCHAR, progress INTEGER, completed BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  q RECORD;
  next_progress INTEGER;
  is_complete BOOLEAN;
BEGIN
  SELECT id, target_count INTO q FROM quests WHERE code = p_code AND is_active IS NOT FALSE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO user_quests (user_id, quest_id, progress, completed)
  VALUES (p_user_id, q.id, LEAST(p_amount, q.target_count), LEAST(p_amount, q.target_count) >= q.target_count)
  ON CONFLICT (user_id, quest_id) DO UPDATE
    SET progress = LEAST(user_quests.progress + p_amount, q.target_count),
        completed = (user_quests.completed OR LEAST(user_quests.progress + p_amount, q.target_count) >= q.target_count),
        completed_at = CASE
          WHEN LEAST(user_quests.progress + p_amount, q.target_count) >= q.target_count
            THEN COALESCE(user_quests.completed_at, NOW())
          ELSE user_quests.completed_at
        END
  RETURNING progress, completed INTO next_progress, is_complete;

  RETURN QUERY SELECT p_code, next_progress, is_complete;
END;
$$;

-- ---------- 7. BOOKMARKS — upiti za profil ----------
-- Vraća sačuvane teme jednog korisnika (za `/users/:username` vlasnika).
CREATE OR REPLACE FUNCTION user_forum_bookmarks(p_user_id UUID)
RETURNS TABLE (thread_id UUID, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
  SELECT thread_id, created_at
  FROM forum_bookmarks
  WHERE user_id = p_user_id
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION user_article_bookmarks(p_user_id UUID)
RETURNS TABLE (article_id UUID, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
  SELECT article_id, created_at
  FROM article_bookmarks
  WHERE user_id = p_user_id
  ORDER BY created_at DESC;
$$;

-- ---------- 8. RLS ZA SVE NOVE/NEDOSTAJUĆE TABELE ----------
ALTER TABLE thread_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- ---------- 9. ADMIN EMAIL + ROTACIJA HINT ----------
-- Demo nalog se više ne seed-uje u produkciji (vidi seed.ts).
-- Novi admin se pravi ručno; ova provera pomaže da se ne zaboravi.
CREATE OR REPLACE FUNCTION admin_accounts() RETURNS TABLE (username VARCHAR, email VARCHAR, is_verified BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT username, email, is_verified FROM users WHERE role = 'admin' ORDER BY created_at;
$$;

-- Migracija 2.4.4 završena.

-- ======================================================================
-- SEKCIJA: server/schema-2.5.1.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.1 — ISTORIJA POVEZANIH NALOGA I KATALOG BEDŽEVA
-- Pokreni nakon schema.sql, schema-2.4.1.sql, schema-2.4.3.sql i schema-2.4.4.sql.
-- Idempotentna je; bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- 1. VRAĆANJE XP-a ZA ISTI NALOG ----------
-- Problem: `DELETE /api/users/accounts/:platform` je brisao red, pa je
-- ponovno povezivanje istog naloga ponovo davalo +25 XP (i kvest napredak).
-- Rešenje: soft revoke. Red ostaje kao istorija; `revoked_at` označava da
-- nalog više nije aktivan, a istorija sprečava farmovanje XP-a.
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Postojeći redovi (koji ranije nisu imali kolonu) su aktivni.
UPDATE connected_accounts SET revoked_at = NULL WHERE revoked_at IS NULL;

-- Adapter čita samo aktivne naloge (revoked_at IS NULL) i istoriju proverava
-- preko (user_id, platform, platform_username). Jedan red po (user, platform)
-- je već role-playing pravilo tabele; ovde samo osiguravamo indeks.
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform
  ON connected_accounts (user_id, platform);

-- `users.connected_accounts` (JSONB keš) nije izvor istine; ovaj komentar
-- ostaje kao podsetnik da adapter filtrira `revoked_at` pri čitanju.
COMMENT ON COLUMN connected_accounts.revoked_at IS
  'NULL = aktivan nalog; timestamp = otkačen (istorija sprečava ponovni XP)';

-- ---------- 2. KATALOG BEDŽEVA (JEDAN IZVOR ISTINE) ----------
-- Ranije su se opis i uslov razlikovali: `veteran` je u SQL-u bio "30 dana
-- aktivnosti", a u kodu "5.000 XP"; `influencer` "1000 karme" vs "4 naloga".
-- Sada SQL, server (`BADGE_CATALOG` u gamification.ts) i frontend
-- (`src/lib/badges.ts`) imaju identičan opis.

-- `schema.sql` definiše tier CHECK ('bronze','silver','gold','platinum','diamond').
-- Naša skala ima i `legendary` (founder/legend), pa se constraint proširuje
-- PRE inserta — bez ovoga insert pada sa 23514 (`badges_tier_check`).
ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_tier_check;
-- NOT VALID: proširenje se primenjuje na sve nove/izmenjene redove, a ne
-- pada ako u bazi već postoji legacy vrednost van liste (ne blokira deploy).
ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_tier_check;
ALTER TABLE badges
  ADD CONSTRAINT badges_tier_check
  CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary')) NOT VALID;

INSERT INTO badges (code, name, description, tier, xp_reward) VALUES
  ('first_post',  'Prva objava',  'Objavite prvu temu ili odgovor',        'bronze',   10),
  ('helpful',     'Pomocnik',     'Napiste 25 odgovora',                   'silver',   50),
  ('contributor', 'Kontributor',  'Otvorite 10 tema',                      'silver',  100),
  ('expert',      'Ekspert',      'Dostignite 500 karme',                  'gold',    200),
  ('influencer',  'Influenser',   'Povežite 4 gaming naloga',              'platinum', 300),
  ('veteran',     'Veteran',      'Dostignite 5.000 XP',                   'gold',    500),
  ('founder',     'Osnivac',      'Među prvim članovima zajednice',        'legendary', 0),
  ('legend',      'Legenda',      'Posebno dodeljeno dostignuće',          'legendary', 0)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      tier = EXCLUDED.tier,
      xp_reward = EXCLUDED.xp_reward,
      is_active = true;

-- Legacy `first_reply` iz schema.sql: prvu objavu pokriva `first_post`, a
-- odgovori se broje za `helpful`. Ne brišemo red (stari `user_badges` ga
-- referenciraju), samo ga sklanjamo iz aktivnog kataloga
-- (`is_active = false` + opis).
UPDATE badges
SET description = 'Objavite prvi odgovor (legacy) — koristi se bedž first_post',
    is_active = false
WHERE code = 'first_reply';

-- ---------- 3. BRZI POGLED NA RANG-LISTU ----------
-- „Po nivou“ i „po karmi“ sortiranje ide preko ovih indeksa.
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_karma
  ON users (karma DESC, level DESC) WHERE is_banned IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_level
  ON users (level DESC, xp DESC) WHERE is_banned IS NOT TRUE;

-- Migracija 2.5.1 završena.

-- ======================================================================
-- SEKCIJA: server/schema-2.5.2.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.2 — SESIJE, DOUBLE OPT-IN I KOMENTARI ČLANAKA
-- Pokreni nakon schema.sql, schema-2.4.1.sql, schema-2.4.3.sql,
-- schema-2.4.4.sql i schema-2.5.1.sql.
-- Idempotentna je i bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- F-06: VERZIJA SESIJE ----------
-- JWT nosi `tv`; `authenticate` ga poredi sa ovom kolonom. Svako povećanje
-- poništava SVE ranije izdate tokene (logout, logout-all, reset/promena lozinke).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- ---------- F-21: DOKAZ SAGLASNOSTI SA USLOVIMA ----------
-- Pri registraciji se beleži verzija teksta uslova, vreme i IP adresa.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_accepted_ip TEXT;

COMMENT ON COLUMN users.token_version IS
  'Verzija sesije; JWT.tv mora da odgovara ovoj vrednosti (F-06)';

-- ---------- F-07: PRAVI DOUBLE OPT-IN ----------
-- Ranije je `subscribe` odmah upisivao is_active = true, pa je svako mogao da
-- „prijavi“ tuđu adresu. Sada se upisuje pending, a aktivacija ide kroz /confirm.
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_ip TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_user_agent TEXT;

-- Postojeći aktivni pretplatnici su potvrđeni pre uvođenja kolone — ne brišemo
-- ih i ne šaljemo retroaktivni opt-in; beležimo vreme kao početak saglasnosti.
UPDATE newsletter_subscribers
SET confirmed_at = subscribed_at
WHERE is_active = true AND confirmed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_newsletter_active ON newsletter_subscribers(is_active);

-- ---------- F-08: KOMENTARI ČLANAKA IZ BAZE ----------
-- Tabela postoji u schema.sql, ali `parent_comment_id` i `user_id` se nisu
-- koristili (komentari su bili u memoriji procesa). Adapter sada piše ime
-- autora i avatar kao snapshot (komentar ostaje čitljiv posle anonimizacije).
ALTER TABLE article_comments
  ADD COLUMN IF NOT EXISTS author_name VARCHAR(60),
  ADD COLUMN IF NOT EXISTS author_avatar TEXT;

CREATE INDEX IF NOT EXISTS idx_article_comments_article_created
  ON article_comments(article_id, created_at);

-- ---------- F-12: JEDNA REAKCIJA PO KORISNIKU ----------
-- `article_reactions` već ima UNIQUE(article_id, user_id, reaction) i kolonu
-- `reaction` (ne `type`). Dodajemo samo atomični inkrement brojača.
CREATE OR REPLACE FUNCTION apply_article_reaction(p_article_id UUID, p_type TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE articles
  SET reactions = jsonb_set(
    COALESCE(reactions, '{}'::jsonb),
    ARRAY[p_type],
    to_jsonb(COALESCE((reactions ->> p_type)::INT, 0) + 1),
    true
  )
  WHERE id = p_article_id;
END;
$$;

-- ---------- F-06: PONIŠTAVANJE SESIJA NA RESET/PROMENU LOZINKE ----------
-- Aplikacija šalje ovaj UPDATE sama; trigger obezbeđuje i da direktna izmena
-- `password_hash` (van API-ja) poništi sesije.
CREATE OR REPLACE FUNCTION bump_token_version_on_password_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.token_version := COALESCE(OLD.token_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_password_bump_token ON users;
DROP TRIGGER IF EXISTS trg_users_password_bump_token ON users;
CREATE TRIGGER trg_users_password_bump_token
  BEFORE UPDATE OF password_hash ON users
  FOR EACH ROW
  EXECUTE FUNCTION bump_token_version_on_password_change();

-- ======================================================================
-- SEKCIJA: server/schema-2.5.3.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.3 — TRANSAKCIONI GLASOVI I AGREGATI ZA LISTE
-- Pokreni nakon schema.sql … i schema-2.5.2.sql.
-- Idempotentna je i bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- F-17: JEDAN GLAS PO KORISNIKU ----------
-- `forum_votes` ima XOR thread_id/reply_id i nije garantovao jedinstven glas
-- pri paralelnim zahtevima. Parcijalni UNIQUE indeksi to čine nemogućim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_votes_user_thread
  ON forum_votes (user_id, thread_id)
  WHERE thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_votes_user_reply
  ON forum_votes (user_id, reply_id)
  WHERE reply_id IS NOT NULL;

-- Postojeći duplikati (ako ih ima) ne smeju da blokiraju migraciju: ostavlja se
-- najstariji glas po (korisnik, cilj), ostatak se briše.
DELETE FROM forum_votes v
USING forum_votes older
WHERE v.thread_id IS NOT NULL
  AND older.thread_id = v.thread_id
  AND older.user_id = v.user_id
  AND older.id < v.id;

DELETE FROM forum_votes v
USING forum_votes older
WHERE v.reply_id IS NOT NULL
  AND older.reply_id = v.reply_id
  AND older.user_id = v.user_id
  AND older.id < v.id;

-- ---------- F-17: ATOMIČNI GLAS ----------
-- Jedan poziv: zaključaj cilj, skini stari glas, upiši novi i pomeri karmu.
-- Vraća { changed, delta, karma } — ruta po `changed` odlučuje o XP-u i notifikaciji.
CREATE OR REPLACE FUNCTION cast_forum_vote(
  p_user_id UUID,
  p_thread_id UUID,
  p_reply_id UUID,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing TEXT;
  v_delta INT := 0;
  v_karma INT;
  v_new_vote TEXT := NULLIF(p_vote_type, 'null');
BEGIN
  IF p_vote_type IS NOT NULL AND p_vote_type NOT IN ('up', 'down', 'null') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT karma INTO v_karma FROM forum_threads WHERE id = p_thread_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND thread_id = p_thread_id
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND thread_id = p_thread_id;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, thread_id, vote_type) VALUES (p_user_id, p_thread_id, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_threads SET karma = karma + v_delta WHERE id = p_thread_id RETURNING karma INTO v_karma;
    END IF;
  ELSE
    SELECT karma INTO v_karma FROM forum_replies WHERE id = p_reply_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND reply_id = p_reply_id
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND reply_id = p_reply_id;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, reply_id, vote_type) VALUES (p_user_id, p_reply_id, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_replies SET karma = karma + v_delta WHERE id = p_reply_id RETURNING karma INTO v_karma;
    END IF;
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'karma', COALESCE(v_karma, 0));
END;
$$;

-- ---------- F-18: AGREGATI (COUNT/SUM bez učitavanja redova) ----------
CREATE OR REPLACE FUNCTION sum_article_views()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(views), 0)::BIGINT FROM articles;
$$;

CREATE OR REPLACE FUNCTION sum_thread_views()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(views), 0)::BIGINT FROM forum_threads WHERE is_deleted = false;
$$;

-- Indeksi za paginaciju/sortiranje listi (F-18) — keyset po (sort, id).
CREATE INDEX IF NOT EXISTS idx_forum_threads_pinned_karma
  ON forum_threads (is_pinned DESC, karma DESC, id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_forum_threads_created
  ON forum_threads (created_at DESC, id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_users_leaderboard_karma
  ON users (karma DESC, level DESC, xp DESC) WHERE is_banned IS NOT TRUE;
-- N-07 — `ORDER BY level DESC, xp DESC, karma DESC` iz `db.users.leaderboard`
-- (jedini neuslovni red u toj ruti). Isti naziv kao u 2.5.1 → već kreiran indeks
-- (level, xp) se preskače, pa ovde ostaje samo onaj sa trećim ključem.
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_level
  ON users (level DESC, xp DESC, karma DESC) WHERE is_banned IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_articles_created
  ON articles (created_at DESC, id);

-- ======================================================================
-- SEKCIJA: server/schema-2.5.4.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.4 — BEZBEDNOST I ONBOARDING
--   F-32  Refresh sesije u HttpOnly cookie-ju (rotacija + detekcija zloupotrebe)
--   F-33  TOTP dvofaktorska autentifikacija + recovery kodovi
--   F-34  OAuth prijava/povezivanje (Discord, Google, Steam)
-- Pokreni nakon schema-2.5.3.sql. Idempotentna je i bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- F-32: REFRESH SESIJE ----------
-- Refresh token se NIKADA ne čuva u čistom obliku — samo SHA-256 hash.
-- `family_id` povezuje lanac rotacija: ako se već iskorišćen token ponovo pošalje,
-- cela porodica se briše (ukradeni refresh token ne može da nastavi sesiju).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON auth_sessions (family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);

-- ---------- F-33: TOTP / RECOVERY KODOVI ----------
-- TOTP tajna je uvek enkriptovana (AES-256-GCM, ključ izvodi server iz TOTP_ENCRYPTION_KEY/JWT_SECRET).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
-- Recovery kodovi se čuvaju kao bcrypt hash-evi; `totp_recovery_codes` je JSONB niz.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Bruteforce zaštita: broj neuspelih TOTP pokušaja i vreme zaključavanja.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until TIMESTAMPTZ;

-- Jedan TOTP kod ne može da se iskoristi dvaput: `last_used_step` sprečava replay.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

-- ---------- F-34: OAUTH IDENTITETI ----------
-- Jedan provajderski identitet = jedan NEXUS nalog (UNIQUE provider+provider_user_id).
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts (user_id);

-- ======================================================================
-- SEKCIJA: server/schema-polls.sql
-- ======================================================================

-- ============================================================
-- NEXUS — INTERAKTIVNE ANKETE (poll)
-- Pokreni u Supabase SQL Editor-u zajedno sa schema.sql.
-- Bez ovih tabela ankete se ne čuvaju u Supabase-u.
-- ============================================================

CREATE TABLE IF NOT EXISTS forum_polls (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID UNIQUE NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  question VARCHAR(200) NOT NULL,
  options TEXT[] NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_poll_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_poll_votes_thread ON forum_poll_votes(thread_id);

-- Service-role server accesses these tables. Browser anon/authenticated users
-- have no policies and are denied by default.
ALTER TABLE forum_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_poll_votes ENABLE ROW LEVEL SECURITY;

-- ======================================================================
-- SEKCIJA: server/schema-2.6.0-deals.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.6.0 — DEALS / POPUSTI („Gde je najjeftiniji…“)
--   games        — katalog igara (povezivanje sa Game Pages, opciono IGDB)
--   deals        — korisnički popusti (link, cene, prodavnica, dokaz, opis)
--   deal_votes   — glasovi zajednice (1 glas po korisniku, atomičan RPC)
--   reports      — nova vrsta prijave `deal`
-- Pokreni nakon schema-2.5.4.sql. Idempotentna je i bezbedna za višestruko pokretanje.
--
-- Bez ove migracije aplikacija u SUPABASE režimu nema gde da upiše deal (rute
-- vraćaju 500), pa je neophodna pre uključivanja sekcije na produkciji.
-- ============================================================

-- ---------- GAMES ----------
-- Jedan red po igri. `slug` je javni identifikator za `/games/:slug` (Game Page).
-- `igdb_id` je opcioni ID sa IGDB-a — kada je podešen, future sync može da
-- popuni cover/žanr/release_date bez ručnog unosa.
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(140) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL,
  cover_url TEXT,
  release_date DATE,
  igdb_id INTEGER UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_games_title_lower ON games (lower(title));
CREATE INDEX IF NOT EXISTS idx_games_igdb ON games (igdb_id) WHERE igdb_id IS NOT NULL;

-- ---------- DEALS ----------
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  -- `url` je link na prodavnicu; `proof_url` je screenshot/dokaz (opciono).
  url TEXT NOT NULL,
  proof_url TEXT,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  original_price NUMERIC(12, 2) NOT NULL CHECK (original_price >= 0),
  -- Popust se izračunava u bazi: klijent ne može da "ubaci" 250% popusta.
  discount_pct SMALLINT GENERATED ALWAYS AS (
    CASE
      WHEN original_price > 0 AND price < original_price
        THEN LEAST(100, GREATEST(0, ROUND((1 - price / original_price) * 100)))::SMALLINT
      ELSE 0
    END
  ) STORED,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  store VARCHAR(60) NOT NULL,
  platform VARCHAR(32) NOT NULL DEFAULT 'pc',
  description TEXT,
  expires_at TIMESTAMPTZ,
  -- `active` = vidljiv; `expired` se postavlja serverom; `removed` = moderacija.
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'removed')),
  -- `is_verified` = dokaz pregledan od strane moderatora (nije isto što i "imа glasove").
  is_verified BOOLEAN NOT NULL DEFAULT false,
  -- Keširani zbir glasova (up - down); izvor istine su `deal_votes`.
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (original_price >= price)
);

CREATE INDEX IF NOT EXISTS idx_deals_status_created ON deals (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_status_score ON deals (status, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_status_discount ON deals (status, discount_pct DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_status_expires ON deals (status, expires_at ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_deals_game ON deals (game_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_store ON deals (store);
CREATE INDEX IF NOT EXISTS idx_deals_platform ON deals (platform);
CREATE INDEX IF NOT EXISTS idx_deals_price ON deals (price);
CREATE INDEX IF NOT EXISTS idx_deals_author ON deals (author_id);

-- ---------- DEAL VOTES ----------
-- Jedan glas po korisniku po deal-u: promena glasa je UPDATE, otkaz je DELETE.
CREATE TABLE IF NOT EXISTS deal_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(8) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_votes_deal ON deal_votes (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_votes_user ON deal_votes (user_id);

-- ---------- ATOMIČNI GLAS ----------
-- Isti obrazac kao `cast_forum_vote` (schema-2.5.3): zaključaj deal, skini stari
-- glas, upiši novi i pomeri `score` u jednoj transakciji.
-- `p_vote_type` = 'up' | 'down' | NULL (otkaz glasa).
CREATE OR REPLACE FUNCTION cast_deal_vote(
  p_user_id UUID,
  p_deal_id UUID,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing TEXT;
  v_delta INT := 0;
  v_score INT;
  v_new_vote TEXT := NULLIF(lower(p_vote_type), 'null');
BEGIN
  IF p_vote_type IS NOT NULL AND lower(p_vote_type) NOT IN ('up', 'down', 'null') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  SELECT score INTO v_score FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'score', 0);
  END IF;

  SELECT vote_type INTO v_existing
  FROM deal_votes WHERE user_id = p_user_id AND deal_id = p_deal_id
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
    DELETE FROM deal_votes WHERE user_id = p_user_id AND deal_id = p_deal_id;
  END IF;

  IF v_new_vote IS NOT NULL THEN
    INSERT INTO deal_votes (user_id, deal_id, vote_type) VALUES (p_user_id, p_deal_id, v_new_vote);
    v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE deals SET score = score + v_delta WHERE id = p_deal_id RETURNING score INTO v_score;
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'score', COALESCE(v_score, 0));
END;
$$;

-- ---------- TRIGGER: updated_at ----------
DROP TRIGGER IF EXISTS update_deals_updated_at ON deals;
DROP TRIGGER IF EXISTS update_deals_updated_at ON deals;
CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- ISTEKAO DEAL ----------
-- Deal sa `expires_at` u prošlosti se više ne prikazuje kao aktivan. Ruta to
-- filtrira i u upitu, ali periodični poziv (ili cron) može da "zaključa" stanje:
--   SELECT expire_deals();
CREATE OR REPLACE FUNCTION expire_deals()
RETURNS INTEGER
LANGUAGE sql
AS $$
  WITH changed AS (
    UPDATE deals SET status = 'expired'
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER FROM changed;
$$;

-- ---------- PRIJAVE: nova vrsta `deal` ----------
-- `reports.target_type` je VARCHAR u schema.sql — CHECK nema, pa je proširenje
-- bezbedno. Blok ispod je tu samo da stariju bazu sa CHECK-om ne bi polomio.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('thread', 'reply', 'article', 'comment', 'user', 'deal'));

-- ---------- RLS ----------
-- Backend koristi `service_role` (zaobilazi RLS). Uključujemo RLS da
-- `anon`/`authenticated` ključ ne može direktno da čita/piše.
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_votes ENABLE ROW LEVEL SECURITY;

-- ======================================================================
-- SEKCIJA: server/schema-2.6.1-presence.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.1 — „Online sada“ (prisustvo korisnika)
-- ----------------------------------------------------------------------------
-- Server upisuje otkucaj na `POST /api/auth/heartbeat`; poslednja aktivnost
-- starija od 90 sekundi znači „offline“ (TTL). Red se briše pri odjavi.
--
-- Bez ove tabele server i dalje radi: prisustvo tada živi u memoriji procesa
-- (jednokoračni in-memory režim). Tabela je potrebna za više instanci API-ja i
-- da prijava ostane vidljiva posle restart-a (npr. health check restarta).
--
-- Realtime: prisustvo se šalje kroz Broadcast kanal `presence:global` sa
-- service_role ključem na serveru. Broadcast na kanale za događaje je
-- dozvoljen bez RLS politika, a service_role ih ionako zaobilazi.
-- Klijent se NIKAD ne pretplaćuje preko `postgres_changes` za ovu tabelu —
-- telo događaja bi bilo vidljivo samo uz RLS politiku, a broadcast nosi samo
-- javni `userId`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
  ON user_presence(last_seen_at DESC);

-- RLS: deny-by-default. Pristup imaju samo service_role (backend) — browser
-- ne čita i ne piše ovu tabelu.
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- ======================================================================
-- SEKCIJA: server/schema-2.6.2-presence-away.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Prisustvo: „away“ status + RPC koji ne skenira celu tabelu
-- ----------------------------------------------------------------------------
-- 1) `status` kolona: 'online' | 'away'. TTL nije u tabeli — računa se iz
--    `last_seen_at` (vidi funkciju ispod), pa „away“ znači: korisnik je
--    prijavljen, ali nije bilo aktivnosti u prozoru `away_after` (klijent šalje
--    heartbeat svakih 25s samo dok je tab vidljiv, tako da nevidljiv tab
--    prirodno prelazi u „away“ posle 2 minuta, a u „offline“ posle TTL-a).
--
-- 2) B-16: ranije je `online()` čitao CELU tabelu (`select user_id, last_seen_at`
--    bez filtera) i TTL filtrirao u JS-u, na svakih 60s po klijentu. Sada
--    `online_users()` filtrira u SQL-u i koristi indeks na `last_seen_at`
--    iz `schema-2.6.1-presence.sql`, pa upit čita samo aktivne redove.
--
--    PostgREST poređenje `timestamptz` sa ISO stringom je u starijim verzijama
--    vraćalo prazan skup; zato je serverski orkestrator pomerao filter u JS.
--    Funkcija u SQL-u nema taj problem: `now() - interval` je `timestamptz`
--    poređenje unutar baze.
--
-- 3) `presence_status` je jedan izvor istine za online/away i koristi je i
--    `online_users()` i `online_set(uuid[])` (profil, rang-lista, forum lista).
--
-- Bez ove migracije server radi kao pre: `online()` dobija 404/42P01 i
-- prelazi na direktan upit + filter u JS-u, a „away“ postoji samo na klijentu.
-- ============================================================================

ALTER TABLE user_presence
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'online';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_presence_status_check'
      AND conrelid = 'user_presence'::regclass
  ) THEN
    ALTER TABLE user_presence
      ADD CONSTRAINT user_presence_status_check CHECK (status IN ('online', 'away'));
  END IF;
END $$;

-- Originalni indeks je sortiran po `last_seen_at DESC`; parcijalni služi
-- upravo onome što `online_users()` čita (samo sveže redove).
DROP INDEX IF EXISTS idx_user_presence_last_seen;
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen
  ON user_presence(last_seen_at DESC);

--
 --
CREATE OR REPLACE FUNCTION presence_status(last_seen_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN last_seen_at IS NULL THEN 'offline'
    WHEN last_seen_at >= NOW() - INTERVAL '90 seconds' THEN 'online'
    WHEN last_seen_at >= NOW() - INTERVAL '120 seconds' THEN 'away'
    ELSE 'offline'
  END;
$$;

--
 --
CREATE OR REPLACE FUNCTION online_users()
RETURNS TABLE (user_id UUID, status TEXT, last_seen_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  SELECT p.user_id, presence_status(p.last_seen_at) AS status, p.last_seen_at
  FROM user_presence p
  WHERE p.last_seen_at >= NOW() - INTERVAL '120 seconds'
  ORDER BY p.last_seen_at DESC
  LIMIT 2000;
$$;

-- Status samo za tražene korisnike — jedan upit za profil/rang-listu/forum.
CREATE OR REPLACE FUNCTION presence_for_users(user_ids UUID[])
RETURNS TABLE (user_id UUID, status TEXT, last_seen_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
AS $$
  SELECT p.user_id, presence_status(p.last_seen_at) AS status, p.last_seen_at
  FROM user_presence p
  WHERE p.user_id = ANY(user_ids)
    AND p.last_seen_at >= NOW() - INTERVAL '120 seconds';
$$;

-- RLS: tabelu i funkcije koristi samo backend (service_role).
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION online_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION presence_for_users(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION online_users() TO service_role;
GRANT EXECUTE ON FUNCTION presence_for_users(UUID[]) TO service_role;

-- PostgREST kešira šemu; posle migracije nove funkcije pita notifikacija
-- bez koje REST poziv ne vidi funkciju do restarta (`PGRST202`).
NOTIFY pgrst, 'reload schema';

-- ======================================================================
-- SEKCIJA: server/schema-2.6.2-storage.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Supabase Storage (avatar, cover igre, dokaz deal-a)
-- ----------------------------------------------------------------------------
-- Jedan JAVNI bucket `media` — slike su namerno javne (avatar se prikazuje u
-- listama, cover na Game Page-u, dokaz u deal-u), pa CDN keširanje radi bez
-- potpisa URL-a. Upis i brisanje rade isključivo server preko service_role
-- ključa (`server/lib/storage.ts`); nijedna politika ne dozvoljava anon
-- upis, iako je bucket javan za čitanje.
--
-- Putanje u bucket-u:
--   <user_id>/avatar-<random>.webp   (256×256, WebP, bez EXIF-a)
--   <user_id>/cover-<random>.webp    (600×800, staff)
--   <user_id>/proof-<random>.webp    (do 1600 px, autor deal-a)
-- `user_id` se uzima iz sesije, ne iz zahteva — korisnik ne može da piše u
-- tuđi prefiks ni preko politike.
--
-- Ako se koristi custom domena ili drugi bucket, promeni `SUPABASE_STORAGE_BUCKET`.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  TRUE,
  5242880, -- 5 MB (server dodatno ponovo kodira u WebP)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Čitanje javnog bucket-a (i anon/authenticated gledaoci).
DROP POLICY IF EXISTS "media public read" ON storage.objects;
CREATE POLICY "media public read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media');

-- Upis je vezan za folder korisnika: `auth.uid()::text = (storage.foldername(name))[1]`.
-- Server (service_role) zaobilazi RLS, pa je ovo zaštita za slučaj da neko
-- kasnije doda klijentski upload sa anon ključem.
DROP POLICY IF EXISTS "media owner insert" ON storage.objects;
CREATE POLICY "media owner insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "media owner update" ON storage.objects;
CREATE POLICY "media owner update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "media owner delete" ON storage.objects;
CREATE POLICY "media owner delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- PostgREST/Storage keširaju šemu; posle migracije novi bucket je vidljiv odmah.
NOTIFY pgrst, 'reload schema';

-- ======================================================================
-- SEKCIJA: server/schema-2.6.2-search-lexicon.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: leksikalni sloj (funkcije) — MORA IĆI PRVI
-- ----------------------------------------------------------------------------
-- Ovaj fajl SAMOSTALNO pravi sve što mu treba (i `fold_srpski`/`stem_srpski`)
-- i ne zavisi od redosleda ostalih migracija. Pušta se PRE `schema-2.6.2-search.sql`
-- jer `search_articles/-threads/-deals` pozivaju `search_doc()` u svom telu, a
-- Postgres za SQL funkcije proverava da li pozvana funkcija postoji **u trenutku
-- `CREATE FUNCTION`**:
--
--   ERROR: 42883: function fold_srpski(text) does not exist
--   CONTEXT: SQL function "search_doc" during inlining
--
--  1) `fold_srpski()`  — mala slova, latinica, bez dijakritike, ćirilica → latinica.
--  2) `stem_srpski()`  — deterministic koren (ista lista nastavaka kao JS).
--  3) `search_doc()`   — normalizovan tsvector za GIN indeks.
--
-- Redosled u `schema-ALL.sql`: storage → **lexicon** → search → lang.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Potpuno NEOVISNO o redosledu ostalih migracija: ništa ne uvozi i ništa ne
-- ostavlja na okolinu. Svaka funkcija je samostalna (`search_doc` ponovo
-- pravi `fold_srpski`/`stem_srpski` pre sebe), pa `CREATE FUNCTION` nikad ne
-- može da padne sa „42883: function fold_srpski(text) does not exist“.
-- Ovaj fajl pravi: fold_srpski, stem_srpski, search_doc, search_terms,
-- search_terms_refresh, search_suggest i GIN indekse.

-- `unaccent` je opcion i NIKAD se ne koristi — `translate()` je determinističan,
-- ne zavisi od ekstenzije ni od verzije Postgresa (JS `foldSrpski()` daje isto).

-- ---------------------------------------------------------------------------
-- 1) Normalizacija (samo `translate` + regexp: deterministički, bez unaccent)
-- ---------------------------------------------------------------------------
-- DVA `translate()`-a (ćirilica→latinica, pa dijakritika) da NIJEDAN par ne
-- prelazi mapiranje 1:1. Jedan par od 30 ćiriličnih slova menja „љ“/„њ“/„ђ“
-- na JEDAN znak — ručno je bilo 31 naspram 30, što daje tihi NULL.
CREATE OR REPLACE FUNCTION fold_srpski(txt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        translate(
          translate(lower(coalesce(txt, '')),
            'абвгдђежзијклљмнњопрстћуфхцчџш',
            'abvgdjezzijkljmnjoprstcufhccdzs'),
          'čćšžđ',
          'ccszd'
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Koren reči (identična lista nastavaka kao `stemSrpski()` u JS-u)
-- ---------------------------------------------------------------------------
-- `IMMUTABLE` je namerno: `search_doc()` iz nje pravi izraz GIN indeksa.
-- `lower()` se ovde NE koristi (zavisi od collation-a) — mala slova već
-- garantuje `fold_srpski()`, koji je pozvan pre ovog.
CREATE OR REPLACE FUNCTION stem_srpski(word TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  w TEXT := coalesce(word, '');
  suffixes TEXT[] := ARRAY[
    'ovima','evima','anje','enje','ijma','ama','ima','ovi','evi','ija','ije',
    'ati','iti','eti','uti','ila','ile','ilo','ili','ala','ale','alo','ali',
    'om','em','im','ih','og','eg','oj','ej','ao','eo','io','uo',
    -- Jednoslovni padeži se skidaju samo na rečima od 6+ znakova
    -- (`MIN_STEM_BASE` u JS-u): „popusta“ → „popust“, „sata“ ostaje celo.
    'a','e','i','o','u'
  ];
  suffix TEXT;
BEGIN
  -- Isti prag kao `STEM_MIN_LENGTH` u `server/lib/search.ts` (5 znakova).
  IF length(w) < 5 THEN RETURN w; END IF;
  FOREACH suffix IN ARRAY suffixes LOOP
    IF length(suffix) = 1 AND length(w) < 6 THEN CONTINUE; END IF;
    IF length(w) - length(suffix) >= 3 AND right(w, length(suffix)) = suffix THEN
      RETURN left(w, length(w) - length(suffix));
    END IF;
  END LOOP;
  RETURN w;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Dokument za indeks: normalizovan + stemovan tsvector
-- ---------------------------------------------------------------------------
-- `array_to_tsvector(text[])` (JEDAN argument!) — ne postoji verzija sa
-- `regconfig`; konfiguracija nije potrebna jer tokene već dajemo normalizovane
-- i bez stop-reči. Postgres bi inače bacio:
--   ERROR: 42883: function array_to_tsvector(unknown, text[]) does not exist
--
-- Prazni tokeni se skidaju u `words`, a agregat ima `coalesce` za dokument
-- koji nema nijednu reč.
CREATE OR REPLACE FUNCTION search_doc(txt TEXT)
RETURNS TSVECTOR
LANGUAGE sql
IMMUTABLE
AS $$
  WITH folded AS (
    SELECT public.fold_srpski(txt) AS norm
  ),
  words AS (
    SELECT DISTINCT public.stem_srpski(w.word) AS word
    FROM folded
    CROSS JOIN LATERAL regexp_split_to_table(folded.norm, '\s+') AS w(word)
    WHERE length(w.word) > 0
  )
  SELECT coalesce(array_to_tsvector(array_agg(words.word)), ''::tsvector)
  FROM words;
$$;
COMMENT ON FUNCTION search_doc(TEXT) IS 'Normalizovan tsvector (fold + deterministic koren) za pretragu 2.6.2';

-- ---------------------------------------------------------------------------
-- 4) Rečnik za „da li ste mislili“ + punjenje + sugestija
-- ---------------------------------------------------------------------------
-- Namerno u ISTOM fajlu kao funkcije: puštanje `lang`/`search` bez `lexicon`
-- je bilo glavni izvor 42883 grešaka. Tako je jedan fajl = cela pretraga.
CREATE TABLE IF NOT EXISTS search_terms (
  term TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'thread', 'deal', 'game')),
  weight INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION search_terms_refresh()
RETURNS INT
LANGUAGE plpgsql
-- VOLATILE je podrazumevano i NAMERNO: funkcija piše (`TRUNCATE`/`INSERT`) i
-- poziva se u SQL Editor-u kao `SELECT search_terms_refresh();`. Zato Supabase
-- prikazuje rezultat `search_terms_refresh = <broj>` (broj upisanih reči) — to
-- je očekivani izlaz poslednjeg `SELECT`-a u ovoj skripti, ne greška.
AS $$
DECLARE
  inserted INT;
BEGIN
  TRUNCATE search_terms;

  -- Zajednički izvor: svi naslovi (članci + teme + aktivni dealovi) u JEDNOM
  -- `INSERT`-u. Tako nema tri `ROW_COUNT`-a i funkcija vraća pravi broj reči.
  INSERT INTO search_terms(term, kind, weight)
  SELECT DISTINCT ON (word) word, kind, 1
  FROM (
    SELECT word, 'article' AS kind
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM articles WHERE status = 'published'
    ) s
    UNION ALL
    SELECT word, 'thread'
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM forum_threads WHERE coalesce(is_deleted, FALSE) = FALSE
    ) s
    UNION ALL
    SELECT word, 'deal'
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM deals WHERE status = 'active'
    ) s
  ) all_words
  WHERE length(word) >= 3
  ON CONFLICT (term) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_search_terms_trgm ON search_terms USING gin (term gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_suggest(query TEXT, max_results INT DEFAULT 3)
RETURNS TABLE (suggestion TEXT, similarity REAL)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (SELECT public.fold_srpski(query) AS term)
  SELECT t.term AS suggestion, similarity(t.term, q.term)::REAL AS similarity
  FROM search_terms t, q
  WHERE q.term <> ''
    AND length(t.term) >= 3
    AND t.term % q.term
    AND similarity(t.term, q.term) >= 0.35
  ORDER BY similarity DESC, t.weight DESC
  LIMIT LEAST(GREATEST(max_results, 1), 10);
$$;

-- GIN indeksi na izrazu `search_doc(...)` — isti fajl, pa funkcija SIGURNO postoji.
CREATE INDEX IF NOT EXISTS idx_articles_search_doc
  ON articles USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_threads_search_doc
  ON forum_threads USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_deals_search_doc
  ON deals USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(description, '')));
CREATE INDEX IF NOT EXISTS idx_games_search_doc
  ON games USING gin (public.search_doc(coalesce(title, '')));

-- Početno punjenje (idempotentno — TRUNCATE + INSERT).
SELECT search_terms_refresh();

-- ======================================================================
-- SEKCIJA: server/schema-2.6.2-search.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: trigrami (greške u kucanju) + leksikalni sloj
-- ----------------------------------------------------------------------------
-- Dva sloja se sabiraju u `rank`:
--
--  1. `pg_trgm` + `ILIKE` — delimične reči i greške u kucanju. Ovaj deo radi
--     čim je ova migracija primenjena.
--  2. `tsquery` nad normalizovanim vektorom iz `schema-2.6.2-search-lang.sql`
--     (skida dijakritiku, ćirilicu i padežne nastavke → „igre“, „igrama“ i
--     „igra“ pogode isti koren). Ako ta migracija nije primenjena, klijent
--     pošalje `ts_query = ''` i ovaj deo se preskače bez greške.
--
-- Privatnost / vidljivost:
--  - članci: samo `status = 'published'`,
--  - teme: samo postojeće (soft-deleted se ne vraćaju),
--  - deal-ovi: samo `status = 'active'` i bez isteklog roka.
--
-- Bez ove migracije server radi sa ILIKE fallbackom (isti ugovor, bez ranga
-- po trigramima).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- RANA provera: `search_articles/-threads/-deals` pozivaju `public.search_doc()` u
-- svom telu, a Postgres za SQL funkcije traži da pozvana funkcija **već
-- postoji** u trenutku `CREATE FUNCTION`.
DO $$
BEGIN
  IF to_regprocedure('public.fold_srpski(text)') IS NULL
     OR to_regprocedure('public.stem_srpski(text)') IS NULL
     OR to_regprocedure('public.search_doc(text)') IS NULL THEN
    RAISE EXCEPTION
      'Prvo pusti server/schema-2.6.2-search-lexicon.sql (fold_srpski/stem_srpski/search_doc), pa ovaj fajl.';
  END IF;
END $$;

-- Trigram indeksi (idempotentno). `IF NOT EXISTS` je i `CREATE INDEX` u
-- generisanom `schema-ALL.sql` (skripta ga dodaje sama).
CREATE INDEX IF NOT EXISTS idx_articles_title_trgm
  ON articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_excerpt_trgm
  ON articles USING gin (excerpt gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_title_trgm
  ON forum_threads USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_content_trgm
  ON forum_threads USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_deals_title_trgm
  ON deals USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_games_title_trgm
  ON games USING gin (title gin_trgm_ops);

--
 --
CREATE OR REPLACE FUNCTION search_snippet(body TEXT, query TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT coalesce(regexp_replace(coalesce(body, ''), '<[^>]+>', ' ', 'g'), '') AS plain
  ),
  q AS (
    -- `plainto_tsquery` nikad ne baca na proizvoljan tekst (samo ignoriše
    -- reči bez leksema). `numnode` je 0 za prazan upit.
    SELECT plainto_tsquery('simple', coalesce(query, '')) AS tsq, plain
    FROM src
  )
  SELECT CASE
    WHEN length(q.plain) = 0 THEN ''
    WHEN numnode(q.tsq) = 0 THEN left(q.plain, 200)
    ELSE ts_headline(
      'simple',
      q.plain,
      q.tsq,
      'StartSel=, StopSel=, MaxWords=45, MinWords=20, MaxFragments=1'
    )
  END
  FROM q;
$$;

--
 --
CREATE OR REPLACE FUNCTION search_articles(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  title TEXT,
  snippet TEXT,
  category TEXT,
  cover_image TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  ),
  lex AS (
    SELECT q.ts AS ts
    FROM q
    WHERE q.ts <> ''
      AND to_regclass('public.search_terms') IS NOT NULL
      AND to_regprocedure('public.search_doc(text)') IS NOT NULL
  )
  SELECT
    a.id, a.slug, a.title,
    coalesce(search_snippet(a.excerpt, q.term), '') AS snippet,
    a.category,
    coalesce(a.cover_image, '') AS cover_image,
    a.created_at,
    (
      similarity(a.title, q.term) * 3
      + similarity(coalesce(a.excerpt, ''), q.term) * 2
      + CASE WHEN a.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE WHEN coalesce(a.content, '') ILIKE '%' || q.term || '%' THEN 0.5 ELSE 0 END
      -- Leksikalni sloj: normalizovan vektor + koren reči (npr. „igre“ → „igr“).
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM articles a
  CROSS JOIN q
  WHERE a.status = 'published'
    AND (
      a.title ILIKE '%' || q.term || '%'
      OR coalesce(a.excerpt, '') ILIKE '%' || q.term || '%'
      OR coalesce(a.content, '') ILIKE '%' || q.term || '%'
      OR coalesce(a.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, a.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

--
 --
CREATE OR REPLACE FUNCTION search_threads(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  snippet TEXT,
  subforum TEXT,
  author TEXT,
  replies INT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  )
  SELECT
    t.id, t.title,
    coalesce(search_snippet(t.content, q.term), '') AS snippet,
    coalesce(c.slug, '') AS subforum,
    coalesce(u.username, '') AS author,
    coalesce(t.reply_count, 0) AS replies,
    t.created_at,
    (
      similarity(t.title, q.term) * 3
      + similarity(coalesce(t.content, ''), q.term)
      + CASE WHEN t.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(t.title, '') || ' ' || coalesce(t.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM forum_threads t
  CROSS JOIN q
  LEFT JOIN users u ON u.id = t.author_id
  LEFT JOIN forum_categories c ON c.id = t.category_id
  WHERE coalesce(t.is_deleted, FALSE) = FALSE
    AND (
      t.title ILIKE '%' || q.term || '%'
      OR coalesce(t.content, '') ILIKE '%' || q.term || '%'
      OR coalesce(t.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(t.title, '') || ' ' || coalesce(t.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, t.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

--
 --
CREATE OR REPLACE FUNCTION search_deals(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  store TEXT,
  price NUMERIC,
  currency TEXT,
  game_slug TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  )
  SELECT
    d.id, d.title, d.store, d.price, d.currency,
    g.slug AS game_slug,
    d.created_at,
    (
      similarity(d.title, q.term) * 3
      + CASE WHEN d.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE WHEN coalesce(d.description, '') ILIKE '%' || q.term || '%' THEN 0.5 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(g.title, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM deals d
  CROSS JOIN q
  LEFT JOIN games g ON g.id = d.game_id
  WHERE d.status = 'active'
    AND (d.expires_at IS NULL OR d.expires_at > NOW())
    AND (
      d.title ILIKE '%' || q.term || '%'
      OR coalesce(d.description, '') ILIKE '%' || q.term || '%'
      OR coalesce(d.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(g.title, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

-- RLS/dozvole: pretraga je javna, ali kroz service_role (backend) — anon klijent
-- ne treba da poziva RPC direktno.
REVOKE ALL ON FUNCTION search_articles(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_threads(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_deals(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_articles(TEXT, TEXT, REGCONFIG, INT) TO service_role;
GRANT EXECUTE ON FUNCTION search_threads(TEXT, TEXT, REGCONFIG, INT) TO service_role;
GRANT EXECUTE ON FUNCTION search_deals(TEXT, TEXT, REGCONFIG, INT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ======================================================================
-- SEKCIJA: server/schema-2.6.2-search-lang.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: rečnik i „da li ste mislili“ (PREUSMERENO)
-- ----------------------------------------------------------------------------
-- Ovaj fajl je ranije sadržao leksikalni sloj i rečnik. Sada je SVE u
-- `schema-2.6.2-search-lexicon.sql` (funkcije + rečnik + indeksi), jer se
-- redosled puštanja pokazao kao glavni izvor grešaka:
--
--   ERROR: 42883: function fold_srpski(text) does not exist
--   CONTEXT: SQL function "search_doc" during inlining
--
-- Fajl je namerno ostavljen kao bezopasan no-op (da stari linkovi i `schema-ALL`
-- ne pucaju) i samo proverava da je leksikon primenjen.
--
-- Redosled: lexicon → search → lang (ovaj fajl).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.search_doc(text)') IS NULL THEN
    RAISE EXCEPTION
      'Pusti server/schema-2.6.2-search-lexicon.sql — u njemu su fold_srpski, stem_srpski, search_doc, search_terms i search_suggest.';
  END IF;
END $$;

-- Rečnik se puni iz istog fajla; ovde je samo osvežavanje za slučaj da je
-- `lexicon` pušten pre nego što je baza imala članke/teme.
SELECT search_terms_refresh();

NOTIFY pgrst, 'reload schema';

-- ======================================================================
-- SEKCIJA: server/schema-2.6.4-sharing.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.4 — DELJENO STANJE IZMEĐU INSTANCI (N-09, B-15)
--
-- Do sada je troje stanja živelo u `Map`-u procesa. Sa 2+ API instance to je
-- davalo pogrešne odgovore, ne samo sporije:
--   * XP dnevni budžet  — limit od 300 XP se resetovao po instanci,
--   * pending 2FA setup — tajna iz `/2fa/setup` nije postojala na drugoj instanci,
--   * action tokeni     — fallback je ostajao u memoriji kada baza pukne,
--   * prisustvo (B-15)  — `users.status` je memorijski keš i nije znak prisustva.
--
-- Atomično podeljen novac: brojač se NE čita pa upisuje iz aplikacije, već
-- jedan `INSERT ... ON CONFLICT DO UPDATE` koji u istoj naredbi proverava limit
-- (paralelni zahtevi se serijalizuju na redu; nema dvostrukog trošenja).
-- Redosled: posle schema-2.6.2-search-lang.sql. Idempotentna je.
-- ============================================================================

-- ---------- 1. DNEVNI XP BUDŽET ----------
-- `day` je UTC datum (isti kao `new Date().toISOString().slice(0, 10)` u kodu).
-- TTL: stari redovi se brišu u `spend_daily_xp` (7 dana) — nema cron posla.
CREATE TABLE IF NOT EXISTS xp_budget (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_xp_budget_day ON xp_budget(day);

--
 --
CREATE OR REPLACE FUNCTION spend_daily_xp(p_user_id UUID, p_amount INTEGER, p_cap INTEGER DEFAULT 300)
RETURNS TABLE (granted INTEGER, used INTEGER, capped BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount INTEGER := GREATEST(COALESCE(p_amount, 0), 0);
  v_cap INTEGER := GREATEST(COALESCE(p_cap, 300), 0);
  v_used INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN QUERY SELECT 0, 0, v_amount > 0;
    RETURN;
  END IF;

  -- Proređeno čišćenje (1/50 poziva) — jeftino, bez cron posla.
  IF random() < 0.02 THEN
    DELETE FROM xp_budget WHERE day < (CURRENT_DATE - INTERVAL '7 days');
  END IF;

  INSERT INTO xp_budget AS b (user_id, day, xp, updated_at)
  VALUES (p_user_id, CURRENT_DATE, LEAST(v_amount, v_cap), NOW())
  ON CONFLICT (user_id, day) DO UPDATE
    SET xp = b.xp + LEAST(v_amount, GREATEST(v_cap - b.xp, 0)),
        updated_at = NOW()
  RETURNING b.xp INTO v_used;

  RETURN QUERY SELECT (v_used - GREATEST(v_used - v_amount, 0))::INTEGER, v_used, v_used < v_amount;
END;
$$;

--* Admin/test reset — bez `p_user_id` briše se ceo dan svih korisnika. 
CREATE OR REPLACE FUNCTION reset_daily_xp(p_user_id UUID DEFAULT NULL, p_day DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    DELETE FROM xp_budget WHERE day = p_day;
  ELSE
    DELETE FROM xp_budget WHERE user_id = p_user_id AND day = p_day;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER TABLE xp_budget ENABLE ROW LEVEL SECURITY;

-- ---------- 2. PENDING 2FA SETUP ----------
-- Tajna tokom uključivanja (setup → enable). Samo hash (SHA-256) tajne, TTL 10 min.
-- Potvrđena 2FA ostaje u `users.totp_secret` / `users.totp_enabled_at`.
CREATE TABLE IF NOT EXISTS totp_pending (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_totp_pending_created ON totp_pending(created_at);

--* Nepotrošena provera: `secret_enc` (AES-GCM iz `lib/crypto`) ili NULL. 
CREATE OR REPLACE FUNCTION peek_totp_enrollment(p_user_id UUID, p_ttl_seconds INTEGER DEFAULT 600)
RETURNS TABLE (secret_enc TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    SELECT t.secret_enc
    FROM totp_pending t
    WHERE t.user_id = p_user_id
      AND t.created_at > NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0));

  -- Istekli red je smeće, ne stanje. Briše se nad istim redom.
  DELETE FROM totp_pending
  WHERE user_id = p_user_id
    AND created_at <= NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0));
END;
$$;

--* Potvrđuje enrollment NE samo da ga pročita — drugi `enable` ne sme da prođe. 
CREATE OR REPLACE FUNCTION consume_totp_enrollment(p_user_id UUID, p_ttl_seconds INTEGER DEFAULT 600)
RETURNS TABLE (secret_enc TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM totp_pending
  WHERE user_id = p_user_id
    AND created_at > NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0))
  RETURNING totp_pending.secret_enc INTO secret_enc;

  RETURN NEXT;
END;
$$;

ALTER TABLE totp_pending ENABLE ROW LEVEL SECURITY;

-- ---------- 3. AUDIT ACTION BEZ NOVIH KOLONA ----------
-- `audit_log` (2.4.3) već ima `details JSONB` gde staje ceo zapis
-- (`actorUsername`, `targetUsername`, `from`, `to`). Indeks samo za listu.
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
  ON audit_log(action, created_at DESC);

-- ---------- 4. ASTEŽ IZ `auth_tokens` (N-09 — action tokeni) ----------
-- `consume_auth_token` je već atomski. Ovo je samo osvežavanje schema keša
-- posle ručnog unosa tokena u SQL Editor-u.
NOTIFY pgrst, 'reload schema';

-- ======================================================================
-- SEKCIJA: server/schema-2.6.5-rpc-fixes.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.5 — RPC POPRAVKE POSLE RAZLIKE KOD ⇄ ŠEMA
-- ----------------------------------------------------------------------------
-- Provera je pokazala tri mesta gde kôd zove funkciju koja u bazi **postoji,
-- ali pada** — dakle tiha greška u logu, a funkcija koju korisnik koristi
-- polovično radi. Nijedna od njih nije nova funkcionalnost, samo slaganje
-- šeme sa onim što `server/lib/store.ts` stvarno šalje.
--
--   1) `apply_article_reaction`  — upisuje u `articles.reactions`, kolonu koju
--      nijedna migracija ne pravi → `42703 column "reactions" does not exist`.
--   2) `cast_forum_vote`         — parametri su UUID, a aplikacija šalje `NULL`
--      za neciljanu granu (`p_reply_id` / `p_thread_id`) → `42804`/`22P02`, pa
--      glas padne na memorijski fallback.
--   3) `cast_deal_vote`          — isti problem sa `p_vote_type` (ako stigne
--      `NULL`, `NULLIF(lower(NULL), 'null')` je NULL, a provera tipa puca).
--   4+5) `advance_quest` i `apply_article_reaction` — PostgREST mora da ih vidi.
--
-- Nakon puštanja ove sekcije evaluacija glasa/README komentari su tačni;
-- idempotentna je (DROP + CREATE OR REPLACE).
-- ============================================================================

-- ---------- 1. `articles.reactions` — kolona za keš brojača ----------
-- `apply_article_reaction` (2.5.2) i `SupabaseArticleRepo.addReaction` je
-- čitaju kao `reactions`, a `CREATE TABLE articles` je nema. Bez nje svaka
-- reakcija pada na sporiji fallback (read-modify-write), a RPC vraća 42703.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS reactions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN articles.reactions IS
  'Keš brojača reakcija { like, gg, hype, fire, mind_blown }; izvor istine je article_reactions';

-- ---------- 2. `cast_forum_vote` — NULL-safe potpis ----------
-- Problem: `p_thread_id UUID` i `p_reply_id UUID` su strogi; PostgREST šalje
-- JSON `null`, ali Postgres pri pozivu iz SQL-a ne može da odredi tip praznog
-- parametra. Zato se parametri primaju kao TEXT i konvertuju u UUID unutar
-- funkcije — `NULL` i `''` znače „nije taj cilj“, umesto greške.
DROP FUNCTION IF EXISTS cast_forum_vote(UUID, UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION cast_forum_vote(
  p_user_id UUID,
  p_thread_id TEXT,
  p_reply_id TEXT,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_thread UUID := NULLIF(NULLIF(btrim(coalesce(p_thread_id, '')), ''), 'null')::UUID;
  v_reply UUID := NULLIF(NULLIF(btrim(coalesce(p_reply_id, '')), ''), 'null')::UUID;
  v_existing TEXT;
  v_delta INT := 0;
  v_karma INT;
  v_new_vote TEXT := NULLIF(lower(p_vote_type), 'null');
BEGIN
  IF p_vote_type IS NOT NULL AND v_new_vote IS NOT NULL AND v_new_vote NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  IF v_thread IS NOT NULL THEN
    SELECT karma INTO v_karma FROM forum_threads WHERE id = v_thread FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND thread_id = v_thread
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND thread_id = v_thread;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, thread_id, vote_type) VALUES (p_user_id, v_thread, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_threads SET karma = COALESCE(karma, 0) + v_delta WHERE id = v_thread RETURNING karma INTO v_karma;
    END IF;
  ELSIF v_reply IS NOT NULL THEN
    SELECT karma INTO v_karma FROM forum_replies WHERE id = v_reply FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND reply_id = v_reply
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND reply_id = v_reply;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, reply_id, vote_type) VALUES (p_user_id, v_reply, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_replies SET karma = COALESCE(karma, 0) + v_delta WHERE id = v_reply RETURNING karma INTO v_karma;
    END IF;
  ELSE
    -- Ni tema ni odgovor: ne postoji red na kome bi glas živeo.
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'karma', COALESCE(v_karma, 0));
END;
$$;

-- ---------- 3. `cast_deal_vote` — NULL-safe `p_vote_type` ----------
-- Isti razlog kao gore: `NULL`/`'null'` je otkaz glasa, ne greška.
CREATE OR REPLACE FUNCTION cast_deal_vote(
  p_user_id UUID,
  p_deal_id TEXT,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal UUID := NULLIF(NULLIF(btrim(coalesce(p_deal_id, '')), ''), 'null')::UUID;
  v_existing TEXT;
  v_delta INT := 0;
  v_score INT;
  v_new_vote TEXT := NULLIF(lower(p_vote_type), 'null');
BEGIN
  IF v_deal IS NULL THEN
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'score', 0);
  END IF;
  IF v_new_vote IS NOT NULL AND v_new_vote NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  SELECT score INTO v_score FROM deals WHERE id = v_deal FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'score', 0);
  END IF;

  SELECT vote_type INTO v_existing
  FROM deal_votes WHERE user_id = p_user_id AND deal_id = v_deal
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
    DELETE FROM deal_votes WHERE user_id = p_user_id AND deal_id = v_deal;
  END IF;

  IF v_new_vote IS NOT NULL THEN
    INSERT INTO deal_votes (user_id, deal_id, vote_type) VALUES (p_user_id, v_deal, v_new_vote);
    v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE deals SET score = score + v_delta WHERE id = v_deal RETURNING score INTO v_score;
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'score', COALESCE(v_score, 0));
END;
$$;

-- ---------- 4. DOZVOLE ZA RPC-OVE KOJE KORISTI SAMO BACKEND ----------
-- `READ`/`anon` ključ ne treba da menja XP, glasove i kvestove direktno.
-- Ostali RPC-ovi iz ranijih sekcija ovo nemaju — ovde se popunjava za sve
-- mutirajuće funkcije da bi pravilo važilo jednako svuda.
DO $$
DECLARE
  fn TEXT;
  signatures TEXT[] := ARRAY[
    'spend_daily_xp(UUID, INTEGER, INTEGER)',
    'reset_daily_xp(UUID, DATE)',
    'consume_totp_enrollment(UUID, INTEGER)',
    'peek_totp_enrollment(UUID, INTEGER)',
    'cast_forum_vote(UUID, TEXT, TEXT, TEXT)',
    'cast_deal_vote(UUID, TEXT, TEXT)',
    'advance_quest(UUID, VARCHAR, INTEGER)',
    'apply_article_reaction(UUID, TEXT)',
    'consume_auth_token(TEXT, VARCHAR)'
  ];
BEGIN
  FOREACH fn IN ARRAY signatures LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      -- Druga migracija nije puštena (npr. pravimo bazu od nule do ovde) — preskoči.
      RAISE NOTICE 'Preskočeno: % (funkcija ne postoji)', fn;
    END;
  END LOOP;
END $$;

-- ---------- 5. OSVEŽI POSTGREST KEŠ ----------
-- Bez ovoga `rpc('apply_article_reaction')` i `rpc('advance_quest')` vraćaju
-- `PGRST202` do restarta API-ja.
NOTIFY pgrst, 'reload schema';

-- SEKCIJA: server/schema-2.6.6-search-replies.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.6 — PRETRAGA ODGOVORA U TEMAMA (F-13)
-- ----------------------------------------------------------------------------
-- Do sada je `/api/search` vraćao samo TEMU (naslov + prvi post), pa je
-- korisnik koji traži reč iz treće strane teme dobijao temu i morao da je
-- čita celu. Ova sekcija dodaje `search_replies` — isti leksikalni sloj
-- (`fold_srpski`/`stem_srpski`/`search_doc`) i isti ugovor kao `search_threads`,
-- ali red po odgovoru, sa `thread_title` i `thread_id` za duboki link
-- (`/thread/<id>#post-<reply_id>`).
--
-- Rezultat NAMERNO ne ulazi u `type=all` (vidi `server/lib/search.ts`):
-- odgovori su mnogo brojniji od tema i potisnuli bi bolje pogotke.
-- Idempotentno: DROP + CREATE OR REPLACE.
-- ============================================================================

DROP FUNCTION IF EXISTS search_replies(TEXT, TEXT, REGCONFIG, INT);

CREATE OR REPLACE FUNCTION search_replies(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  thread_id UUID,
  thread_title TEXT,
  snippet TEXT,
  subforum TEXT,
  author TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  )
  SELECT
    r.id, r.thread_id, t.title AS thread_title,
    coalesce(search_snippet(r.content, q.term), '') AS snippet,
    coalesce(c.slug, '') AS subforum,
    coalesce(u.username, '') AS author,
    r.created_at,
    (
      similarity(coalesce(r.content, ''), q.term)
      + CASE WHEN coalesce(r.content, '') ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(r.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM forum_replies r
  JOIN forum_threads t ON t.id = r.thread_id
  CROSS JOIN q
  LEFT JOIN users u ON u.id = r.author_id
  LEFT JOIN forum_categories c ON c.id = t.category_id
  WHERE coalesce(r.is_deleted, FALSE) = FALSE
    AND coalesce(t.is_deleted, FALSE) = FALSE
    AND (
      coalesce(r.content, '') ILIKE '%' || q.term || '%'
      OR (q.ts <> '' AND public.search_doc(coalesce(r.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, r.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

-- Ista dozvola kao za ostale pretrage: samo backend (`service_role`).
REVOKE ALL ON FUNCTION search_replies(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_replies(TEXT, TEXT, REGCONFIG, INT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- SEKCIJA: server/schema-2.6.6-deal-topic.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.6 — TEMA IZ DEAL-A / „Diskutuj o ovom popustu“ (F-3)
-- ----------------------------------------------------------------------------
-- `forum_threads.deal_id` je jedina nova kolona. U `server/schema-ALL.sql`
-- kolona se dodaje BEZ FK-a (tabela `deals` nastaje tek u sekciji 2.6.0, a
-- `schema-ALL.sql` se pušta kao jedna transakcija) — zato se referenca
-- uspostavlja ovde, posle `10-2.6.0-deals.sql`.
--
-- `ON DELETE SET NULL`: brisanje deal-a ne briše diskusiju, samo gubi karticu.
-- Idempotentno — bezbedno za ponovno puštanje.
-- ============================================================================

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deal_id UUID;

-- F-7.1 #8 — „prati temu mejlom“: praćenje ostaje in-app, ova kolona dodaje mejl
-- na novi odgovor (najviše 1 mejl / 15 min po korisniku i temi).
ALTER TABLE thread_subscriptions
  ADD COLUMN IF NOT EXISTS email_on_reply BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_email
  ON thread_subscriptions(thread_id) WHERE email_on_reply;

COMMENT ON COLUMN forum_threads.deal_id IS
  'F-3 — deal iz kojeg je tema otvorena („Diskutuj o ovom popustu“); NULL za obične teme';

-- FK dodajemo samo ako već ne postoji (ponovno puštanje ne puca).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_deal_id_fkey'
  ) THEN
    ALTER TABLE forum_threads
      ADD CONSTRAINT forum_threads_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forum_threads_deal ON forum_threads(deal_id);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NEXUS 2.7.0 — F-9 „Kupio sam“ / F-4 PRICE ALERT / F-5 KOLEKCIJE / F-10 WARNINGS
-- ----------------------------------------------------------------------------
-- Sve je idempotentno (`IF NOT EXISTS`), pa se fajl i dalje može puštati više
-- puta. Nema zavisnosti između sekcija — svaka se može primeniti i zasebno.
-- ============================================================================

-- ---------- F-9: „KUPIO SAM“ (deal_claims) ----------
-- Socijalni dokaz, NE verifikacija kupovine: korisnik sam potvrđuje da je
-- kupio preko ovog deal-a. UNIQUE (deal_id, user_id) → dvostruki klik i dva
-- taba ne naduvavaju broj. `deals.score` ostaje netaknut (glasovi su drugo).
CREATE TABLE IF NOT EXISTS deal_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_claims_deal ON deal_claims (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_claims_user ON deal_claims (user_id);

ALTER TABLE deal_claims ENABLE ROW LEVEL SECURITY;

-- ---------- F-4: PRICE ALERT (deal_watches) ----------
-- Korisnik prati IGRU (`game_id`), ne pojedinačni deal; obaveštenje ide kada
-- cena padne ispod `target_price`. `game_title`/`game_slug` su snapshot da
-- praćenje preživi brisanje igre iz kataloga. `notified_at` je i throttling
-- (1 mejl / 24 h po korisniku i igri) i znak da je mejl poslat.
CREATE TABLE IF NOT EXISTS deal_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  game_title VARCHAR(200) NOT NULL,
  game_slug VARCHAR(200),
  target_price NUMERIC(10, 2) NOT NULL CHECK (target_price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

-- Jedno praćenje po (korisnik, igra) — ponovni POST samo menja prag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_watches_user_game
  ON deal_watches (user_id, game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_watches_game ON deal_watches (game_id);

ALTER TABLE deal_watches ENABLE ROW LEVEL SECURITY;

-- ---------- F-5: KOLEKCIJE / LISTE IGARA ----------
-- Korisničke liste („Top 10 RPG 2026“). Svaka je javna SEO stranica
-- (/collections/:slug); `slug` je globalno jedinstven jer se koristi u URL-u.
CREATE TABLE IF NOT EXISTS game_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  description VARCHAR(600),
  is_public BOOLEAN NOT NULL DEFAULT true,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_collections_user ON game_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_game_collections_public ON game_collections (is_public, created_at DESC);

CREATE TABLE IF NOT EXISTS game_collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES game_collections(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  game_title VARCHAR(200) NOT NULL,
  game_slug VARCHAR(200),
  game_cover VARCHAR(500),
  note VARCHAR(280),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_collection_items_collection
  ON game_collection_items (collection_id, position);
-- Ista igra ne može dva puta u istoj listi.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_collection_items_unique
  ON game_collection_items (collection_id, game_slug) WHERE game_slug IS NOT NULL;

-- Jedan glas po korisniku po listi (up/down), isto pravilo kao `deal_votes`.
CREATE TABLE IF NOT EXISTS game_collection_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES game_collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(4) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_collection_votes_collection ON game_collection_votes (collection_id);

ALTER TABLE game_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_collection_votes ENABLE ROW LEVEL SECURITY;

-- ---------- F-10: UPOZORENJA (warnings) PRE BANA ----------
-- Ban je poslednja mera; moderator prvo daje upozorenje sa razlogom i rokom.
-- `acknowledged_at` beleži da je korisnik video upozorenje (banner u UI-ju),
-- a `revoked_at` da ga je moderator poništio (pogrešna prijava).
CREATE TABLE IF NOT EXISTS user_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(500) NOT NULL,
  -- thread/reply/article/comment/user/deal — šta je bilo predmet prijave.
  target_type VARCHAR(20),
  target_id UUID,
  expires_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON user_warnings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_warnings_active
  ON user_warnings (user_id) WHERE revoked_at IS NULL;

ALTER TABLE user_warnings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE deal_claims IS
  'F-9 — korisnik potvrdio da je kupio preko deal-a (socijalni dokaz, ne verifikacija)';
COMMENT ON TABLE deal_watches IS
  'F-4 — praćenje cene igre; mejl kada deal padne ispod target_price (throttle 24 h)';
COMMENT ON TABLE game_collections IS
  'F-5 — korisničke liste igara (javna SEO stranica /collections/:slug)';
COMMENT ON TABLE user_warnings IS
  'F-10 — upozorenja moderatora pre bana; ban ostaje u bans tabeli';

-- ---------- F-2: DNEVNI LOOP (streak + dnevni kvest) ----------
-- Jedan red po (korisnik, dan). `day` je kalendarski datum u vremenskoj zoni
-- servera (`dayKey()` u `server/lib/dailyLoop.ts`), pa se streak računa bez
-- vremenskih zona u SQL-u. `bonus_claimed`/`quest_completed` su idempotentne
-- oznake (drugi post istog dana ne daje bonus ponovo).
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  bonus_claimed BOOLEAN NOT NULL DEFAULT false,
  quest_completed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_day ON user_daily_activity (day);

ALTER TABLE user_daily_activity ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE user_daily_activity IS
  'F-2 — dnevna aktivnost (streak, XP dana, bonus za prvi post, dnevni kvest)';

-- ---------- F-7: WEB PUSH PRETPLATE (push_subscriptions) ----------
-- Jedan red po uređaju/pretplati. `endpoint` je jedinstven kod push servisa
-- (FCM/Mozilla autopush), pa je UNIQUE globalan — isti uređaj koji se prijavi
-- drugim nalogom menja vlasnika umesto da pravi duplikat.
-- `p256dh`/`auth` su javni ključevi pretplate (ne tajne korisnika).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE push_subscriptions IS
  'F-7 — web push pretplate (jedan red po uređaju; ruta /api/push/*)';

-- ---------- F-11: KALKULATOR BUILD-a ----------
-- Katalog komponenti sa cenom kod JEDNE domaće prodavnice (moderator menja
-- cenu kada se promeni — isti obrazac kao `deals`, bez scrapinga). Build je
-- korisnički izbor komponenti; `share_id` je kratak javni ID za deljenje.
CREATE TABLE IF NOT EXISTS pc_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(20) NOT NULL CHECK (category IN (
    'cpu','gpu','motherboard','ram','storage','psu','case','cooler','monitor','peripheral'
  )),
  name VARCHAR(140) NOT NULL,
  brand VARCHAR(60),
  spec VARCHAR(160),
  price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'RSD',
  store VARCHAR(80) NOT NULL,
  url VARCHAR(1000),
  image_url VARCHAR(1000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_components_category ON pc_components (category, price);

CREATE TABLE IF NOT EXISTS pc_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  share_id VARCHAR(16) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_builds_user ON pc_builds (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pc_build_items (
  build_id UUID NOT NULL REFERENCES pc_builds(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES pc_components(id) ON DELETE CASCADE,
  qty SMALLINT NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 10),
  PRIMARY KEY (build_id, component_id)
);

ALTER TABLE pc_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_build_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pc_components IS
  'F-11 — katalog PC komponenti sa cenama kod domaćih prodavnica (kalkulator build-a)';
COMMENT ON TABLE pc_builds IS
  'F-11 — sačuvani build-ovi korisnika; `share_id` je javni deljivi ID';

-- ======================================================================
-- F-15 — TRUSTED DEVICE ZA 2FA („zapamti ovaj uređaj 30 dana“)
-- ======================================================================
-- Cookie `nx_trust` nosi sirovi token; ovde je SAMO SHA-256 hash i `device_id`
-- (jedan red = jedan uređaj). Čuvanje po `device_id` omogućava:
--   * svako ponovno uspešno 2FA prijavljivanje na isti uređaj produžava rok;
--   * isključivanje 2FA i promena lozinke brišu sve redove korisnika.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_hash ON trusted_devices (token_hash);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices (expires_at);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE trusted_devices IS
  'F-15 — 2FA trusted devices: hash tokena iz HttpOnly cookie-ja nx_trust, rok 30 dana';

-- ============================================================================
-- NEXUS 2.7.2 — SITNI DELJENI KLJUČ–VREDNOST, TIPOVI NOTIFIKACIJA, SOFT DELETE
-- ----------------------------------------------------------------------------
-- Zatvara rupe između koda i šeme koje su ostale posle 2.7.0. Isti sadržaj je
-- i u `server/sql/22-2.7.2-email-notifikacije.sql` (taj fajl je samostalna
-- migracija za živu bazu). Idempotentno — bezbedno za ponovno puštanje.
-- ============================================================================

-- ---------- 1. `site_meta` (deljeni ključ–vrednost) ----------
-- Koriste ga: throttle „1 mejl / 15 min“ po temi (`lib/threadEmails.ts`),
-- marker poslednjeg digesta (`lib/digest.ts`), red zakazanih kampanja
-- (`lib/campaigns.ts`). Bez tabele sve tri stvari tiho žive u `Map`-u procesa.
CREATE TABLE IF NOT EXISTS site_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_meta_updated ON site_meta (updated_at);

ALTER TABLE site_meta ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE site_meta IS
  'Deljeni ključ–vrednost: digest marker, throttle mejla po temi, red zakazanih newsletter kampanja';

-- ---------- 2. `notifications.type` — prošireno CHECK ----------
-- Kod šalje i `warning` (F-10), `streak` i `level_up` (F-2), `price_alert` (F-4);
-- bez ovoga insert puca (23514) i te notifikacije nikad ne stižu u zvonce.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Živa baza (2.4.x) ima inline CHECK iz `CREATE TABLE`; ime zavisi od verzije
-- Postgresa (`notifications_type_check`, `…check1`). Zato tražimo svaki CHECK
-- na `notifications` koji pominje `reply` i uklanjamo ga pre novog.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reply%'
  LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'reply', 'mention', 'upvote', 'badge_earned', 'quest_completed', 'system',
    'warning', 'streak', 'level_up', 'price_alert'
  ));

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE is_read = false;

-- ---------- 3. SOFT DELETE TEME (F-10 „Vrati“) ----------
-- `is_deleted` postoji od 2.4.1; ovde su samo tragovi ko/ kada.
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forum_threads_visible
  ON forum_threads (last_activity_at DESC) WHERE is_deleted = false;

NOTIFY pgrst, 'reload schema';
