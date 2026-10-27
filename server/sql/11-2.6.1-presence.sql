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
