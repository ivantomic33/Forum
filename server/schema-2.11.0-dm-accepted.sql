-- ============================================================================
-- 2.11.0 — PRIVATNE PORUKE (DM) + PRIHVAĆEN ODGOVOR
-- ============================================================================
-- Deo `schema-ALL.sql`; ovaj fajl je za baze koje su već puštene ranije.
-- Idempotentno je — bezbedno ga je pokrenuti više puta.
-- ============================================================================

-- ---------- Prihvaćen odgovor (accepted answer) ----------
-- Autor teme označava jedan odgovor kao rešenje. FK je ON DELETE SET NULL:
-- brisanje odgovora ne sme da obori temu.
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS accepted_reply_id UUID
  REFERENCES forum_replies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forum_threads_accepted
  ON forum_threads (accepted_reply_id)
  WHERE accepted_reply_id IS NOT NULL;

-- ---------- DM (privatre poruke) ----------
CREATE TABLE IF NOT EXISTS dm_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_low UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT dm_conversations_ordered CHECK (user_low < user_high),
  CONSTRAINT dm_conversations_pair UNIQUE (user_low, user_high)
);

CREATE INDEX IF NOT EXISTS idx_dm_conversations_low
  ON dm_conversations (user_low, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_high
  ON dm_conversations (user_high, last_message_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
  ON direct_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_unread
  ON direct_messages (sender_id, read_at) WHERE read_at IS NULL;

ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Provera:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='forum_threads' AND column_name='accepted_reply_id';
-- SELECT tablename FROM pg_tables
-- WHERE schemaname='public' AND tablename IN ('dm_conversations','direct_messages');
