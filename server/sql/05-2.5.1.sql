-- SEKCIJA: server/schema-2.5.1.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.1 — ISTORIJA POVEZANIH NALOGA I KATALOG BEDŽEVA
-- Pokreni nakon schema.sql, schema-2.4.1.sql, schema-2.4.3.sql i schema-2.4.4.sql.
-- Idempotentna je; bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- 1. VRAĆANJE XP-a ZA ISTI NALOG ----------
-- Problem: `DELETE /api/users/accounts/:platform` je brisao red, pa je
-- ponovno povezivanje istog naloga ponovo davalo +25 XP (i kvest napredak).
-- Rešenje: soft revoke. Red ostaje kao istorija; `revoked_at` označava da
-- nalog više nije aktivan, a istorija sprečava farmovanje XP-a.
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Postojeći redovi (koji ranije nisu imali kolonu) su aktivni.
UPDATE connected_accounts SET revoked_at = NULL WHERE revoked_at IS NULL;

-- Adapter čita samo aktivne naloge (revoked_at IS NULL) i istoriju proverava
-- preko (user_id, platform, platform_username). Jedan red po (user, platform)
-- je već role-playing pravilo tabele; ovde samo osiguravamo indeks.
CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_platform
  ON connected_accounts (user_id, platform);

-- `users.connected_accounts` (JSONB keš) nije izvor istine; ovaj komentar
-- ostaje kao podsetnik da adapter filtrira `revoked_at` pri čitanju.
COMMENT ON COLUMN connected_accounts.revoked_at IS
  'NULL = aktivan nalog; timestamp = otkačen (istorija sprečava ponovni XP)';

-- ---------- 2. KATALOG BEDŽEVA (JEDAN IZVOR ISTINE) ----------
-- Ranije su se opis i uslov razlikovali: `veteran` je u SQL-u bio "30 dana
-- aktivnosti", a u kodu "5.000 XP"; `influencer` "1000 karme" vs "4 naloga".
-- Sada SQL, server (`BADGE_CATALOG` u gamification.ts) i frontend
-- (`src/lib/badges.ts`) imaju identičan opis.

-- `schema.sql` definiše tier CHECK ('bronze','silver','gold','platinum','diamond').
-- Naša skala ima i `legendary` (founder/legend), pa se constraint proširuje
-- PRE inserta — bez ovoga insert pada sa 23514 (`badges_tier_check`).
ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_tier_check;
-- NOT VALID: proširenje se primenjuje na sve nove/izmenjene redove, a ne
-- pada ako u bazi već postoji legacy vrednost van liste (ne blokira deploy).
ALTER TABLE badges DROP CONSTRAINT IF EXISTS badges_tier_check;
ALTER TABLE badges
  ADD CONSTRAINT badges_tier_check
  CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary')) NOT VALID;

INSERT INTO badges (code, name, description, tier, xp_reward) VALUES
  ('first_post',  'Prva objava',  'Objavite prvu temu ili odgovor',        'bronze',   10),
  ('helpful',     'Pomocnik',     'Napiste 25 odgovora',                   'silver',   50),
  ('contributor', 'Kontributor',  'Otvorite 10 tema',                      'silver',  100),
  ('expert',      'Ekspert',      'Dostignite 500 karme',                  'gold',    200),
  ('influencer',  'Influenser',   'Povežite 4 gaming naloga',              'platinum', 300),
  ('veteran',     'Veteran',      'Dostignite 5.000 XP',                   'gold',    500),
  ('founder',     'Osnivac',      'Među prvim članovima zajednice',        'legendary', 0),
  ('legend',      'Legenda',      'Posebno dodeljeno dostignuće',          'legendary', 0)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      tier = EXCLUDED.tier,
      xp_reward = EXCLUDED.xp_reward,
      is_active = true;

-- Legacy `first_reply` iz schema.sql: prvu objavu pokriva `first_post`, a
-- odgovori se broje za `helpful`. Ne brišemo red (stari `user_badges` ga
-- referenciraju), samo ga sklanjamo iz aktivnog kataloga
-- (`is_active = false` + opis).
UPDATE badges
SET description = 'Objavite prvi odgovor (legacy) — koristi se bedž first_post',
    is_active = false
WHERE code = 'first_reply';

-- ---------- 3. BRZI POGLED NA RANG-LISTU ----------
-- „Po nivou“ i „po karmi“ sortiranje ide preko ovih indeksa.
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_karma
  ON users (karma DESC, level DESC) WHERE is_banned IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_users_leaderboard_level
  ON users (level DESC, xp DESC) WHERE is_banned IS NOT TRUE;

-- Migracija 2.5.1 završena.

-- ======================================================================
