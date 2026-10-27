-- SEKCIJA: server/schema-2.4.4.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.4.4 — POVEZIVANJE (front ⇄ API ⇄ baza)
-- Pokreni nakon schema.sql, schema-2.4.1.sql i schema-2.4.3.sql.
-- Idempotentna je; bezbedna za višestruko pokretanje.
--
-- Cilj: ukloniti mesta gde je funkcionalnost postojala samo kao ekran
-- ili samo kao tabela.
-- ============================================================

-- ---------- 1. BADGES / CONNECTED ACCOUNTS — fallback kolone ----------
-- Adapter koristi ove kolone kao materializovani keš; izvor istine su
-- `user_badges` i `connected_accounts` tabele (backfill ispod).
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS connected_accounts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill postojećih user_badges → users.badges (jednokratno i bez duplikata)
UPDATE users u
SET badges = COALESCE(sub.codes, '{}'::text[])
FROM (
  SELECT ub.user_id, array_agg(b.code ORDER BY b.code) AS codes
  FROM user_badges ub
  JOIN badges b ON b.id = ub.badge_id
  GROUP BY ub.user_id
) sub
WHERE u.id = sub.user_id
  AND (u.badges IS NULL OR u.badges = '{}');

-- Backfill connected_accounts → users.connected_accounts
UPDATE users u
SET connected_accounts = COALESCE(sub.accounts, '{}'::jsonb)
FROM (
  SELECT user_id, jsonb_object_agg(platform, platform_username) AS accounts
  FROM connected_accounts
  GROUP BY user_id
) sub
WHERE u.id = sub.user_id
  AND (u.connected_accounts IS NULL OR u.connected_accounts = '{}'::jsonb);

-- ---------- 2. AUTH TOKENS — dovršavanje 2.4.3 tabele ----------
-- `auth_tokens` je već napravljena u 2.4.3. Sigurnosna pravila:
--   * nikad se ne čuva plain token, samo SHA-256 hash
--   * token se troši atomski (UPDATE ... WHERE used_at IS NULL)
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION consume_auth_token(p_hash TEXT, p_type VARCHAR)
RETURNS TABLE (user_id UUID)
LANGUAGE sql AS $$
  UPDATE auth_tokens
  SET used_at = NOW()
  WHERE hash = p_hash
    AND type = p_type
    AND used_at IS NULL
    AND expires_at > NOW()
  RETURNING auth_tokens.user_id;
$$;

-- ---------- 3. SUBFORUM STATISTIKA U BAZI ----------
-- Broj tema/poruka se računa SQL-om (jeden upit), ne skeniranjem liste u aplikaciji.
CREATE OR REPLACE FUNCTION forum_category_stats()
RETURNS TABLE (
  id UUID,
  slug VARCHAR,
  name VARCHAR,
  description TEXT,
  icon VARCHAR,
  color VARCHAR,
  thread_count BIGINT,
  post_count BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.id,
    c.slug,
    c.name,
    c.description,
    c.icon,
    c.color,
    COUNT(DISTINCT t.id) AS thread_count,
    COUNT(DISTINCT t.id) + COUNT(rep.reply_id) AS post_count
  FROM forum_categories c
  LEFT JOIN forum_threads t
    ON t.category_id = c.id
   AND t.is_deleted IS NOT TRUE
  LEFT JOIN LATERAL (
    SELECT rr.id AS reply_id
    FROM forum_replies rr
    WHERE rr.thread_id = t.id
      AND rr.is_deleted IS NOT TRUE
  ) rep ON TRUE
  WHERE c.is_active IS NOT FALSE
  GROUP BY c.id, c.slug, c.name, c.description, c.icon, c.color
  ORDER BY c.sort_order NULLS LAST, c.name;
$$;

-- ---------- 4. KARMA AUTORA — atomični RPC ----------
-- Glas menja temu/odgovor i autorovu karmu u istom pozivu.
CREATE OR REPLACE FUNCTION apply_user_karma(p_user_id UUID, p_delta INTEGER) RETURNS void
LANGUAGE sql AS $$
  UPDATE users SET karma = COALESCE(karma, 0) + p_delta WHERE id = p_user_id;
$$;

-- ---------- 5. KARMA LEADERBOARD IZ STVARNIH GLASOVA ----------
-- Keš u users.karma je brz za čitanje; ovaj RPC služi za administrativnu
-- rekalkulaciju (npr. posle migracije podataka).
CREATE OR REPLACE FUNCTION recalculate_user_karma(p_user_id UUID) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  total INTEGER;
BEGIN
  SELECT
    COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_threads t ON t.id = v.thread_id
      WHERE t.author_id = p_user_id AND v.vote_type = 'up'), 0)
    - COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_threads t ON t.id = v.thread_id
      WHERE t.author_id = p_user_id AND v.vote_type = 'down'), 0)
    + COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_replies r ON r.id = v.reply_id
      WHERE r.author_id = p_user_id AND v.vote_type = 'up'), 0)
    - COALESCE((SELECT COUNT(*) FROM forum_votes v
      JOIN forum_replies r ON r.id = v.reply_id
      WHERE r.author_id = p_user_id AND v.vote_type = 'down'), 0)
  INTO total;

  UPDATE users SET karma = total WHERE id = p_user_id;
  RETURN total;
