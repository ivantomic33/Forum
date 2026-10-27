-- ============================================================
-- 6.0.0 — XP / NIVO: JEDNA KRIVA, NIVO JE IZVEDENA VREDNOST
-- ============================================================
-- Problem koji ovo rešava:
--   * `users.level` je bio keš kolona koju je app pisao ručno. Ako je XP
--     promenjen mimo `awardXp` (admin korekcija, direktan SQL, stari podaci),
--     korisnik je imao npr. 756 XP a i dalje pisalo „LVL 1, 500/500“.
--   * Admin XP bonus je išao kroz `awardXp` → `spend_daily_xp`, pa je dnevni
--     limit tiho odsecao na 0 XP.
--
-- Ovde se uvodi:
--   1. `public.xp_for_level(level)` — isti prag kao `xpForLevel` u
--      `server/lib/store.ts` (round(500 * level^1.35)); jedini izvor istine u bazi.
--   2. Trigger `trg_users_level_from_xp` — posle svakog upisa `xp`/`level`
--      nivo se izvodi iz XP-a. Keš kolona više ne može da se raziđe sa XP-om.
--   3. Backfill — svi postojeći redovi se odmah ispravljaju.
--   4. RPC `bump_user_xp(user_id, amount)` — atomična admin korekcija mimo
--      dnevnog limita (nikad ispod 0).
--
-- Primena: Supabase SQL editor (idempotentno — može i više puta).

CREATE OR REPLACE FUNCTION public.xp_for_level(p_level INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- round(500 * level^1.35), minimum nivo 1. `ROUND(...)::INTEGER` namerno:
  -- JS `Math.round` je half-up, isto kao SQL `round` za pozitivne vrednosti.
  SELECT ROUND(500 * POWER(GREATEST(COALESCE(p_level, 1), 1), 1.35))::INTEGER;
$$;

CREATE OR REPLACE FUNCTION public.level_from_xp(p_xp INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_level INTEGER := 1;
  v_xp    INTEGER := GREATEST(COALESCE(p_xp, 0), 0);
BEGIN
  WHILE v_level < 200 AND public.xp_for_level(v_level + 1) <= v_xp LOOP
    v_level := v_level + 1;
  END LOOP;
  RETURN v_level;
END;
$$;

-- Trigger: nivo se UVIJEK izvodi iz XP-a (i posle direktnog SQL UPDATE-a).
CREATE OR REPLACE FUNCTION public.sync_user_level()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.xp := GREATEST(COALESCE(NEW.xp, 0), 0);
  NEW.level := public.level_from_xp(NEW.xp);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_level_from_xp ON users;
CREATE TRIGGER trg_users_level_from_xp
  BEFORE INSERT OR UPDATE OF xp, level ON users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_level();

-- Backfill: popravi svaki red koji je zaostao (i okini postojeći trigger jednom).
UPDATE users
SET level = public.level_from_xp(GREATEST(COALESCE(xp, 0), 0))
WHERE level IS DISTINCT FROM public.level_from_xp(GREATEST(COALESCE(xp, 0), 0));

-- Atomna admin korekcija XP-a. Vraća ceo (ažuriran) red — app ga mapira u UserRecord.
CREATE OR REPLACE FUNCTION public.bump_user_xp(p_user_id UUID, p_amount INTEGER)
RETURNS SETOF users
LANGUAGE sql
VOLATILE
AS $$
  UPDATE users
     SET xp = GREATEST(0, COALESCE(xp, 0) + COALESCE(p_amount, 0)),
         updated_at = NOW()
   WHERE id = p_user_id
  RETURNING *;
$$;

REVOKE ALL ON FUNCTION public.bump_user_xp(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_user_xp(UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION public.xp_for_level(INTEGER) IS
  '6.0.0 — prag XP-a za nivo (round(500 * level^1.35)); mora da se poklapa sa xpForLevel u server/lib/store.ts';
COMMENT ON FUNCTION public.level_from_xp(INTEGER) IS
  '6.0.0 — inverz od xp_for_level; nivo se ne postavlja ručno';
COMMENT ON FUNCTION public.bump_user_xp(UUID, INTEGER) IS
  '6.0.0 — admin korekcija XP-a mimo dnevnog limita (nikad ispod 0), nivo se izvodi triggerom';

NOTIFY pgrst, 'reload schema';
