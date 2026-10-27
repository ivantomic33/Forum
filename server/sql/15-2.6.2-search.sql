-- SEKCIJA: server/schema-2.6.2-search.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: trigrami (greške u kucanju) + leksikalni sloj
-- ----------------------------------------------------------------------------
-- Dva sloja se sabiraju u `rank`:
--
--  1. `pg_trgm` + `ILIKE` — delimične reči i greške u kucanju. Ovaj deo radi
--     čim je ova migracija primenjena.
--  2. `tsquery` nad normalizovanim vektorom iz `schema-2.6.2-search-lang.sql`
--     (skida dijakritiku, ćirilicu i padežne nastavke → „igre“, „igrama“ i
--     „igra“ pogode isti koren). Ako ta migracija nije primenjena, klijent
--     pošalje `ts_query = ''` i ovaj deo se preskače bez greške.
--
-- Privatnost / vidljivost:
--  - članci: samo `status = 'published'`,
--  - teme: samo postojeće (soft-deleted se ne vraćaju),
--  - deal-ovi: samo `status = 'active'` i bez isteklog roka.
--
-- Bez ove migracije server radi sa ILIKE fallbackom (isti ugovor, bez ranga
-- po trigramima).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- RANA provera: `search_articles/-threads/-deals` pozivaju `public.search_doc()` u
-- svom telu, a Postgres za SQL funkcije traži da pozvana funkcija **već
-- postoji** u trenutku `CREATE FUNCTION`.
DO $$
BEGIN
  IF to_regprocedure('public.fold_srpski(text)') IS NULL
     OR to_regprocedure('public.stem_srpski(text)') IS NULL
     OR to_regprocedure('public.search_doc(text)') IS NULL THEN
    RAISE EXCEPTION
      'Prvo pusti server/schema-2.6.2-search-lexicon.sql (fold_srpski/stem_srpski/search_doc), pa ovaj fajl.';
  END IF;
END $$;

