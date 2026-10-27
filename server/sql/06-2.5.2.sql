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
