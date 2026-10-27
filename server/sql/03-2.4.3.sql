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
