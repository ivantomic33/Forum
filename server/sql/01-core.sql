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
  -- 2.10.0 — 'scheduled' status: `published_at` drži ZAKAZANI trenutak objave.
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'scheduled', 'archived')),
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
-- 2.10.0 — periodično pretraživanje dospelih zakazanih članaka (delimični indeks).
CREATE INDEX IF NOT EXISTS idx_articles_scheduled
  ON articles (status, published_at)
  WHERE status = 'scheduled';

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
