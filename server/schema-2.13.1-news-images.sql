-- ============================================================================
-- 2.13.1 — DE-DUPLIKACIJA SLIKA VESTI
-- ============================================================================
-- Deo `schema-ALL.sql`; ovaj fajl je za baze koje su već puštene ranije.
-- Idempotentno je — bezbedno ga je pokrenuti više puta.
-- ============================================================================
-- Problem koji rešava: kada dve vesti imaju ISTU originalnu sliku (isti događaj
-- iz više izvora, ili izvor ponovi `og:image`), server je svaku preslikavao u
-- Storage — isti bajtovi, dva fajla, dva URL-a.
--
-- `original_url` je ključ (bez `?query` i bez završne kose crte, tj. normalizovan
-- u kodu): drugi uvoz iste slike samo vrati postojeći `mirrored_url`.
--
-- Server radi i BEZ ove tabele (padne na proveru u `articles.cover_image`),
-- ali tada ponovni uvoz posle mesec dana ne vidi originalni URL jer je u bazi
-- već naš WebP — zato je tabela izvor istine.
-- ============================================================================
CREATE TABLE IF NOT EXISTS news_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Normalizovan URL slike sa izvora (bez query stringa) — ključ deduplikacije.
  original_url TEXT NOT NULL UNIQUE,
  -- Naš javni URL (Supabase Storage) ili original ako mirror nije uspeo.
  mirrored_url TEXT NOT NULL,
  -- Koliko je vesti koristilo ovu sliku (statistika/čišćenje).
  uses INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_images_original ON news_images (original_url);

-- RLS deny-by-default; server ide kroz service_role.
ALTER TABLE news_images ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- Provera posle puštanja:
-- SELECT original_url, uses FROM news_images ORDER BY uses DESC LIMIT 5;
