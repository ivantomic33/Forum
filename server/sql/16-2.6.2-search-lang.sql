-- SEKCIJA: server/schema-2.6.2-search-lang.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Pretraga: rečnik i „da li ste mislili“ (PREUSMERENO)
-- ----------------------------------------------------------------------------
-- Ovaj fajl je ranije sadržao leksikalni sloj i rečnik. Sada je SVE u
-- `schema-2.6.2-search-lexicon.sql` (funkcije + rečnik + indeksi), jer se
-- redosled puštanja pokazao kao glavni izvor grešaka:
--
--   ERROR: 42883: function fold_srpski(text) does not exist
--   CONTEXT: SQL function "search_doc" during inlining
--
-- Fajl je namerno ostavljen kao bezopasan no-op (da stari linkovi i `schema-ALL`
-- ne pucaju) i samo proverava da je leksikon primenjen.
--
-- Redosled: lexicon → search → lang (ovaj fajl).
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.search_doc(text)') IS NULL THEN
    RAISE EXCEPTION
      'Pusti server/schema-2.6.2-search-lexicon.sql — u njemu su fold_srpski, stem_srpski, search_doc, search_terms i search_suggest.';
  END IF;
END $$;

-- Rečnik se puni iz istog fajla; ovde je samo osvežavanje za slučaj da je
-- `lexicon` pušten pre nego što je baza imala članke/teme.
SELECT search_terms_refresh();

NOTIFY pgrst, 'reload schema';

-- ======================================================================
