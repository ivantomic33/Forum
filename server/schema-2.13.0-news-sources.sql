-- ============================================================================
-- 2.13.0 — IZVORI VESTI I GRUPISANJE DOGAĐAJA
-- ============================================================================
-- Deo `schema-ALL.sql`; ovaj fajl je za baze koje su već puštene ranije.
-- Idempotentno je — bezbedno ga je pokrenuti više puta.
-- ============================================================================
-- `source_url`   — link na originalnu vest (RSS `link`). Služi za deduplikaciju
--                  koja preživljava restart i radi bez čitanja `content`-a.
--                  Delimični UNIQUE indeks: NULL (ručno pisani članci) je dozvoljen.
-- `news_source`  — ime izvora (Polygon, Kotaku, PC Gamer…) — prikaz „Izvor: X“.
-- `event_id`     — grupa vesti o istom događaju (npr. „Xbox otpuštanja“). Vest
--                  istog događaja deli `event_id`, a stranica događaja prikazuje
--                  vremensku liniju umesto 5 nepovezanih kartica.
-- ============================================================================
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS news_source VARCHAR(80);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS event_id VARCHAR(120);

-- Deduplikacija po linku izvora (isti URL se ne uvozi dvaput).
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_url
  ON articles (source_url)
  WHERE source_url IS NOT NULL;

-- Grupa događaja: stranica događaja traži sve vesti po `event_id` (najnovija prva).
CREATE INDEX IF NOT EXISTS idx_articles_event
  ON articles (event_id, published_at DESC)
  WHERE event_id IS NOT NULL;

-- Statistika po izvoru u adminu (koliko vesti je došlo iz kog feeda).
CREATE INDEX IF NOT EXISTS idx_articles_news_source
  ON articles (news_source, created_at DESC)
  WHERE news_source IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Provera posle puštanja:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name='articles' AND column_name IN ('source_url','news_source','event_id');
