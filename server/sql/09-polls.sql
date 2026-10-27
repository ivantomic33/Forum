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
