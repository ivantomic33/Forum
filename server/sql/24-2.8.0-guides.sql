-- ============================================================================
-- NEXUS 2.8.0 — VODIČI (game_guides) + GLASANJE (guide_votes)
-- ----------------------------------------------------------------------------
-- Community vodiči vezani za igru (Game Page):
--   * game_guides  — jedan red po vodiču; `slug` je globalno unikatan jer ide u
--                    SEO URL `/games/:gameSlug/guides/:guideSlug`
--                    (vodič pripada jednoj igri, ali URL nije kolizija sa drugim
--                    igrama jer sadrži i gameSlug; globalni UNIQUE je jednostavno
--                    sigurno pravilo i indeksira se istim indeksom);
--   * guide_votes  — jedan glas po korisniku po vodiču (up/down), isti obrazac
--                    kao `deal_votes`;
--   * cast_guide_vote — atomični glas (FOR UPDATE lock + delta), kopija
--                    `cast_deal_vote` obrasca; vraća { changed, delta, score }.
--
-- Idempotentno — bezbedno za ponovno puštanje. Pokreni NAKON
-- `21-2.7.0-retention.sql` i `22-2.7.2-email-notifikacije.sql`.
-- ============================================================================

-- ---------- 1. VODIČI ----------
-- `status`: 'published' je javno vidljiv; 'draft' vidi samo autor (u budućoj
-- moderaciji), 'archived' = skinut sa liste, ali zadržan zbog linkova.
CREATE TABLE IF NOT EXISTS game_guides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug VARCHAR(160) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  summary VARCHAR(300),
  -- Sadržaj je sanitizovani HTML (server `sanitizeRichText`), isti oblik kao
  -- sadržaj tema/članaka — klijent ga renderuje kroz DOMPurify.
  content TEXT NOT NULL,
  category VARCHAR(24) NOT NULL DEFAULT 'general'
    CHECK (category IN ('walkthrough', 'builds', 'achievements', 'tips', 'general')),
  score INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liste po igri: top (score) i najnoviji; filter po kategoriji se dodaje na
-- pretragu po indeksu (bez posebnog indeksa — kategorija je malo N vrednosti).
CREATE INDEX IF NOT EXISTS idx_game_guides_game_status_score
  ON game_guides (game_id, status, score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_guides_game_status_created
  ON game_guides (game_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_guides_author ON game_guides (author_id);

COMMENT ON TABLE game_guides IS
  '2.8.0 — community vodiči za igru (Game Page sekcija „Vodiči“, URL /games/:gameSlug/guides/:guideSlug)';

-- ---------- 2. GLASANJE ----------
-- Isti oblik kao `deal_votes`: promena glasa je UPDATE, otkaz je DELETE.
CREATE TABLE IF NOT EXISTS guide_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL REFERENCES game_guides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(8) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guide_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_guide_votes_guide ON guide_votes (guide_id);
CREATE INDEX IF NOT EXISTS idx_guide_votes_user ON guide_votes (user_id);

-- ---------- ATOMIČNI GLAS ----------
-- NULL-safe `p_vote_type` (isti obrazac kao `cast_deal_vote` iz 2.6.5):
-- 'up' | 'down' | NULL/'null' (otkaz). Vraća { changed, delta, score }.
CREATE OR REPLACE FUNCTION cast_guide_vote(
  p_user_id UUID,
  p_guide_id TEXT,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_guide UUID := NULLIF(NULLIF(btrim(coalesce(p_guide_id, '')), ''), 'null')::UUID;
  v_existing TEXT;
  v_delta INT := 0;
  v_score INT;
  v_new_vote TEXT := NULLIF(lower(p_vote_type), 'null');
BEGIN
  IF v_guide IS NULL THEN
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'score', 0);
  END IF;
  IF v_new_vote IS NOT NULL AND v_new_vote NOT IN ('up', 'down') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  SELECT score INTO v_score FROM game_guides WHERE id = v_guide FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false, 'delta', 0, 'score', 0);
  END IF;

  SELECT vote_type INTO v_existing
  FROM guide_votes WHERE user_id = p_user_id AND guide_id = v_guide
  FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
    DELETE FROM guide_votes WHERE user_id = p_user_id AND guide_id = v_guide;
  END IF;

  IF v_new_vote IS NOT NULL THEN
    INSERT INTO guide_votes (user_id, guide_id, vote_type) VALUES (p_user_id, v_guide, v_new_vote);
    v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE game_guides SET score = score + v_delta WHERE id = v_guide RETURNING score INTO v_score;
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'score', COALESCE(v_score, 0));
END;
$$;

-- ---------- PREGLEDI (RPC bez čitanja reda) ----------
CREATE OR REPLACE FUNCTION increment_guide_views(p_guide_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE game_guides SET views_count = COALESCE(views_count, 0) + 1
  WHERE id = NULLIF(NULLIF(btrim(coalesce(p_guide_id, '')), ''), 'null')::UUID;
$$;

REVOKE ALL ON FUNCTION increment_guide_views(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_guide_views(TEXT) TO service_role;

-- ---------- TRIGGER: updated_at ----------
DROP TRIGGER IF EXISTS update_game_guides_updated_at ON game_guides;
CREATE TRIGGER update_game_guides_updated_at
  BEFORE UPDATE ON game_guides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- 5. RLS (deny-by-default; service_role zaobilazi) ----------
ALTER TABLE game_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE guide_votes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION cast_guide_vote(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cast_guide_vote(UUID, TEXT, TEXT) TO service_role;

-- ---------- 6. OSVEŽI POSTGREST KEŠ ----------
NOTIFY pgrst, 'reload schema';

-- Provera posle puštanja:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname='public' AND tablename IN ('game_guides','guide_votes');
