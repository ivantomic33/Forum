-- SEKCIJA: server/schema-2.6.6-deal-topic.sql
-- ======================================================================
-- ============================================================================
-- NEXUS 2.6.6 — TEMA IZ DEAL-A / „Diskutuj o ovom popustu“ (F-3)
-- ----------------------------------------------------------------------------
-- `forum_threads.deal_id` je jedina nova kolona. U `server/schema-ALL.sql`
-- kolona se dodaje BEZ FK-a (tabela `deals` nastaje tek u sekciji 2.6.0, a
-- `schema-ALL.sql` se pušta kao jedna transakcija) — zato se referenca
-- uspostavlja ovde, posle `10-2.6.0-deals.sql`.
--
-- `ON DELETE SET NULL`: brisanje deal-a ne briše diskusiju, samo gubi karticu.
-- Idempotentno — bezbedno za ponovno puštanje.
-- ============================================================================

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deal_id UUID;

-- F-7.1 #8 — „prati temu mejlom“: praćenje ostaje in-app, ova kolona dodaje mejl
-- na novi odgovor (najviše 1 mejl / 15 min po korisniku i temi).
ALTER TABLE thread_subscriptions
  ADD COLUMN IF NOT EXISTS email_on_reply BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_thread_subscriptions_email
  ON thread_subscriptions(thread_id) WHERE email_on_reply;

COMMENT ON COLUMN forum_threads.deal_id IS
  'F-3 — deal iz kojeg je tema otvorena („Diskutuj o ovom popustu“); NULL za obične teme';

-- FK dodajemo samo ako već ne postoji (ponovno puštanje ne puca).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_deal_id_fkey'
  ) THEN
    ALTER TABLE forum_threads
      ADD CONSTRAINT forum_threads_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forum_threads_deal ON forum_threads(deal_id);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- NEXUS 2.7.0 — F-9 „Kupio sam“ / F-4 PRICE ALERT / F-5 KOLEKCIJE / F-10 WARNINGS
-- ----------------------------------------------------------------------------
-- Sve je idempotentno (`IF NOT EXISTS`), pa se fajl i dalje može puštati više
-- puta. Nema zavisnosti između sekcija — svaka se može primeniti i zasebno.
-- ============================================================================

