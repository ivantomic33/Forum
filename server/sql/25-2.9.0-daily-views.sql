-- =====================================================================
-- 25-2.9.0-daily-views.sql — F-7b: DNEVNA STATISTIKA PREGLEDA
-- =====================================================================
-- Postojeći `views` brojači (articles/forum_threads) su denormalizovani
-- i nemaju vremensku komponentu — trendovi pregleda po danu se iz njih
-- ne mogu rekonstruisati. Ova migracija uvodi lagahnu dnevnu agregatnu
-- tabelu koja se puni iz ISTIH RPC-ova koji već beleže pregled
-- (jedan dodatni upsert u istoj transakciji RPC-a — zanemarljiv trošak).
--
-- Ne čuva IP/user_id — samo zbir po (dan, tip, entitet) — bez GDPR rizika.
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_views (
  view_date   DATE   NOT NULL,
  entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('article', 'thread')),
  entity_id   UUID   NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (view_date, entity_type, entity_id)
);

-- Agregacije po danu (viewsOverTime) — indeks na datum.
CREATE INDEX IF NOT EXISTS idx_daily_views_date
  ON daily_views(view_date);

-- Top članci za period — (entity_type, entity_id) lookup + views sort.
CREATE INDEX IF NOT EXISTS idx_daily_views_entity
  ON daily_views(entity_type, view_date, views DESC);

-- ---------- RPC patch: upsert u dnevni zbir uz postojeći inkrement ----------
-- LANGUAGE plpgsql (bilo sql) — dva statementa u jednoj transakciji.

CREATE OR REPLACE FUNCTION increment_thread_views(p_thread_id UUID) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE forum_threads SET views = COALESCE(views, 0) + 1 WHERE id = p_thread_id;
  INSERT INTO daily_views (view_date, entity_type, entity_id, views)
  VALUES (CURRENT_DATE, 'thread', p_thread_id, 1)
  ON CONFLICT (view_date, entity_type, entity_id)
  DO UPDATE SET views = daily_views.views + 1;
END;
$$;

CREATE OR REPLACE FUNCTION increment_article_views(p_article_id UUID) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE articles SET views = COALESCE(views, 0) + 1 WHERE id = p_article_id;
  INSERT INTO daily_views (view_date, entity_type, entity_id, views)
  VALUES (CURRENT_DATE, 'article', p_article_id, 1)
  ON CONFLICT (view_date, entity_type, entity_id)
  DO UPDATE SET views = daily_views.views + 1;
END;
$$;

REVOKE ALL ON FUNCTION increment_thread_views(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_article_views(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_thread_views(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_article_views(UUID) TO service_role;

-- ---------- Čišćenje: dnevni zbirovi stariji od 2 godine se skidaju ----------
-- (poziva se iz digest/cron joba ako postoji; slobodno ručno)
CREATE OR REPLACE FUNCTION prune_daily_views(p_keep_days INTEGER DEFAULT 730) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM daily_views WHERE view_date < CURRENT_DATE - p_keep_days;
$$;
