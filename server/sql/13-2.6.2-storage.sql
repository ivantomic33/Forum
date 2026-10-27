-- SEKCIJA: server/schema-2.6.2-storage.sql
-- ======================================================================

-- ============================================================================
-- NEXUS 2.6.2 — Supabase Storage (avatar, cover igre, dokaz deal-a)
-- ----------------------------------------------------------------------------
-- Jedan JAVNI bucket `media` — slike su namerno javne (avatar se prikazuje u
-- listama, cover na Game Page-u, dokaz u deal-u), pa CDN keširanje radi bez
-- potpisa URL-a. Upis i brisanje rade isključivo server preko service_role
-- ključa (`server/lib/storage.ts`); nijedna politika ne dozvoljava anon
-- upis, iako je bucket javan za čitanje.
--
-- Putanje u bucket-u:
--   <user_id>/avatar-<random>.webp   (256×256, WebP, bez EXIF-a)
--   <user_id>/cover-<random>.webp    (600×800, staff)
--   <user_id>/proof-<random>.webp    (do 1600 px, autor deal-a)
-- `user_id` se uzima iz sesije, ne iz zahteva — korisnik ne može da piše u
-- tuđi prefiks ni preko politike.
--
-- Ako se koristi custom domena ili drugi bucket, promeni `SUPABASE_STORAGE_BUCKET`.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  TRUE,
  5242880, -- 5 MB (server dodatno ponovo kodira u WebP)
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Čitanje javnog bucket-a (i anon/authenticated gledaoci).
DROP POLICY IF EXISTS "media public read" ON storage.objects;
CREATE POLICY "media public read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media');

-- Upis je vezan za folder korisnika: `auth.uid()::text = (storage.foldername(name))[1]`.
-- Server (service_role) zaobilazi RLS, pa je ovo zaštita za slučaj da neko
-- kasnije doda klijentski upload sa anon ključem.
DROP POLICY IF EXISTS "media owner insert" ON storage.objects;
CREATE POLICY "media owner insert" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "media owner update" ON storage.objects;
CREATE POLICY "media owner update" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "media owner delete" ON storage.objects;
CREATE POLICY "media owner delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- PostgREST/Storage keširaju šemu; posle migracije novi bucket je vidljiv odmah.
NOTIFY pgrst, 'reload schema';

-- ======================================================================
