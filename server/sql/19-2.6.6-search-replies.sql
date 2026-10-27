-- SEKCIJA: server/schema-2.6.6-search-replies.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.6 — PRETRAGA ODGOVORA U TEMAMA (F-13)
-- ----------------------------------------------------------------------------
-- Do sada je `/api/search` vraćao samo TEMU (naslov + prvi post), pa je
-- korisnik koji traži reč iz treće strane teme dobijao temu i morao da je
-- čita celu. Ova sekcija dodaje `search_replies` — isti leksikalni sloj
-- (`fold_srpski`/`stem_srpski`/`search_doc`) i isti ugovor kao `search_threads`,
-- ali red po odgovoru, sa `thread_title` i `thread_id` za duboki link
-- (`/thread/<id>#post-<reply_id>`).
--
-- Rezultat NAMERNO ne ulazi u `type=all` (vidi `server/lib/search.ts`):
-- odgovori su mnogo brojniji od tema i potisnuli bi bolje pogotke.
-- Idempotentno: DROP + CREATE OR REPLACE.
-- ============================================================================

DROP FUNCTION IF EXISTS search_replies(TEXT, TEXT, REGCONFIG, INT);

CREATE OR REPLACE FUNCTION search_replies(
  query TEXT,
  ts_query TEXT DEFAULT '',
  ts_config REGCONFIG DEFAULT 'simple',
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  thread_id UUID,
  thread_title TEXT,
  snippet TEXT,
  subforum TEXT,
  author TEXT,
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
    r.id, r.thread_id, t.title AS thread_title,
    coalesce(search_snippet(r.content, q.term), '') AS snippet,
    coalesce(c.slug, '') AS subforum,
    coalesce(u.username, '') AS author,
    r.created_at,
    (
      similarity(coalesce(r.content, ''), q.term)
      + CASE WHEN coalesce(r.content, '') ILIKE '%' || q.term || '%' THEN 2 ELSE 0 END
      + CASE
          WHEN q.ts <> '' AND public.search_doc(coalesce(r.content, '')) @@ to_tsquery(ts_config, q.ts) THEN 2.5
          ELSE 0
        END
    )::REAL AS rank
  FROM forum_replies r
  JOIN forum_threads t ON t.id = r.thread_id
  CROSS JOIN q
  LEFT JOIN users u ON u.id = r.author_id
  LEFT JOIN forum_categories c ON c.id = t.category_id
  WHERE coalesce(r.is_deleted, FALSE) = FALSE
    AND coalesce(t.is_deleted, FALSE) = FALSE
    AND (
      coalesce(r.content, '') ILIKE '%' || q.term || '%'
      OR (q.ts <> '' AND public.search_doc(coalesce(r.content, '')) @@ to_tsquery(ts_config, q.ts))
    )
  ORDER BY rank DESC, r.created_at DESC
  LIMIT LEAST(GREATEST(max_results, 1), 50);
$$;

-- Ista dozvola kao za ostale pretrage: samo backend (`service_role`).
REVOKE ALL ON FUNCTION search_replies(TEXT, TEXT, REGCONFIG, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_replies(TEXT, TEXT, REGCONFIG, INT) TO service_role;

NOTIFY pgrst, 'reload schema';
