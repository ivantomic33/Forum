-- ============================================================
-- 5.3.0 — LOGIN STREAK (dnevna prijava = aktivnost)
-- ============================================================
-- `user_daily_activity` je izvor istine za streak. Do sada se aktivnost
-- beležila samo na post/odgovor, pa je član koji se svakodnevno prijavljuje
-- gubio niz. Nova kolona `login_credited` čuva da je bonus za taj dan već
-- dodeljen (idempotentno za refresh/više tabova).
--
-- Primena: Supabase SQL editor (idempotentno). Bez kolone streak od prijave
-- pada na memorijski fallback — ostatak sajta radi nepromenjeno.

ALTER TABLE user_daily_activity
  ADD COLUMN IF NOT EXISTS login_credited BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_daily_activity.login_credited IS
  '5.3.0 — dnevni login bonus je dodeljen (streak se produžava prijavom)';

NOTIFY pgrst, 'reload schema';
