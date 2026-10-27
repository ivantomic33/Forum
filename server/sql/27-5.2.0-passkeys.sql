-- ============================================================
-- 5.2.0 — PASSKEYS (WebAuthn)
-- ============================================================
-- Passkey zamena lozinku parom ključeva: privatni deo ostaje u autentifikatoru
-- (Touch ID / Windows Hello / telefon), a u bazi je samo javni ključ.
-- Posledica: procurila baza ne daje mogućnost prijave, a phishing nema šta
-- da ukrade (potpis je vezan za domen preko `rpId`).
--
-- Primena: Supabase SQL editor, ceo fajl odjednom (idempotentno).
-- Bez ove tabele passkey rute vraćaju 503 (`passkey_storage_missing`) — prijava
-- klasičnom lozinkom/2FA radi nepromenjeno.

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Base64url `credential.id` iz WebAuthn-a (jedinstven kroz sve korisnike).
  credential_id TEXT NOT NULL,
  -- COSE javni ključ (base64url). Nije tajna — ali se nikad ne šalje klijentu.
  public_key TEXT NOT NULL,
  -- Brojač potpisa: mora da raste; ako padne, autentifikator je kloniran.
  counter BIGINT NOT NULL DEFAULT 0,
  -- `platform` (Touch ID/Hello) ili `cross-platform` (USB/NFC/telefon).
  attachment TEXT,
  transports TEXT[],
  name TEXT NOT NULL DEFAULT 'Passkey',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webauthn_credentials_credential
  ON webauthn_credentials (credential_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials (user_id);

ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
-- Deny-by-default (kao i sve ostale tabele): pristup ima samo `service_role`
-- (backend), jer service_role zaobilazi RLS. `anon`/`authenticated` ne vide ni
-- credential_id, pa se enumeracija passkey-a ne može raditi klijentskim ključem.

COMMENT ON TABLE webauthn_credentials IS
  '5.2.0 — passkeys: javni ključ, brojač potpisa i naziv uređaja (nikad privatni ključ)';

NOTIFY pgrst, 'reload schema';
