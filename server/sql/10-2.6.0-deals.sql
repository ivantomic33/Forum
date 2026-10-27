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
