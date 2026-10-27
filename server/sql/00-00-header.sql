-- NEXUS — KOMPLETNA ŠEMA BAZE (JEDINI SQL FAJL)
--
-- Ovo je jedini fajl koji se pušta: Supabase → SQL Editor → Run.
-- Idempotentan je — bezbedno ga je pokrenuti ponovo (IF NOT EXISTS /
-- CREATE OR REPLACE / DROP … IF EXISTS pre svakog CONSTRAINT/TRIGGER-a).
--
-- Redosled sekcija je bitan (FK zavisnosti):
--   core → 2.4.1 → 2.4.3 → 2.4.4 → 2.5.1 → 2.5.2 → 2.5.3 → 2.5.4
--   → polls → 2.6.0-deals → 2.6.1-presence → 2.6.2-presence-away
--   → 2.6.2-storage → 2.6.2-search-lexicon → 2.6.2-search
--   → 2.6.2-search-lang (no-op) → 2.6.4-sharing → 2.6.5-rpc-fixes
--
-- VAŽNO za pretragu: leksikalni sloj (fold_srpski/stem_srpski/search_doc)
-- mora biti PRE `search_articles/-threads/-deals`, jer Postgres za SQL
-- funkcije proverava da li pozvana funkcija postoji u trenutku CREATE FUNCTION.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