-- ---------- F-9: „KUPIO SAM“ (deal_claims) ----------
-- Socijalni dokaz, NE verifikacija kupovine: korisnik sam potvrđuje da je
-- kupio preko ovog deal-a. UNIQUE (deal_id, user_id) → dvostruki klik i dva
-- taba ne naduvavaju broj. `deals.score` ostaje netaknut (glasovi su drugo).
CREATE TABLE IF NOT EXISTS deal_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_claims_deal ON deal_claims (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_claims_user ON deal_claims (user_id);

ALTER TABLE deal_claims ENABLE ROW LEVEL SECURITY;

-- ---------- F-4: PRICE ALERT (deal_watches) ----------
-- Korisnik prati IGRU (`game_id`), ne pojedinačni deal; obaveštenje ide kada
-- cena padne ispod `target_price`. `game_title`/`game_slug` su snapshot da
-- praćenje preživi brisanje igre iz kataloga. `notified_at` je i throttling
-- (1 mejl / 24 h po korisniku i igri) i znak da je mejl poslat.
CREATE TABLE IF NOT EXISTS deal_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  game_title VARCHAR(200) NOT NULL,
  game_slug VARCHAR(200),
  target_price NUMERIC(10, 2) NOT NULL CHECK (target_price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ
);

-- Jedno praćenje po (korisnik, igra) — ponovni POST samo menja prag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_watches_user_game
  ON deal_watches (user_id, game_id) WHERE game_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_watches_game ON deal_watches (game_id);

ALTER TABLE deal_watches ENABLE ROW LEVEL SECURITY;

-- ---------- F-5: KOLEKCIJE / LISTE IGARA ----------
-- Korisničke liste („Top 10 RPG 2026“). Svaka je javna SEO stranica
-- (/collections/:slug); `slug` je globalno jedinstven jer se koristi u URL-u.
CREATE TABLE IF NOT EXISTS game_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  description VARCHAR(600),
  is_public BOOLEAN NOT NULL DEFAULT true,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_collections_user ON game_collections (user_id);
CREATE INDEX IF NOT EXISTS idx_game_collections_public ON game_collections (is_public, created_at DESC);

CREATE TABLE IF NOT EXISTS game_collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES game_collections(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  game_title VARCHAR(200) NOT NULL,
  game_slug VARCHAR(200),
  game_cover VARCHAR(500),
  note VARCHAR(280),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_collection_items_collection
  ON game_collection_items (collection_id, position);
-- Ista igra ne može dva puta u istoj listi.
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_collection_items_unique
  ON game_collection_items (collection_id, game_slug) WHERE game_slug IS NOT NULL;

-- Jedan glas po korisniku po listi (up/down), isto pravilo kao `deal_votes`.
CREATE TABLE IF NOT EXISTS game_collection_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES game_collections(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(4) NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_collection_votes_collection ON game_collection_votes (collection_id);

ALTER TABLE game_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_collection_votes ENABLE ROW LEVEL SECURITY;

-- ---------- F-10: UPOZORENJA (warnings) PRE BANA ----------
-- Ban je poslednja mera; moderator prvo daje upozorenje sa razlogom i rokom.
-- `acknowledged_at` beleži da je korisnik video upozorenje (banner u UI-ju),
-- a `revoked_at` da ga je moderator poništio (pogrešna prijava).
CREATE TABLE IF NOT EXISTS user_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason VARCHAR(500) NOT NULL,
  -- thread/reply/article/comment/user/deal — šta je bilo predmet prijave.
  target_type VARCHAR(20),
  target_id UUID,
  expires_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON user_warnings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_warnings_active
  ON user_warnings (user_id) WHERE revoked_at IS NULL;

ALTER TABLE user_warnings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE deal_claims IS
  'F-9 — korisnik potvrdio da je kupio preko deal-a (socijalni dokaz, ne verifikacija)';
COMMENT ON TABLE deal_watches IS
  'F-4 — praćenje cene igre; mejl kada deal padne ispod target_price (throttle 24 h)';
COMMENT ON TABLE game_collections IS
  'F-5 — korisničke liste igara (javna SEO stranica /collections/:slug)';
COMMENT ON TABLE user_warnings IS
  'F-10 — upozorenja moderatora pre bana; ban ostaje u bans tabeli';

-- ---------- F-2: DNEVNI LOOP (streak + dnevni kvest) ----------
-- Jedan red po (korisnik, dan). `day` je kalendarski datum u vremenskoj zoni
-- servera (`dayKey()` u `server/lib/dailyLoop.ts`), pa se streak računa bez
-- vremenskih zona u SQL-u. `bonus_claimed`/`quest_completed` su idempotentne
-- oznake (drugi post istog dana ne daje bonus ponovo).
CREATE TABLE IF NOT EXISTS user_daily_activity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  bonus_claimed BOOLEAN NOT NULL DEFAULT false,
  quest_completed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_day ON user_daily_activity (day);

ALTER TABLE user_daily_activity ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE user_daily_activity IS
  'F-2 — dnevna aktivnost (streak, XP dana, bonus za prvi post, dnevni kvest)';

-- ---------- F-7: WEB PUSH PRETPLATE (push_subscriptions) ----------
-- Jedan red po uređaju/pretplati. `endpoint` je jedinstven kod push servisa
-- (FCM/Mozilla autopush), pa je UNIQUE globalan — isti uređaj koji se prijavi
-- drugim nalogom menja vlasnika umesto da pravi duplikat.
-- `p256dh`/`auth` su javni ključevi pretplate (ne tajne korisnika).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE push_subscriptions IS
  'F-7 — web push pretplate (jedan red po uređaju; ruta /api/push/*)';

-- ---------- F-11: KALKULATOR BUILD-a ----------
-- Katalog komponenti sa cenom kod JEDNE domaće prodavnice (moderator menja
-- cenu kada se promeni — isti obrazac kao `deals`, bez scrapinga). Build je
-- korisnički izbor komponenti; `share_id` je kratak javni ID za deljenje.
CREATE TABLE IF NOT EXISTS pc_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(20) NOT NULL CHECK (category IN (
    'cpu','gpu','motherboard','ram','storage','psu','case','cooler','monitor','peripheral'
  )),
  name VARCHAR(140) NOT NULL,
  brand VARCHAR(60),
  spec VARCHAR(160),
  price NUMERIC(12, 2) NOT NULL CHECK (price > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'RSD',
  store VARCHAR(80) NOT NULL,
  url VARCHAR(1000),
  image_url VARCHAR(1000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_components_category ON pc_components (category, price);

CREATE TABLE IF NOT EXISTS pc_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  share_id VARCHAR(16) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pc_builds_user ON pc_builds (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pc_build_items (
  build_id UUID NOT NULL REFERENCES pc_builds(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES pc_components(id) ON DELETE CASCADE,
  qty SMALLINT NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 10),
  PRIMARY KEY (build_id, component_id)
);

ALTER TABLE pc_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_build_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pc_components IS
  'F-11 — katalog PC komponenti sa cenama kod domaćih prodavnica (kalkulator build-a)';
COMMENT ON TABLE pc_builds IS
  'F-11 — sačuvani build-ovi korisnika; `share_id` je javni deljivi ID';

-- ======================================================================
-- F-15 — TRUSTED DEVICE ZA 2FA („zapamti ovaj uređaj 30 dana“)
-- ======================================================================
-- Cookie `nx_trust` nosi sirovi token; ovde je SAMO SHA-256 hash i `device_id`
-- (jedan red = jedan uređaj). Čuvanje po `device_id` omogućava:
--   * svako ponovno uspešno 2FA prijavljivanje na isti uređaj produžava rok;
--   * isključivanje 2FA i promena lozinke brišu sve redove korisnika.
CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_devices_hash ON trusted_devices (token_hash);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices (expires_at);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE trusted_devices IS
  'F-15 — 2FA trusted devices: hash tokena iz HttpOnly cookie-ja nx_trust, rok 30 dana';

-- ============================================================================
-- NEXUS 2.7.2 — SITNI DELJENI KLJUČ–VREDNOST, TIPOVI NOTIFIKACIJA, SOFT DELETE
-- ----------------------------------------------------------------------------
-- Zatvara rupe između koda i šeme koje su ostale posle 2.7.0. Isti sadržaj je
-- i u `server/sql/22-2.7.2-email-notifikacije.sql` (taj fajl je samostalna
-- migracija za živu bazu). Idempotentno — bezbedno za ponovno puštanje.
-- ============================================================================

-- ---------- 1. `site_meta` (deljeni ključ–vrednost) ----------
-- Koriste ga: throttle „1 mejl / 15 min“ po temi (`lib/threadEmails.ts`),
-- marker poslednjeg digesta (`lib/digest.ts`), red zakazanih kampanja
-- (`lib/campaigns.ts`). Bez tabele sve tri stvari tiho žive u `Map`-u procesa.
CREATE TABLE IF NOT EXISTS site_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_meta_updated ON site_meta (updated_at);

ALTER TABLE site_meta ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE site_meta IS
  'Deljeni ključ–vrednost: digest marker, throttle mejla po temi, red zakazanih newsletter kampanja';

-- ---------- 2. `notifications.type` — prošireno CHECK ----------
-- Kod šalje i `warning` (F-10), `streak` i `level_up` (F-2), `price_alert` (F-4);
-- bez ovoga insert puca (23514) i te notifikacije nikad ne stižu u zvonce.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

-- Živa baza (2.4.x) ima inline CHECK iz `CREATE TABLE`; ime zavisi od verzije
-- Postgresa (`notifications_type_check`, `…check1`). Zato tražimo svaki CHECK
-- na `notifications` koji pominje `reply` i uklanjamo ga pre novog.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reply%'
  LOOP
    EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'reply', 'mention', 'upvote', 'badge_earned', 'quest_completed', 'system',
    'warning', 'streak', 'level_up', 'price_alert'
  ));

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id) WHERE is_read = false;

-- ---------- 3. SOFT DELETE TEME (F-10 „Vrati“) ----------
-- `is_deleted` postoji od 2.4.1; ovde su samo tragovi ko/ kada.
ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE forum_threads
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_forum_threads_visible
  ON forum_threads (last_activity_at DESC) WHERE is_deleted = false;

NOTIFY pgrst, 'reload schema';
