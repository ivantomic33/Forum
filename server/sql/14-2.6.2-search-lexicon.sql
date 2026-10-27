-- SEKCIJA: server/schema-2.6.2-search-lexicon.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: leksikalni sloj (funkcije) — MORA IĆI PRVI
-- ----------------------------------------------------------------------------
-- Ovaj fajl SAMOSTALNO pravi sve što mu treba (i `fold_srpski`/`stem_srpski`)
-- i ne zavisi od redosleda ostalih migracija. Pušta se PRE `schema-2.6.2-search.sql`
-- jer `search_articles/-threads/-deals` pozivaju `search_doc()` u svom telu, a
-- Postgres za SQL funkcije proverava da li pozvana funkcija postoji **u trenutku
-- `CREATE FUNCTION`**:
--
--   ERROR: 42883: function fold_srpski(text) does not exist
--   CONTEXT: SQL function "search_doc" during inlining
--
--  1) `fold_srpski()`  — mala slova, latinica, bez dijakritike, ćirilica → latinica.
--  2) `stem_srpski()`  — deterministic koren (ista lista nastavaka kao JS).
--  3) `search_doc()`   — normalizovan tsvector za GIN indeks.
--
-- Redosled u `schema-ALL.sql`: storage → **lexicon** → search → lang.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Potpuno NEOVISNO o redosledu ostalih migracija: ništa ne uvozi i ništa ne
-- ostavlja na okolinu. Svaka funkcija je samostalna (`search_doc` ponovo
-- pravi `fold_srpski`/`stem_srpski` pre sebe), pa `CREATE FUNCTION` nikad ne
-- može da padne sa „42883: function fold_srpski(text) does not exist“.
-- Ovaj fajl pravi: fold_srpski, stem_srpski, search_doc, search_terms,
-- search_terms_refresh, search_suggest i GIN indekse.

-- `unaccent` je opcion i NIKAD se ne koristi — `translate()` je determinističan,
-- ne zavisi od ekstenzije ni od verzije Postgresa (JS `foldSrpski()` daje isto).

