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
