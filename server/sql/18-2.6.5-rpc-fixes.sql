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