-- ---------------------------------------------------------------------------
-- 1) Normalizacija (samo `translate` + regexp: deterministički, bez unaccent)
-- ---------------------------------------------------------------------------
-- DVA `translate()`-a (ćirilica→latinica, pa dijakritika) da NIJEDAN par ne
-- prelazi mapiranje 1:1. Jedan par od 30 ćiriličnih slova menja „љ“/„њ“/„ђ“
-- na JEDAN znak — ručno je bilo 31 naspram 30, što daje tihi NULL.
CREATE OR REPLACE FUNCTION fold_srpski(txt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        translate(
          translate(lower(coalesce(txt, '')),
            'абвгдђежзијклљмнњопрстћуфхцчџш',
            'abvgdjezzijkljmnjoprstcufhccdzs'),
          'čćšžđ',
          'ccszd'
        ),
        '[^a-z0-9]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Koren reči (identična lista nastavaka kao `stemSrpski()` u JS-u)
-- ---------------------------------------------------------------------------
-- `IMMUTABLE` je namerno: `search_doc()` iz nje pravi izraz GIN indeksa.
-- `lower()` se ovde NE koristi (zavisi od collation-a) — mala slova već
-- garantuje `fold_srpski()`, koji je pozvan pre ovog.
CREATE OR REPLACE FUNCTION stem_srpski(word TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  w TEXT := coalesce(word, '');
  suffixes TEXT[] := ARRAY[
    'ovima','evima','anje','enje','ijma','ama','ima','ovi','evi','ija','ije',
    'ati','iti','eti','uti','ila','ile','ilo','ili','ala','ale','alo','ali',
    'om','em','im','ih','og','eg','oj','ej','ao','eo','io','uo',
    -- Jednoslovni padeži se skidaju samo na rečima od 6+ znakova
    -- (`MIN_STEM_BASE` u JS-u): „popusta“ → „popust“, „sata“ ostaje celo.
    'a','e','i','o','u'
  ];
  suffix TEXT;
BEGIN
  -- Isti prag kao `STEM_MIN_LENGTH` u `server/lib/search.ts` (5 znakova).
  IF length(w) < 5 THEN RETURN w; END IF;
  FOREACH suffix IN ARRAY suffixes LOOP
    IF length(suffix) = 1 AND length(w) < 6 THEN CONTINUE; END IF;
    IF length(w) - length(suffix) >= 3 AND right(w, length(suffix)) = suffix THEN
      RETURN left(w, length(w) - length(suffix));
    END IF;
  END LOOP;
  RETURN w;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Dokument za indeks: normalizovan + stemovan tsvector
-- ---------------------------------------------------------------------------
-- `array_to_tsvector(text[])` (JEDAN argument!) — ne postoji verzija sa
-- `regconfig`; konfiguracija nije potrebna jer tokene već dajemo normalizovane
-- i bez stop-reči. Postgres bi inače bacio:
--   ERROR: 42883: function array_to_tsvector(unknown, text[]) does not exist
--
-- Prazni tokeni se skidaju u `words`, a agregat ima `coalesce` za dokument
-- koji nema nijednu reč.
CREATE OR REPLACE FUNCTION search_doc(txt TEXT)
RETURNS TSVECTOR
LANGUAGE sql
IMMUTABLE
AS $$
  WITH folded AS (
    SELECT public.fold_srpski(txt) AS norm
  ),
  words AS (
    SELECT DISTINCT public.stem_srpski(w.word) AS word
    FROM folded
    CROSS JOIN LATERAL regexp_split_to_table(folded.norm, '\s+') AS w(word)
    WHERE length(w.word) > 0
  )
  SELECT coalesce(array_to_tsvector(array_agg(words.word)), ''::tsvector)
  FROM words;
$$;
COMMENT ON FUNCTION search_doc(TEXT) IS 'Normalizovan tsvector (fold + deterministic koren) za pretragu 2.6.2';

-- ---------------------------------------------------------------------------
-- 4) Rečnik za „da li ste mislili“ + punjenje + sugestija
-- ---------------------------------------------------------------------------
-- Namerno u ISTOM fajlu kao funkcije: puštanje `lang`/`search` bez `lexicon`
-- je bilo glavni izvor 42883 grešaka. Tako je jedan fajl = cela pretraga.
CREATE TABLE IF NOT EXISTS search_terms (
  term TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('article', 'thread', 'deal', 'game')),
  weight INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION search_terms_refresh()
RETURNS INT
LANGUAGE plpgsql
-- VOLATILE je podrazumevano i NAMERNO: funkcija piše (`TRUNCATE`/`INSERT`) i
-- poziva se u SQL Editor-u kao `SELECT search_terms_refresh();`. Zato Supabase
-- prikazuje rezultat `search_terms_refresh = <broj>` (broj upisanih reči) — to
-- je očekivani izlaz poslednjeg `SELECT`-a u ovoj skripti, ne greška.
AS $$
DECLARE
  inserted INT;
BEGIN
  TRUNCATE search_terms;

  -- Zajednički izvor: svi naslovi (članci + teme + aktivni dealovi) u JEDNOM
  -- `INSERT`-u. Tako nema tri `ROW_COUNT`-a i funkcija vraća pravi broj reči.
  INSERT INTO search_terms(term, kind, weight)
  SELECT DISTINCT ON (word) word, kind, 1
  FROM (
    SELECT word, 'article' AS kind
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM articles WHERE status = 'published'
    ) s
    UNION ALL
    SELECT word, 'thread'
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM forum_threads WHERE coalesce(is_deleted, FALSE) = FALSE
    ) s
    UNION ALL
    SELECT word, 'deal'
    FROM (
      SELECT regexp_split_to_table(public.fold_srpski(coalesce(title, '')), '\s+') AS word
      FROM deals WHERE status = 'active'
    ) s
  ) all_words
  WHERE length(word) >= 3
  ON CONFLICT (term) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_search_terms_trgm ON search_terms USING gin (term gin_trgm_ops);

CREATE OR REPLACE FUNCTION search_suggest(query TEXT, max_results INT DEFAULT 3)
RETURNS TABLE (suggestion TEXT, similarity REAL)
LANGUAGE sql
STABLE
AS $$
  WITH q AS (SELECT public.fold_srpski(query) AS term)
  SELECT t.term AS suggestion, similarity(t.term, q.term)::REAL AS similarity
  FROM search_terms t, q
  WHERE q.term <> ''
    AND length(t.term) >= 3
    AND t.term % q.term
    AND similarity(t.term, q.term) >= 0.35
  ORDER BY similarity DESC, t.weight DESC
  LIMIT LEAST(GREATEST(max_results, 1), 10);
$$;

-- GIN indeksi na izrazu `search_doc(...)` — isti fajl, pa funkcija SIGURNO postoji.
CREATE INDEX IF NOT EXISTS idx_articles_search_doc
  ON articles USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_threads_search_doc
  ON forum_threads USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_deals_search_doc
  ON deals USING gin (public.search_doc(coalesce(title, '') || ' ' || coalesce(description, '')));
CREATE INDEX IF NOT EXISTS idx_games_search_doc
  ON games USING gin (public.search_doc(coalesce(title, '')));

-- Početno punjenje (idempotentno — TRUNCATE + INSERT).
SELECT search_terms_refresh();

-- ======================================================================
