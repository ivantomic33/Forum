-- ============================================================
-- 2.10.0 — SCHEDULED PUBLISHING (zakazani članci)
-- ============================================================
-- Članak može biti `scheduled`: `published_at` tada drži ZAKAZANI
-- trenutak objave. Pozadinski job (`publishScheduledArticlesJob`)
-- svakih 60 s prebacuje dospelu `scheduled` → `published`.
--
-- Primena: Supabase SQL editor, ceo fajl odjednom (idempotentno).

-- 1) CHECK constraint: dodaj 'scheduled' u dozvoljene statuse.
--    Postojeći constraint se mora izbaciti po imenu pa napraviti novi.
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_status_check_old;

DO $$
DECLARE
  legacy_constraint TEXT;
BEGIN
  -- Legacy baze mogu imati constraint pod drugim imenom — pronađi ga po definiciji
  -- i izbaci preko dinamičkog SQL-a (ALTER TABLE DROP CONSTRAINT ne prihvata pod-upit).
  SELECT conname INTO legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'articles'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF legacy_constraint IS NOT NULL AND legacy_constraint <> 'articles_status_check' THEN
    EXECUTE format('ALTER TABLE articles DROP CONSTRAINT %I', legacy_constraint);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

ALTER TABLE articles
  ADD CONSTRAINT articles_status_check
  CHECK (status IN ('draft', 'published', 'scheduled', 'archived'));

-- 2) Delimični kompozitni indeks za periodično pretraživanje dospelih članaka.
CREATE INDEX IF NOT EXISTS idx_articles_scheduled
  ON articles (status, published_at)
  WHERE status = 'scheduled';