-- Trigram indeksi (idempotentno). `IF NOT EXISTS` je i `CREATE INDEX` u
-- generisanom `schema-ALL.sql` (skripta ga dodaje sama).
CREATE INDEX IF NOT EXISTS idx_articles_title_trgm
  ON articles USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_articles_excerpt_trgm
  ON articles USING gin (excerpt gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_title_trgm
  ON forum_threads USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_threads_content_trgm
  ON forum_threads USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_deals_title_trgm
  ON deals USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_games_title_trgm
  ON games USING gin (title gin_trgm_ops);

--
 --
CREATE OR REPLACE FUNCTION search_snippet(body TEXT, query TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT coalesce(regexp_replace(coalesce(body, ''), '<[^>]+>', ' ', 'g'), '') AS plain
  ),
  q AS (
    -- `plainto_tsquery` nikad ne baca na proizvoljan tekst (samo ignoriše
    -- reči bez leksema). `numnode` je 0 za prazan upit.
    SELECT plainto_tsquery('simple', coalesce(query, '')) AS tsq, plain
    FROM src
  )
  SELECT CASE
    WHEN length(q.plain) = 0 THEN ''
    WHEN numnode(q.tsq) = 0 THEN left(q.plain, 200)
    ELSE ts_headline(
      'simple',
      q.plain,
      q.tsq,
      'StartSel=, StopSel=, MaxWords=45, MinWords=20, MaxFragments=1'
    )
  END
  FROM q;
$$;

--
 --
CREATE OR REPLACE FUNCTION search_articles(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  slug TEXT,
  title TEXT,
  snippet TEXT,
  category TEXT,
  cover_image TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  ),
  lex AS (
    SELECT q.ts AS ts
    FROM q
    WHERE q.ts <> ''
      AND to_regclass('public.search_terms') IS NOT NULL
      AND to_regprocedure('public.search_doc(text)') IS NOT NULL
  )
  SELECT
    a.id, a.slug, a.title,
    coalesce(search_snippet(a.excerpt, q.term), '') AS snippet,
    a.category,
    coalesce(a.cover_image, '') AS cover_image,
    a.created_at,
    (
      similarity(a.title, q.term) * 3
      + similarity(coalesce(a.excerpt, ''), q.term) * 2
      + CASE WHEN a.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE WHEN coalesce(a.content, '') ILIKE '%' || q.term || '%' THEN 0.5 ELSE 0 END
      -- Leksikalni sloj: normalizovan vektor + koren reči (npr. „igre“ → „igr“).
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM articles a
  CROSS JOIN q
  WHERE a.status = 'published'
    AND (
      a.title ILIKE '%' || q.term || '%'
      OR coalesce(a.excerpt, '') ILIKE '%' || q.term || '%'
      OR coalesce(a.content, '') ILIKE '%' || q.term || '%'
      OR coalesce(a.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(a.title, '') || ' ' || coalesce(a.excerpt, '') || ' ' || coalesce(a.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, a.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

--
 --
CREATE OR REPLACE FUNCTION search_threads(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  snippet TEXT,
  subforum TEXT,
  author TEXT,
  replies INT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  )
  SELECT
    t.id, t.title,
    coalesce(search_snippet(t.content, q.term), '') AS snippet,
    coalesce(c.slug, '') AS subforum,
    coalesce(u.username, '') AS author,
    coalesce(t.reply_count, 0) AS replies,
    t.created_at,
    (
      similarity(t.title, q.term) * 3
      + similarity(coalesce(t.content, ''), q.term)
      + CASE WHEN t.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(t.title, '') || ' ' || coalesce(t.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM forum_threads t
  CROSS JOIN q
  LEFT JOIN users u ON u.id = t.author_id
  LEFT JOIN forum_categories c ON c.id = t.category_id
  WHERE coalesce(t.is_deleted, FALSE) = FALSE
    AND (
      t.title ILIKE '%' || q.term || '%'
      OR coalesce(t.content, '') ILIKE '%' || q.term || '%'
      OR coalesce(t.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(t.title, '') || ' ' || coalesce(t.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, t.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

--
 --
CREATE OR REPLACE FUNCTION search_deals(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  store TEXT,
  price NUMERIC,
  currency TEXT,
  game_slug TEXT,
  created_at TIMESTAMPTZ,
  rank REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      coalesce(nullif(trim(query), ''), '') AS term,
      coalesce(nullif(trim(ts_query), ''), '') AS ts
  )
  SELECT
    d.id, d.title, d.store, d.price, d.currency,
    g.slug AS game_slug,
    d.created_at,
    (
      similarity(d.title, q.term) * 3
      + CASE WHEN d.title ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE WHEN coalesce(d.description, '') ILIKE '%' || q.term || '%' THEN 0.5 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(g.title, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM deals d
  CROSS JOIN q
  LEFT JOIN games g ON g.id = d.game_id
  WHERE d.status = 'active'
    AND (d.expires_at IS NULL OR d.expires_at > NOW())
    AND (
      d.title ILIKE '%' || q.term || '%'
      OR coalesce(d.description, '') ILIKE '%' || q.term || '%'
      OR coalesce(d.title, '') % q.term
      OR (q.ts <> '' AND public.search_doc(coalesce(d.title, '') || ' ' || coalesce(d.description, '') || ' ' || coalesce(g.title, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

-- RLS/dozvole: pretraga je javna, ali kroz service_role (backend) — anon klijent
-- ne treba da poziva RPC direktno.
REVOKE ALL ON FUNCTION search_articles(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_threads(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_deals(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_articles(TEXT, TEXT, REGCONFIG, INT) TO service_role;
GRANT EXECUTE ON FUNCTION search_threads(TEXT, TEXT, REGCONFIG, INT) TO service_role;
GRANT EXECUTE ON FUNCTION search_deals(TEXT, TEXT, REGCONFIG, INT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ======================================================================
