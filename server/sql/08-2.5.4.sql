-- SEKCIJA: server/schema-2.5.4.sql
-- ======================================================================

-- ============================================================
-- NEXUS 2.5.4 — BEZBEDNOST I ONBOARDING
--   F-32  Refresh sesije u HttpOnly cookie-ju (rotacija + detekcija zloupotrebe)
--   F-33  TOTP dvofaktorska autentifikacija + recovery kodovi
--   F-34  OAuth prijava/povezivanje (Discord, Google, Steam)
-- Pokreni nakon schema-2.5.3.sql. Idempotentna je i bezbedna za višestruko pokretanje.
-- ============================================================

-- ---------- F-32: REFRESH SESIJE ----------
-- Refresh token se NIKADA ne čuva u čistom obliku — samo SHA-256 hash.
-- `family_id` povezuje lanac rotacija: ako se već iskorišćen token ponovo pošalje,
-- cela porodica se briše (ukradeni refresh token ne može da nastavi sesiju).
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family ON auth_sessions (family_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);

-- ---------- F-33: TOTP / RECOVERY KODOVI ----------
-- TOTP tajna je uvek enkriptovana (AES-256-GCM, ključ izvodi server iz TOTP_ENCRYPTION_KEY/JWT_SECRET).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
-- Recovery kodovi se čuvaju kao bcrypt hash-evi; `totp_recovery_codes` je JSONB niz.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Bruteforce zaštita: broj neuspelih TOTP pokušaja i vreme zaključavanja.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_locked_until TIMESTAMPTZ;

-- Jedan TOTP kod ne može da se iskoristi dvaput: `last_used_step` sprečava replay.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

-- ---------- F-34: OAUTH IDENTITETI ----------
-- Jedan provajderski identitet = jedan NEXUS nalog (UNIQUE provider+provider_user_id).
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts (user_id);

-- ======================================================================