END;
$$;

-- ---------- 6. QUEST PROGRESS NA SERVERU ----------
-- awardXp() zove `advance_quest` — jedan atomični UPDATE po kvestu.
CREATE OR REPLACE FUNCTION advance_quest(p_user_id UUID, p_code VARCHAR, p_amount INTEGER DEFAULT 1)
RETURNS TABLE (code VARCHAR, progress INTEGER, completed BOOLEAN)
LANGUAGE plpgsql AS $$
DECLARE
  q RECORD;
  next_progress INTEGER;
  is_complete BOOLEAN;
BEGIN
  SELECT id, target_count INTO q FROM quests WHERE code = p_code AND is_active IS NOT FALSE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO user_quests (user_id, quest_id, progress, completed)
  VALUES (p_user_id, q.id, LEAST(p_amount, q.target_count), LEAST(p_amount, q.target_count) >= q.target_count)
  ON CONFLICT (user_id, quest_id) DO UPDATE
    SET progress = LEAST(user_quests.progress + p_amount, q.target_count),
        completed = (user_quests.completed OR LEAST(user_quests.progress + p_amount, q.target_count) >= q.target_count),
        completed_at = CASE
          WHEN LEAST(user_quests.progress + p_amount, q.target_count) >= q.target_count
            THEN COALESCE(user_quests.completed_at, NOW())
          ELSE user_quests.completed_at
        END
  RETURNING progress, completed INTO next_progress, is_complete;

  RETURN QUERY SELECT p_code, next_progress, is_complete;
END;
$$;

-- ---------- 7. BOOKMARKS — upiti za profil ----------
-- Vraća sačuvane teme jednog korisnika (za `/users/:username` vlasnika).
CREATE OR REPLACE FUNCTION user_forum_bookmarks(p_user_id UUID)
RETURNS TABLE (thread_id UUID, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
  SELECT thread_id, created_at
  FROM forum_bookmarks
  WHERE user_id = p_user_id
  ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION user_article_bookmarks(p_user_id UUID)
RETURNS TABLE (article_id UUID, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE AS $$
  SELECT article_id, created_at
  FROM article_bookmarks
  WHERE user_id = p_user_id
  ORDER BY created_at DESC;
$$;

-- ---------- 8. RLS ZA SVE NOVE/NEDOSTAJUĆE TABELE ----------
ALTER TABLE thread_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_quests ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- ---------- 9. ADMIN EMAIL + ROTACIJA HINT ----------
-- Demo nalog se više ne seed-uje u produkciji (vidi seed.ts).
-- Novi admin se pravi ručno; ova provera pomaže da se ne zaboravi.
CREATE OR REPLACE FUNCTION admin_accounts() RETURNS TABLE (username VARCHAR, email VARCHAR, is_verified BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT username, email, is_verified FROM users WHERE role = 'admin' ORDER BY created_at;
$$;

-- Migracija 2.4.4 završena.

-- ======================================================================
