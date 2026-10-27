-- SEKCIJA: server/schema-2.6.4-sharing.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.4 — DELJENO STANJE IZMEĐU INSTANCI (N-09, B-15)
--
-- Do sada je troje stanja živelo u `Map`-u procesa. Sa 2+ API instance to je
-- davalo pogrešne odgovore, ne samo sporije:
--   * XP dnevni budžet  — limit od 300 XP se resetovao po instanci,
--   * pending 2FA setup — tajna iz `/2fa/setup` nije postojala na drugoj instanci,
--   * action tokeni     — fallback je ostajao u memoriji kada baza pukne,
--   * prisustvo (B-15)  — `users.status` je memorijski keš i nije znak prisustva.
--
-- Atomično podeljen novac: brojač se NE čita pa upisuje iz aplikacije, već
-- jedan `INSERT ... ON CONFLICT DO UPDATE` koji u istoj naredbi proverava limit
-- (paralelni zahtevi se serijalizuju na redu; nema dvostrukog trošenja).
-- Redosled: posle schema-2.6.2-search-lang.sql. Idempotentna je.
-- ============================================================================

-- ---------- 1. DNEVNI XP BUDŽET ----------
-- `day` je UTC datum (isti kao `new Date().toISOString().slice(0, 10)` u kodu).
-- TTL: stari redovi se brišu u `spend_daily_xp` (7 dana) — nema cron posla.
CREATE TABLE IF NOT EXISTS xp_budget (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_xp_budget_day ON xp_budget(day);

--
 --
CREATE OR REPLACE FUNCTION spend_daily_xp(p_user_id UUID, p_amount INTEGER, p_cap INTEGER DEFAULT 300)
RETURNS TABLE (granted INTEGER, used INTEGER, capped BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount INTEGER := GREATEST(COALESCE(p_amount, 0), 0);
  v_cap INTEGER := GREATEST(COALESCE(p_cap, 300), 0);
  v_used INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RETURN QUERY SELECT 0, 0, v_amount > 0;
    RETURN;
  END IF;

  -- Proređeno čišćenje (1/50 poziva) — jeftino, bez cron posla.
  IF random() < 0.02 THEN
    DELETE FROM xp_budget WHERE day < (CURRENT_DATE - INTERVAL '7 days');
  END IF;

  INSERT INTO xp_budget AS b (user_id, day, xp, updated_at)
  VALUES (p_user_id, CURRENT_DATE, LEAST(v_amount, v_cap), NOW())
  ON CONFLICT (user_id, day) DO UPDATE
    SET xp = b.xp + LEAST(v_amount, GREATEST(v_cap - b.xp, 0)),
        updated_at = NOW()
  RETURNING b.xp INTO v_used;

  RETURN QUERY SELECT (v_used - GREATEST(v_used - v_amount, 0))::INTEGER, v_used, v_used < v_amount;
END;
$$;

--* Admin/test reset — bez `p_user_id` briše se ceo dan svih korisnika. 
CREATE OR REPLACE FUNCTION reset_daily_xp(p_user_id UUID DEFAULT NULL, p_day DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    DELETE FROM xp_budget WHERE day = p_day;
  ELSE
    DELETE FROM xp_budget WHERE user_id = p_user_id AND day = p_day;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

ALTER TABLE xp_budget ENABLE ROW LEVEL SECURITY;

-- ---------- 2. PENDING 2FA SETUP ----------
-- Tajna tokom uključivanja (setup → enable). Samo hash (SHA-256) tajne, TTL 10 min.
-- Potvrđena 2FA ostaje u `users.totp_secret` / `users.totp_enabled_at`.
CREATE TABLE IF NOT EXISTS totp_pending (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_totp_pending_created ON totp_pending(created_at);

--* Nepotrošena provera: `secret_enc` (AES-GCM iz `lib/crypto`) ili NULL. 
CREATE OR REPLACE FUNCTION peek_totp_enrollment(p_user_id UUID, p_ttl_seconds INTEGER DEFAULT 600)
RETURNS TABLE (secret_enc TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    SELECT t.secret_enc
    FROM totp_pending t
    WHERE t.user_id = p_user_id
      AND t.created_at > NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0));

  -- Istekli red je smeće, ne stanje. Briše se nad istim redom.
  DELETE FROM totp_pending
  WHERE user_id = p_user_id
    AND created_at <= NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0));
END;
$$;

--* Potvrđuje enrollment NE samo da ga pročita — drugi `enable` ne sme da prođe. 
CREATE OR REPLACE FUNCTION consume_totp_enrollment(p_user_id UUID, p_ttl_seconds INTEGER DEFAULT 600)
RETURNS TABLE (secret_enc TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM totp_pending
  WHERE user_id = p_user_id
    AND created_at > NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 0))
  RETURNING totp_pending.secret_enc INTO secret_enc;

  RETURN NEXT;
END;
$$;

ALTER TABLE totp_pending ENABLE ROW LEVEL SECURITY;

-- ---------- 3. AUDIT ACTION BEZ NOVIH KOLONA ----------
-- `audit_log` (2.4.3) već ima `details JSONB` gde staje ceo zapis
-- (`actorUsername`, `targetUsername`, `from`, `to`). Indeks samo za listu.
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created
  ON audit_log(action, created_at DESC);

-- ---------- 4. ASTEŽ IZ `auth_tokens` (N-09 — action tokeni) ----------
-- `consume_auth_token` je već atomski. Ovo je samo osvežavanje schema keša
-- posle ručnog unosa tokena u SQL Editor-u.
NOTIFY pgrst, 'reload schema';

-- ======================================================================
