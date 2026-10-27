-- SEKCIJA: server/schema-2.5.3.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.3 — TRANSAKCIONI GLASOVI I AGREGATI ZA LISTE
-- Pokreni nakon schema.sql … i schema-2.5.2.sql.
-- Idempotentna je i bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- F-17: JEDAN GLAS PO KORISNIKU ----------
-- `forum_votes` ima XOR thread_id/reply_id i nije garantovao jedinstven glas
-- pri paralelnim zahtevima. Parcijalni UNIQUE indeksi to čine nemogućim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_votes_user_thread
  ON forum_votes (user_id, thread_id)
  WHERE thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_votes_user_reply
  ON forum_votes (user_id, reply_id)
  WHERE reply_id IS NOT NULL;

-- Postojeći duplikati (ako ih ima) ne smeju da blokiraju migraciju: ostavlja se
-- najstariji glas po (korisnik, cilj), ostatak se briše.
DELETE FROM forum_votes v
USING forum_votes older
WHERE v.thread_id IS NOT NULL
  AND older.thread_id = v.thread_id
  AND older.user_id = v.user_id
  AND older.id < v.id;

DELETE FROM forum_votes v
USING forum_votes older
WHERE v.reply_id IS NOT NULL
  AND older.reply_id = v.reply_id
  AND older.user_id = v.user_id
  AND older.id < v.id;

-- ---------- F-17: ATOMIČNI GLAS ----------
-- Jedan poziv: zaključaj cilj, skini stari glas, upiši novi i pomeri karmu.
-- Vraća { changed, delta, karma } — ruta po `changed` odlučuje o XP-u i notifikaciji.
CREATE OR REPLACE FUNCTION cast_forum_vote(
  p_user_id UUID,
  p_thread_id UUID,
  p_reply_id UUID,
  p_vote_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing TEXT;
  v_delta INT := 0;
  v_karma INT;
  v_new_vote TEXT := NULLIF(p_vote_type, 'null');
BEGIN
  IF p_vote_type IS NOT NULL AND p_vote_type NOT IN ('up', 'down', 'null') THEN
    RAISE EXCEPTION 'invalid vote type: %', p_vote_type;
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT karma INTO v_karma FROM forum_threads WHERE id = p_thread_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND thread_id = p_thread_id
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND thread_id = p_thread_id;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, thread_id, vote_type) VALUES (p_user_id, p_thread_id, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_threads SET karma = karma + v_delta WHERE id = p_thread_id RETURNING karma INTO v_karma;
    END IF;
  ELSE
    SELECT karma INTO v_karma FROM forum_replies WHERE id = p_reply_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('changed', false, 'delta', 0, 'karma', 0);
    END IF;

    SELECT vote_type INTO v_existing
    FROM forum_votes WHERE user_id = p_user_id AND reply_id = p_reply_id
    FOR UPDATE;

    IF v_existing IS NOT NULL THEN
      v_delta := v_delta - CASE WHEN v_existing = 'up' THEN 1 ELSE -1 END;
      DELETE FROM forum_votes WHERE user_id = p_user_id AND reply_id = p_reply_id;
    END IF;

    IF v_new_vote IS NOT NULL THEN
      INSERT INTO forum_votes (user_id, reply_id, vote_type) VALUES (p_user_id, p_reply_id, v_new_vote);
      v_delta := v_delta + CASE WHEN v_new_vote = 'up' THEN 1 ELSE -1 END;
    END IF;

    IF v_delta <> 0 THEN
      UPDATE forum_replies SET karma = karma + v_delta WHERE id = p_reply_id RETURNING karma INTO v_karma;
    END IF;
  END IF;

  RETURN jsonb_build_object('changed', v_delta <> 0, 'delta', v_delta, 'karma', COALESCE(v_karma, 0));
END;
$$;

-- ---------- F-18: AGREGATI (COUNT/SUM bez učitavanja redova) ----------
CREATE OR REPLACE FUNCTION sum_article_views()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(views), 0)::BIGINT FROM articles;
$$;

CREATE OR REPLACE FUNCTION sum_thread_views()
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(views), 0)::BIGINT FROM forum_threads WHERE is_deleted = false;
$$;

-- Indeksi za paginaciju/sortiranje listi (F-18) — keyset po (sort, id).
CREATE INDEX IF NOT EXISTS idx_forum_threads_pinned_karma
  ON forum_threads (is_pinned DESC, karma DESC, id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_forum_threads_created
  ON forum_threads (created_at DESC, id)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_users_leaderboard_karma
  ON users (karma DESC, level DESC, xp DESC) WHERE is_banned IS NOT TRUE;
-- N-07 — `ORDER BY level DESC, xp DESC, karma DESC` iz `db.users.leaderboard`
-- (jedini neuslovni red u toj ruti). Isti naziv kao u 2.5.1 → već kreiran indeks
-- (level, xp) se preskače, pa ovde ostaje samo onaj sa trećim ključem.
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_level
  ON users (level DESC, xp DESC, karma DESC) WHERE is_banned IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_articles_created
  ON articles (created_at DESC, id);

-- ======================================================================
