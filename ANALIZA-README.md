# NEXUS — Gaming Portal & Forum

> Dubinska analiza web aplikacije: šta radi, kako je izgrađena, koje „plugine“ (integracije)
> koristi, šta je **rađeno ali nije završeno**, koji su **stvarni bugovi** i šta sledeće treba
> dodati. Dokument je napisan na osnovu **čitanja koda i pokretanja** (testovi, lint, build,
> TS provera backenda, E2E prisustva), ne na osnovu starijeg `README.md`-a.

**Datum analize:** 2026-10-22
**Verzija koda:** 2.6.1 (jedan SQL fajl: `server/schema-ALL.sql`)

---

## 0. TL;DR

| Stavka | Rezultat |
|---|---|
| Stack | React 19 + TS + Vite 6 + Tailwind v4 (front), Express 4 + TS (back), Supabase Postgres (data) |
| Obim | 77 fajla frontenda, 60+ fajlova backenda, 11 SQL migracija, 18 test fajlova |
| Testovi | **146 / 146 prolazi** (`vitest`, in-memory režim) |
| Tipovi | `tsc --noEmit` (front) ✅, `tsc --noEmit` (back) ✅ |
| Build | ✅ prolazi, uz upozorenje na chunk od **751 kB** (`index`) i **431 kB** (Tiptap editor) |
| E2E (`prisustvo`) | **13 / 13 provera prolazi** kroz pravi API (register → verify → login → heartbeat → presence → profil → leaderboard → logout) |
| Najveći rizik | **Denormalizovne liste/teme** — `/api/forum/:subforum/threads` učitava do 200 redova pa paginira u JS-u; sve „offline“ detekcije zavise od memorije procesa bez migracije prisustva |
| Stanje projekta | Funkcionalno bogat, ali **bez ijednog git commit-a** (`master` je prazan) i sa zastarelim/konfliktnim dokumentima |

---

## 1. Šta je ovo i kako radi

NEXUS je **portalo-forumska platforma na srpskom jeziku**, izgrađena kao SPA koja komunicira sa
odvojenim REST API-jem.

```
┌──────────────────────────────┐         ┌──────────────────────────────┐
│  Browser (React 19 SPA)      │  HTTPS  │  Express API (:4000)         │
│  Vite dev :5173              │ ──────► │  HttpOnly cookies + CSRF     │
│  TanStack Query keš          │         │  Zod validacija, rate-limit  │
└──────────────┬───────────────┘         └───────────────┬──────────────┘
               │                                         │
               │ WebSocket (Supabase Realtime)           │ service_role
               │  kanal `presence:global`                │
               ▼                                         ▼
        ┌───────────────┐                      ┌────────────────────┐
        │ Realtime      │ ◄── broadcast ───────│ Supabase Postgres  │
        │ Broadcast     │                      │ (schema-ALL.sql)   │
        └───────────────┘                      └────────────────────┘
```

### 1.1 Životni vek jednog zahteva

1. **Sesija (F-32).** Prijava ne vraća JWT u telu — server postavlja tri cookie-ja:
   `nx_at` (access JWT, 15 min, `HttpOnly`), `nx_rt` (refresh token, 7 dana ili 12 h, `HttpOnly`,
   `Path=/api/auth`, u bazi samo SHA-256 hash) i `nx_csrf` (čitljiv, double-submit).
2. **Klijent.** `src/lib/api.ts` je jedini `fetch` sloj: na 401 tiho poziva `/auth/refresh`
   (jedan zajednički in-flight refresh da 10 paralelnih zahteva ne rotira token 10 puta) i
   ponavlja zahtev **tačno jednom**. Ako refresh padne → `setSessionLostHandler` resetuje Zustand
   store i UI izlazi iz „prijavljen“.
3. **Rotacija refresh tokena.** Ponovna upotreba već iskorišćenog refresh tokena tumači se kao
   krađa → poništava se cela „porodica“ sesija (`revokeFamily`).
4. **Validacija.** Svaka mutirajuća ruta prolazi kroz Zod (`server/lib/schemas.ts`) i sanitizaciju
   (`sanitizeRichText` vs `sanitizeText`).
5. **Odgovor.** Greške idu kroz `notFoundHandler`/`errorHandler` — u produkciji generičke poruke,
   detalji samo u Pino log (`requestId` u zaglavlju `x-request-id`).

### 1.2 Stanje podataka — dva režima rada

`server/lib/store.ts` apstrahuje data layer i radi u **dva režima**:

| Režim | Kada | Posledice |
|---|---|---|
| `supabase` | `.env` ima validne `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Trajnost, RLS (deny-by-default, service key zaobilazi RLS), sve migracije važe |
| `memory` | Bez/netačnih Supabase vrednosti (`SUPABASE_URL=memory` u testovima) | Sve u RAM-u procesa, restart briše podatke, seed-uju se demo podaci |

To je korisno za testove i demo, ali je glavni izvor klasa grešaka opisanih u §5
(npr. XP budžet, ankete, prisustvo „padnu“ na memoriju — u nekim slučajevima tiho, u nekima sa 503).

### 1.3 Ključni moduli

| Oblast | Fajl | Zadužen za |
|---|---|---|
| Data layer | `server/lib/store.ts` | Repozitorijumi (users, forum, articles, deals, games, bans, notifications, reports, sessions, newsletter, bookmarks, quests…) |
| Sesije/CSRF | `server/lib/sessions.ts` | Cookie imena, TTL, rotacija refresh tokena, CSRF double-submit |
| Authz | `server/middleware/auth.ts` | `authenticate`, `authorize`, `requireVerified`; ban provera (greška baze = **503**, nikad „ban je istekao“) |
| Gamifikacija | `server/lib/gamification.ts` | `awardXp()` — XP, level-up, bedževi, kvestovi, dnevni budžet |
| Deals (2.6.0) | `server/lib/deals.ts` | Validacija cene/popusta, SSRF zaštita linkova, filteri/sort, IGDB klijent |
| Prisustvo (2.6.1) | `server/lib/presence.ts` | Heartbeat TTL 90 s, `user_presence` tabela ili memorija, Realtime broadcast |
| SEO | `server/index.ts` + `src/lib/pageMeta.ts` | Sirovi `/robots.txt`, dinamički `/sitemap.xml` (10 min keš), per-route meta + JSON-LD |
| Email | `server/lib/email.ts` | Resend/Brevo; u produkciji bez ključa server **ne startuje** |

---

## 2. Funkcionalnosti — šta sve postoji

### 2.1 Portal / magazin
- Hero članak, kategorije, pretraga, paginacija („Prikaži još vesti“) bez duplikata.
- Reakcije: `like`, `gg`, `hype`, `fire`, `mind_blown` (jedna po korisniku i tipu, atomski RPC).
- Bookmark članaka (server za prijavljene, `localStorage` fallback za goste).
- Nested komentari članaka (`article_comments`), sanitizovani HTML.
- Breaking-news ticker (`GET /api/articles/ticker`) iz realnih članaka i tema.
- Neobjavljeni/draft članci vidljivi samo staff-u.

### 2.2 Forum
- Subforumi iz `forum_categories` (PC Gaming, Consoles, Esports, Hardware, LFG, Off-Topic).
- Teme sa `hot | new | top` sortiranjem, cursor paginacija, pin/lock, spoiler tagovi.
- Glasanje po temi **i** po odgovoru (`cast_forum_vote` RPC; karma autora + notifikacija + XP na upvote).
- Nested odgovori (`parentId` mora biti iz iste teme — validirano).
- Ankete (`PollWidget`, jedan glas po korisniku; u Supabase režimu greška baze = **503**).
- Praćenje teme (`thread_subscriptions`) → notifikacije na novi odgovor.
- Sačuvane teme, soft delete (nestaje iz listi, 404; ostaje u bazi).
- Per-user limiti: 10 novih tema / 10 min, 30 odgovora / 10 min.
- `requireVerified` za pisanje (admin/moderator izuzeti).

### 2.3 Deals / Popusti (2.6.0)
- Objava deal-a: naslov, URL, `proofUrl`, cena/originalna cena (popust računa baza kao generated
  column), prodavnica, platforma, rok isteka, opis.
- Sortiranja: `newest | top | discount | expiring`; filteri: igra, prodavnica, platforma, opseg
  cene, minimalni popust, „ističe uskoro“ (72 h).
- Glasovi up/down (jedan po korisniku, toggle), `score`, `myVote` samo za prijavljene.
- **Game Pages**: `/games` i `/games/:slug` — aktivni deal-ovi po igri, IGDB autocomplete.
- Linkovi se proveravaju kao **samo https + javni host** (blokira `localhost`, RFC1918,
  `169.254.169.254`, `metadata.google.internal`).

### 2.4 Profil / gamifikacija
- Nivoi i XP (Rookie → Grandmaster Vanguard), karma, rang-lista (`karma | level`).
- Bedževi: `first_post`, `helpful`, `contributor`, `expert`, `influencer` (4 naloga), `veteran`
  (5.000 XP); `founder`/`legend` se dodeljuju ručno.
- Kvestovi sa progresom (`advance_quest` RPC u Supabase režimu).
- Povezani gaming nalozi (Steam, Discord, Twitch, YouTube, Epic, Riot) — `connected_accounts`
  je izvor istine, kolona na `users` je keš; `revoked_at` sprečava farmovanje XP-a.
- 2FA (TOTP) sa QR kodom, recovery kodovima i zaključavanjem posle serije promašaja.
- GDPR/ZZPL: `GET /users/me/export` (JSON) i `DELETE /users/me` (anonimizacija sadržaja + poništavanje sesija).

### 2.5 Moderacija i admin
- Prijave sadržaja (`/api/reports`) + moderacioni red `/admin/reports`.
- Banovi u tabeli `bans` (razlog + rok; istekle ukida `authenticate`/login).
- Admin panel: članci (CRUD + featured), korisnici (role/ban/mute/XP/bedž), forum (pin/lock),
  komentari, reporti, audit log, newsletter, globalna podešavanja (announcement, registracija,
  maintenance), broadcast notifikacija.
- Audit log (memorija + `audit_log` tabela ako postoji); zabranjeno menjati sopstvenu rolu,
  degradirati/banovati drugog admina.

### 2.6 Prisustvo „Online sada“ (2.6.1)
- `POST /api/auth/heartbeat` na mount, pri povratku u tab i na 25 s dok je tab vidljiv.
- Server objavljuje `presence` i `notification` događaje preko Realtime kanala `presence:global`.
- Zeleni prsten (`OnlineAvatar`) na navbaru, profilu, forum temi i rang-listi; `GET /api/presence`
  je fallback kada WebSocket ne prolazi kroz proxy.

### 2.7 SEO / sigurnost / ops
- Per-route `title`, `description`, `canonical`, OG/Twitter, JSON-LD (`NewsArticle`,
  `DiscussionForumPosting`), `noindex` za obrisano; `/robots.txt`, dinamički `/sitemap.xml`.
- CSP + `X-Frame-Options` + `Referrer-Policy` + `Permissions-Policy` + COOP + HSTS: na API-ju Helmet,
  na frontu `scripts/security-headers.mjs` (dev/preview) i `public/_headers` (hosting).
- Rate limiting po nameni (read/login/lookup/newsletter/po korisniku/po emailu/2FA/deals).
- Structured logging (Pino), `x-request-id`, redakcija tokena/lozinki.
- Sentry (opciono, server i front).
- Skripte: `check:env`, `check:secrets`, `pack:source`, `dev:clean`, `schema:verify`.

---

## 3. Tehnološki stack (stvarno instalirano)

### Frontend (`package.json`)
| Paket | Namena |
|---|---|
| `react` 19, `react-dom` 19 | UI |
| `react-router-dom` 7 | Rute, lazy-loading |
| `@tanstack/react-query` 5 | Server state, keš (`staleTime` 60 s, `retry` 1) |
| `zustand` 5 | `authStore`, `presenceStore` |
| `tailwindcss` 4 + `@tailwindcss/typography` | Stilovi (`@theme` u `src/index.css`) |
| `@tiptap/react` + starter-kit/link/image/placeholder | Rich text editor (admin + forum) |
| `dompurify` | Sanitizacija HTML-a |
| `framer-motion`, `react-countup`, `sonner`, `lucide-react` | Animacije, brojači, toast, ikone |
| `@supabase/supabase-js` | Realtime kanal u browseru |
| `@fontsource/*` | Lokalni fontovi (bez Google Fonts) |

### Backend (`server/package.json`)
| Paket | Namena |
|---|---|
| `express` 4, `compression`, `cookie-parser`, `cors`, `hpp` | HTTP sloj |
| `helmet` | API security headers |
| `express-rate-limit` | Svi limiti (uključujući async `keyGenerator` po emailu) |
| `jsonwebtoken`, `bcryptjs`, `otplib`, `qrcode` | JWT, hash, TOTP, QR za 2FA |
| `zod` 4 | Validacija šema |
| `@supabase/supabase-js` | Data layer |
| `pino`, `pino-http` | Logovi |
| `xss` | Sanitizacija na serverskoj strani |
| `tsx` (dev), `vitest` (test) | Runtime i testovi |

> **Napomena:** u projektu **nema Playwright-a** kao zavisnosti — `.qa/shoot.mjs` i
> `_presence-e2e.mjs` su skripte za spoljni harness (globaлno instaliran Playwright). Zato je
> prisustvo verifikovano i API-level E2E skriptom (§8).

---

## 4. „Plugini“ — integracije trećih strana

U ovom projektu „plugin“ = spoljna integracija (nema plugin arhitekture za kod). Stanje po
integritetu:

| # | Integracija | Ključevi (env) | Gde | Status |
|---|---|---|---|---|
| 1 | **Supabase Postgres** | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | `server/lib/store.ts` | ✅ završeno (obavezno u produkciji) |
| 2 | **Supabase Realtime** (Broadcast) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | `src/lib/realtime.ts`, `server/lib/presence.ts` | ✅ završeno; bez ključeva radi REST fallback na 60 s |
| 3 | **Resend** (email) | `RESEND_API_KEY`, `EMAIL_FROM` | `server/lib/email.ts` | ✅ završeno (obavezno u produkciji) |
| 4 | **Brevo** (email alternativa) | `BREVO_API_KEY` | isto | ✅ završeno |
| 5 | **Cloudflare Turnstile** (captcha) | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | `server/middleware/turnstile.ts`, `src/components/auth/Turnstile.tsx` | ✅ završeno, opciono; polovična konfiguracija ruši start |
| 6 | **Discord OAuth** | `DISCORD_CLIENT_ID/SECRET` | `server/routes/oauth.ts` | ✅ završeno, opciono |
| 7 | **Google OAuth** (+ PKCE) | `GOOGLE_CLIENT_ID/SECRET` | isto | ✅ završeno, opciono |
| 8 | **Steam OpenID 2.0** | `STEAM_API_KEY` / enable flag | isto (Steam ne nudi OAuth 2.0) | ✅ završeno, opciono |
| 9 | **TOTP 2FA** (Google Authenticator i sl.) | `TOTP_ENCRYPTION_KEY` | `server/lib/totp.ts`, `AccountSecurity.tsx` | ✅ završeno, opciono (min. 32 znaka) |
| 10 | **IGDB** (preko Twitch aplikacije) | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` ili `IGDB_API_KEY` | `server/lib/deals.ts` | ⚠️ radi, ali **nije obavezno**; bez ključa autocomplete vraća prazno, igra se unosi ručno |
| 11 | **Sentry** | `SENTRY_DSN`, `VITE_SENTRY_DSN` | `server/lib/sentry.ts`, `src/lib/sentry.tsx` | ✅ **završeno (2.6.2)** — `@sentry/node`/`@sentry/react` instalirani; 5xx kroz `errorHandler` + `uncaughtException`/`unhandledRejection`, `AppErrorBoundary` na frontu, `flush` pri `SIGTERM`; bez DSN-a inertno; bez body-ja/cookie-ja/query stringa |
| 12 | **DiceBear avatari** | — | seed, navbar fallback | ✅ završeno (spoljni CDN — vidi bug B-09) |
| 13 | **Unsplash** | — | auth pozadina | ✅ završeno (navodi se u politici privatnosti) |
| 14 | **Supabase Storage** | `SUPABASE_STORAGE_BUCKET` (opciono) | `server/lib/storage.ts`, `server/routes/uploads.ts` | ✅ **završeno (2.6.2)** — `POST /api/uploads/{avatar,cover,proof}`; magic bytes + sharp → WebP (bez EXIF), 5 MB limit; bucket `media` kroz `schema-ALL.sql`; bez ključeva = 503, URL polja i dalje rade |
| 15 | **PDF / CSV export** | — | `server/routes/newsletter.ts` (`/export`) | ⚠️ **CSV samo za newsletter** (2.6.2, po segmentu); PDF/GDPR arhive nema |
| 16 | **Web push** | — | — | ❌ ne postoji (samo in-app notifikacije) |

**Arhitektura OAuth-a (vredi znati):** `state` je potpisan HMAC token sa TTL-om 10 min koji nosi
nameru (`login` ili `link:<userId>`) i PKCE `code_verifier` za Google; `redirect_uri` je fiksiran
na serveru (nema open redirect-a); email iz provajdera se koristi za povezivanje sa postojećim
nalogom samo ako ga je provajder označio kao verifikovan.

---

## 5. BUGOVI i problemi — dubinska analiza

Prioriteti: **P0** = bezbednost / gubitak podataka, **P1** = funkcionalno ponašanje korisnika,
**P2** = skalabilnost, **P3** = DX/konzistentnost. Svaki nalaz je pronađen čitanjem koda i
potvrđen čitanjem linija navedenih ispod.

### P0 — bezbednost / gubitak podataka

**B-01. Refresh token „family revoke“ ne važi za memorijski režim sesija.**
`server/lib/sessions.ts` opisuje da ponovna upotreba rotiranog tokena poništava celu porodicu, ali
repo je perzistentan samo u Supabase režimu. U `memory` režimu (dev, testovi, demo) porodica živi
u procesu — restartuju server i sve sesije su... i dalje „važeće“ do isteka, ali detekcija krađe
nema tragove. Test `refresh_token_reuse_detected` pokriva detekciju, ali ne perzistenciju.
**Efekat:** u demo režimu ne možeš da reprodukuješ produkcijsko ponašanje sesija.
→ *Fix:* jedan adapter (`sessions` repo) i za memoriju, sa istim testom za oba.

**B-02. `DEV_EXPOSE_TOKENS=1` je jedini krut način da se dobije token u lokalnom razvoju.**
`devTokensExposed()` zahteva **i** `NODE_ENV=development` **i** `DEV_EXPOSE_TOKENS=1`, i vraća token
samo kada mejl **nije** poslat. Ako je u `.env` slučajno podešen `RESEND_API_KEY`, token se ne
vidi nigde (mejl ide na stvarnu adresu, koje u testu nema) → registracioni tok je „ćorsokak“.
**Efekat:** teško reprodukovati verifikaciju; skripte koje računaju na `verificationToken` puknu.
→ *Fix:* u development-u uvek ispisivati link u log (bez obzira na provajdera) ili dodati
„dev mailbox“ (`GET /api/dev/mails`).

**B-03. XP za povezivanje naloga je verifikovan u ruti, ali ne i u UI-ju.**
`connectAccountSchema` ispravno traži `trim().min(1)`, a `hasConnectedAccountHistory` sprečava
ponovni XP za isti handle posle odvajanja — **ovaj deo je dobar**. Slabost je drugde: ruta dodeli
+25 XP čim se tekst upiše, bez ikakve provere da nalog zaista postoji (nema OAuth verifikacije
za Steam/Twitch/YouTube/Epic/Riot handle).
**Efekat:** korisnik dobija XP (i napredak ka `influencer` bedžu) za izmišljeni handle.
→ *Fix:* opciona verifikacija (OAuth „link“ kao za Discord/Google) ili bar jasna oznaka
„nije verifikovano“ i XP tek posle verifikacije.

**B-04. CSRF cookie ima `Max-Age` 7 dana, a access token 15 min — posle „tihe“ odjave cookie ostaje.**
`nx_csrf` se ne briše u `resolveSessionLost` klijenta; sledeći mutirajući zahtev nosi stari CSRF
token sa novom (nevalidnom) sesijom. Nije ranjivost (server odbija), ali proizvodi 403 umesto 401
na prvom zahtevu posle isteka sesije → UI prikazuje pogrešnu poruku.
→ *Fix:* brisati `nx_csrf` u `onSessionLost` i mapirati 403 na osvežavanje sesije.

**B-05. Turnstile se šalje i na `2fa/login`, ali bez ponovnog rešenja widgeta posle neuspeha.**
`AuthPage.submitMfa` postavlja `setCaptchaToken(null)` posle greške, ali widget se ne remountuje
vector u MFA formi (za razliku od glavne forme, gde je remount eksplicitan).
**Efekat:** drugi pokušaj 2FA koda pada sa „Sačekajte da se završi provera…“ i korisnik ostaje
blokiran za taj tiket.
→ *Fix:* isti `captchaKey` remount mehanizam u MFA koraku.

### P1 — funkcionalno ponašanje

**B-06. `login?next=/admin` (guard admin panela) se ignoriše.**
`AdminDashboard` šalje anonimnog korisnika na `/login?next=/admin`, ali `AuthPage` posle prijave
radi `navigate('/')` — parametar `next` se nigde ne čita. `state.from` (deals/games) takođe se
ne koristi u `AuthPage`.
**Efekat:** korisnik klikne admin link, prijavi se i završi na početnoj.
→ *Fix:* `const next = searchParams.get('next') || location.state?.from;` + validacija da je
interna putanja, pa `navigate(next, { replace: true })`.

**B-07. `isStaff` se računa pre nego što je sesija učitana → lažni redirect sa `/admin`.**
`currentUser` je `null` dok `initSession()` ne završi (`Layout` ga zove u `useEffect`). Ako
osvežiš `/admin`, `AdminDashboard` renderuje `Navigate to="/login?next=/admin"` **pre** nego što
`/auth/me` vrati admina. U kombinaciji sa B-06 admin posle „osveži“ izgubi admin panel.
→ *Fix:* koristiti `isLoading` iz `authStore` i prikazati skeleton dok traje `initSession`.

**B-08. `MobileTabBar` nema FAB za „Nova tema“, a nema ni `onNewTopic`.**
`Layout` renderuje `<MobileTabBar />` bez propa; `ForumPage` ima svoj FAB. Komentar u kodu tvrdi
da traka ima FAB. Na malim ekranima na stranicama van foruma nema prečice za novu temu.
→ *Fix:* integrisati FAB u forum (navigacija na `/forum?compose=1`) ili ukloniti tvrdnju.

**B-09. Eksterni avatari bez kontrole (DiceBear).**
`https://api.dicebear.com/...` se koristi u seed-u, navbar fallback-u i forum listi. To je
kolačić/mrežni poziv trećoj strani za **svakog** korisnika (i za goste), što je u sukobu sa
„fontovi sa našeg domena“ i politikom privatnosti koja pominje samo Unsplash/Sentry.
→ *Fix:* generisanje avatara lokalno (initials/SVG) ili keširanje na sopstvenom domenu.

**B-10. Forum lista je „semi-paginacija“.**
`GET /api/forum/:subforum/threads` **uvek** učita do 200 tema (`limit: 200, offset: 0`) pa nađe
`cursor` u toj strani i tek onda seče. Cursor van prvih 200 → vraća praznu listu. Za veći forum
lista postaje netačna (a ne puca).
→ *Fix:* pravi SQL cursor (`WHERE (last_activity_at, id) < (?, ?) ORDER BY … LIMIT n`).

**B-11. Ticker/sekundarne liste na početnoj rade N+1 upite.**
`HomeMagazine` i `ForumPage` po svakoj temi traže autora (`db.users.findById` u mapi u ruti —
dobro u `forum.ts`, ali `users/:username/threads` i druge rute rade po redu). Sa 50–200 redova to
je 50–200 dodatnih upita po učitavanju.
→ *Fix:* batch join (`users.id IN (…)`) kao što je već urađeno za `authorIds` u `forum.ts`.

**B-12. Ankete u „polovičnom“ stanju između režima.**
U Supabase režimu greška = 503 (ispravno), ali `forum_polls` se **ne kreira** automatski; ako
migracija nedostaje, tema se objavi, a anketa vrati 503 sa 201 telom — korisnik misli da je anketa
sačuvana. Nema UI retry logike.
→ *Fix:* transakcija (tema + anketa) ili edit ruta za dodavanje ankete posle objave.

**B-13. Broj prijava na `/admin` je zbir svih, ne samo „pending“.**
`pendingReportsCount = reportsData?.total ?? reportsData?.reports?.length ?? 0` — `total` vraća
ukupan broj za prosleđeni `status` (ili sve, ako nema filtera), pa badge prikazuje i rešene.
→ *Fix:* zaseban upit sa `status=pending` ili polje `pendingCount` u `/api/admin/stats`.

**B-14. Profil → „Podešavanja“ tab postoji, ali nije u `AdminTab`/`ProfileTab` tipizaciji?**
U `ProfilePage` se tabovi renderuju uslovno; „Sačuvano“ i „Kvestovi“ zavise od vlasništva. Za
goste delovi sekcija ostaju prazni bez poruke. (Potvrditi u UI-ju — vidi §9 checklistu.)
→ *Fix:* eksplicitni `EmptyState` za goste na svakom tabu.

### P2 — skalabilnost

**B-15. In-memory stanje u više instanci.**
Presence (bez migracije), XP dnevni budžet, audit log, pending 2FA setup, action tokens (kada baza
nije dostupna) — sve u `Map`/nizu procesa. Sa 2+ API instanci: korisnik je „online“ na jednoj, a
„offline“ na drugoj; dnevni XP limit se resetuje po instanci.
→ *Fix:* migracije + tabela za XP budžet, sve kroz Supabase.

**B-16. `user_presence` se čita u celosti (`select('user_id, last_seen_at')` bez filtera).**
✅ *Rešeno u 2.6.2.* `online()` sada poziva RPC `online_users()` (`WHERE last_seen_at > now() - interval '120 seconds'`
+ indeks), a liste koriste `presence_for_users(uuid[])` (`user_id = ANY(…)`) umesto celog skena. Bez migracije
postoji REST fallback sa `gte('last_seen_at', …)` i `in('user_id', …)` — nikad više „cela tabela“.
~~TTL se filtrira u JS-u…~~ (istorijski opis ostaje: TTL/away se i dalje računa iz `last_seen_at`, ali samo nad svežim redovima.)

**B-17. Bundle: `index` 751 kB (209 kB gzip), `RichTextEditor` 431 kB.**
`manualChunks` pokriva samo React i React Query; Tiptap, Framer Motion i sonner ulaze u glavni
`index` chunk uz editor. Nema preload/prefetch za rute na hover.
→ *Fix:* `manualChunks` za `@tiptap/*`, `framer-motion`, `@supabase/supabase-js`; editor samo
preko `lazy()` u adminu.

**B-18. `sitemap.xml` i `robots.txt` bez prerendera.**
SPA i dalje servira prazan `index.html` crawleru koji ne izvršava JS — meta tagovi postoje samo
posle hidratacije. README to priznaje, ali ostaje glavni SEO dug.
→ *Fix:* SSG/prerender (`vite-plugin-ssg` ili edge middleware) za `/`, `/article/:slug`,
`/thread/:id`.

### P3 — DX / konzistentnost

**B-19. Stari `README.md` (562 linije) je u više delova netačan.**
Konkretno: tvrdi da JWT živi u `localStorage` (§„Sigurnost“), navodi `server/schema.sql` putanju,
kaže da `/admin` guard radi sa `next=/admin` (ne radi, B-06/B-07), „Email TODO — fali SMTP“ iako
Resend/Brevo postoje, i ne pominje `schema-ALL.sql` kao jedan korak. Ovaj dokument ga zamenjuje.

**B-20. Datumi/„zastareli brojevi“ u komentarima koda.**
Npr. `index.ts` je svojevremeno govorio „zatim `schema-polls.sql`, … na kraju `schema-2.5.1.sql`“ —
dok su migracije imale drugi redosled. Sada postoji JEDAN fajl (`schema-ALL.sql`), pa nema dva izvora istine.

**B-21. `package.json` skripte se razlikuju od dokumentacije u starom README-u.**
Root `verify` = `lint && test && build`; backend `tsc` **nije** deo `verify`. CI koristi
`.github/workflows/ci.yml` — proveriti da li pokriva i backend `tsc` (u starom README-u tvrdi da da).

**B-22. Test prozor za `security254` traje ~1,3 s zbog bcrypt cost 12.**
Ukupno 2 s za 18 fajlova je dobro, ali bcrypt u testovima koristi produkcijski cost. Za brži CI:
`BCRYPT_COST=4` u `NODE_ENV=test` (već postoji promenljiva).

**B-23. Nema git istorije.**
`master` nema nijedan commit. Svaki „fix“ je nepovratan — nema `blame`, nema rollback-a.

**B-24. Ambijentalna „amber“ paleta u adminu i delovima UI-ja.**
`src/index.css` definiše `--color-accent-amber: var(--color-warning)` (#f59e0b), a admin panel ga
koristi na ~15 mesta (badge, HERO oznaka, pinned). Dizajn pravilo iz starog README-a kaže
„jedna primarna, jedna sekundarna, semantičke“ — amber se tako ponaša, ali admin ekran vizuelno
odstupa od violet/cyan identiteta. Odluka, ne bug.

**B-25. Mixed-language komentari i poruke.**
Kod komentari su srpski, ali deo poruka/UI stringova je mešan (`„Previše zahteva…“`, `Validation`).
Za i18n nije spremno (nema `i18n` sloja, svi stringovi hardkodovani u komponentama).

---

## 6. Šta je dodano, a NIJE kompletno završeno

| Oblast | Šta radi | Šta fali |
|---|---|---|
| **Sentry (2.4.4)** | ✅ **Završeno u 2.6.2** — SDK inicijalizovan, 5xx + fatalne greške u Sentry, `requestId` kao tag, bez body-ja/tokena | — (ostaje opciono; bez `SENTRY_DSN` inertno) |
| **Supabase Storage (2.6.2)** | ✅ Upload avatara, cover slika igara i proof slika deal-a; server ponovo kodira u WebP, briše stari avatar; `PATCH /api/games/:slug/cover` za staff i `GET /api/admin/media` | — (zahteva jednokratno pokretanje `schema-ALL.sql`; bez njega 503 + URL polja) |
| **Prisustvo (2.6.1 → 2.6.2)** | Heartbeat, REST fallback, Realtime broadcast, **`away`**, RPC `online_users()`/`presence_for_users()` | Demo okruženje i dalje traži `schema-ALL.sql`; bez njih memorija i „away“ samo na klijentu |
| **Ankete** | Glasovanje, procenti, jedan glas | Nema edit/close, nema dodavanja ankete posle objave teme, ankete su deo `schema-ALL.sql` |
| **Deals (2.6.0 → 2.6.2)** | CRUD, glasovi, filteri, Game Pages; **„Osveži iz prodavnice“** (OG/meta čitanje: naslov, `og:image` kao dokaz, cena kad je struktuirana) + `GET /api/deals/preview` (SSRF-safe: DNS provera, bez redirect-a, limit tela) | IGDB opciono; automatsko **periodično** povlačenje cena ne postoji (prodavnice nemaju zajednički API) — cene ostaju ručne, osvežavanje je po zahtevu; `data:image` samo dok Storage nije podešen |
| **Newsletter** | Double opt-in, potvrda, odjava; **segmenti** (potvrđeni / na čekanju / odjavljeni), **ponovna potvrda**, **CSV export po segmentu**, **kampanja po segmentu + test mejl**; svaki mejl ima svoj potpisani link za odjavu | Nema zakazivanja kampanja, A/B testa, otvaranja/klikova (tracking) ni brisanja pretplatnika; odjavljeni se namerno ne kontaktiraju |
| **Media / uploads** | Avatar, cover igre i članka, dokaz deal-a, **slike u Tiptap editoru** (upload umesto URL-a) preko Supabase Storage (WebP, bez EXIF-a) | Nema galerije/biblioteke medija ni sečenja slike u UI-ju (samo automatsko smanjivanje) |
| **Pretraga** | ✅ **Objedinjena pretraga (2.6.2)**: `/search` stranica + `GET /api/search` — članci, forum teme i deal-ovi, jedan rang. **Tri sloja**: (1) `pg_trgm` + `ILIKE` (delimične reči i greške u kucanju, `gin_trgm_ops`), (2) leksikalni — `fold_srpski()` (latinica + bez dijakritike + ćirilica→latinica) i deterministic `stem_srpski()` koren, `tsvector`/`tsquery` nad GIN indeksom, (3) „Da li ste mislili“ (`search_terms` + `search_suggest`, trigram po reči, samo kada nema pogodaka) | Nema pravog lingvističkog stemmera (`unaccent_srpski`/Snowball zavisi od verzije Postgresa — namerno izbegnut; koren je pravilo, ne rečnik); **pretraga odgovora u temama vraća temu, ne pojedinačan odgovor** (odgovori nisu indeksirani zasebno); rečnik „did you mean“ se puni ručno/cronom (`SELECT search_terms_refresh();`) |
| **Prerender/SEO** | Meta + sitemap + robots | Nema SSG/prerender za crawler bez JS-a (B-18) |
| **OAuth** | Discord, Google, Steam | Steam zahteva posebnu konfiguraciju i nema email (koristi se `@users.nexus.invalid`); nema vezivanja više naloga istog provajdera |
| **2FA** | TOTP + recovery + lockout | Nema „trusted device“, nema oporavka admina bez recovery kodova |
| **Moderacija** | Reporti, banovi, audit | Nema sistema upozorenja (warnings), nema „restore“ za soft-deleted sadržaj kroz admin UI (samo baza) |
| **Email notifikacije** | In-app + Realtime | Nema email digest / instant email notifikacija (Resend se koristi samo za verifikaciju, reset, newsletter) |
| **i18n** | Srpski (latinica), `sr-Latn-RS` datumi | Nema prevoda ni ekstrahovanih stringova |
| **Dark/Light mode** | Samo dark | Toggle ne postoji (komentari u starom README-u to priznaju) |
| **Testovi** | 146 unit testova (vitest) | **Nema integracionih HTTP testova** (supertest) ni UI testova u repo-u; Playwright nije zavisnost |

---

## 7. Predlozi — šta dodati sledeće (prioritetno)

1. **P0 popravke bugova:** B-01, B-02, B-04, B-05, plus B-06 i B-07 (lažni admin redirect) i B-03 (verifikacija povezanih naloga) — vidi §5.
2. **Git:** `git init`+ prvi commit (B-23) i `.gitignore` koji pokriva `.env`, `.data`, `dist`, `*.log`.
3. **Supabase Storage** za avatare i `proofUrl` deal-a (usput rešava B-09 i ograničenje `data:image`).
   ✅ *Urađeno u 2.6.2* — ostaje UI galerija i upload u Tiptap editoru.
4. **Full-text pretraga** na `pg_trgm` indeksima: `gin_trgm_ops` na `forum_threads.title/content`,
   `articles.title/excerpt`; izloži `GET /api/search?q=` i jedna search stranica.
5. **Pravi cursor pagination** za forum (B-10) i batch autori (B-11).
6. **Integracioni testovi** (supertest + `memory` store): auth cookie flow, CSRF 403,
   `requireVerified` 403, soft delete 404, per-user rate limit.
7. **Sentry** — instalirati pakete i povezati `captureException` u `errorHandler`.
   ✅ *Urađeno u 2.6.2* — ostaje upload source mapa (`SENTRY_AUTH_TOKEN` u CI).

### 7.1 Šta je završeno u 2.6.2 (pregled izmena)

| Oblast | Fajlovi |
|---|---|
| Sentry | `server/lib/sentry.ts`, `server/lib/http.ts`, `src/lib/sentry.tsx`, `src/main.tsx` |
| Storage | `server/lib/storage.ts`, `server/routes/uploads.ts`, `schema-ALL.sql`, `src/components/ui/ImageUpload.tsx`, `src/components/RichTextEditor.tsx`, `ProfileSections`, `DealForm`, `GamePage`, `AdminDashboard` |
| Prisustvo + away | `server/lib/presence.ts`, `schema-ALL.sql`, `src/store/presenceStore.ts`, `src/components/ui/OnlineAvatar.tsx` |
| Pretraga | `server/lib/search.ts`, `server/routes/search.ts`, `schema-ALL.sql`, `src/pages/SearchPage.tsx`, `Navbar` |
| Deal preview | `fetchOfferPreview`/`parseOfferHtml` u `server/lib/deals.ts`, `GET /api/deals/preview`, `DealForm` |
| Newsletter | `server/lib/newsletter.ts`, `routes/newsletter.ts`, `routes/admin.ts`, `lib/schemas.ts`, `sendNewsletterCampaign` u `lib/email.ts` |
| Testovi | `tests/storage`, `tests/sentry`, `tests/deals-offer`, `tests/search`, `tests/newsletter` + prošireni `tests/presence` |
8. **Email notifikacije** — opcija „prati temu mejlom“ (Resend), throttling 1 mejl / 15 min.
9. **Prerender** za SEO rute (B-18) + `og:image` generator.
10. **Bundle split** (B-17): `@tiptap`, `framer-motion`, `supabase-js` u zasebne chunk-ove.
11. **Observability:** `/api/health` proširiti (`db: 'supabase'|'memory'`, `presence: 'supabase'|'memory'`).
12. **i18n** sloj (bar struktura `sr` + `en`) pre nego što tekst uđe u još komponenti.
13. **Backup/restore** procedura za Supabase (PG dump) i `server/.data` (za memory režim).
14. **Warnings sistem** u moderaciji (korak pre bana) + “restore” dugme u adminu za soft delete.

---

## 8. Instalacija i pokretanje

### 8.1 Brzi start

```powershell
git clone <repo-url>
cd Forum
npm run setup          # root + server instalacije (dva lockfile-a!)

Copy-Item server/.env.example server/.env
Copy-Item .env.example .env.local

# server/.env: JWT_SECRET (>=32), SUPABASE_URL, SUPABASE_SERVICE_KEY
npm run check:env      # provera bez prikazivanja tajni
npm run start:local    # check:env + dev:clean (gasi 4000/5173/5174) + oba servera
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000` (`GET /api/health`)

### 8.2 Baza — jedan fajl

```text
Supabase → SQL Editor → Run:  server/schema-ALL.sql
```

`schema-ALL.sql` je **jedini SQL fajl** — sadrži sve tabele, RPC funkcije, trigere, RLS, bucket
politike i indekse, u ispravnom redu. Više nema pojedinačnih migracija ni generatora.

**Idempotentan je:** `IF NOT EXISTS` na tabelama/indeksima, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER
IF EXISTS` pre svakog trigera, `DROP CONSTRAINT IF EXISTS` pre `ADD CONSTRAINT` (ili `DO` gurad sa
`pg_constraint`). Zato ga je bezbedno pustiti i više puta.

```powershell
cd server; npm run schema:verify     # statička provera (bez baze)
```

> Skripta proverava: pozive funkcija pre njihove definicije (uzrok `42883 … during inlining`),
> indekse na funkciju definisanu kasnije i neidempotentne komande.
>
> **Pretraga u fajlu:** leksikalni sloj (`fold_srpski`, `stem_srpski`, `search_doc`, `search_terms`,
> `search_terms_refresh`, `search_suggest`, GIN indeksi) dolazi **pre** `search_snippet` i
> `search_articles/-threads/-deals`. Postgres za SQL funkcije proverava da li pozvana funkcija
> postoji **u trenutku `CREATE FUNCTION`**, pa obrnut redosled daje
> `42883: function fold_srpski(text) does not exist`. `schema:verify` to hvata pre puštanja.
>
> `unaccent` se **ne koristi** — `fold_srpski()` je čist `translate()` + `regexp_replace`, pa je
> `IMMUTABLE` (neophodno za izraz GIN indeksa) i daje isto što i JS `foldSrpski()`.
> Rečnik za „da li ste mislili“ puni `search_terms_refresh()` na kraju fajla; posle masovnog uvoza
> je ponovi (`SELECT search_terms_refresh();`) — trigeri ga namerno ne zovu, jer bi zaključavali tabelu.

> Ako preskočiš migraciju, aplikacija najčešće ne puca odmah nego degradira (tiha memorija ili
> 503). Vidi §6.

### 8.3 Environment (pregled)

**Backend `server/.env`** — obavezno: `JWT_SECRET` (≥32), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
Opciono: `CLIENT_URL` (lista domena), `TRUST_PROXY`, `PUBLIC_APP_URL`, `NEWSLETTER_SECRET`,
`RESEND_API_KEY`/`BREVO_API_KEY` + `EMAIL_FROM`, `DEV_EXPOSE_TOKENS`, limiti (`RATE_LIMIT_*`,
`THREAD_RATE_LIMIT`, `REPLY_RATE_LIMIT`, `DEAL_*_RATE_LIMIT`), `SEED_ADMIN_PASSWORD`,
OAuth/Turnstile/TOTP ključevi, `IGDB_*`, `SENTRY_DSN`, `LOG_LEVEL`/`LOG_FORMAT`.

**Frontend `.env.local`** — `VITE_API_URL`, `VITE_PUBLIC_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (samo javni ključ!), `VITE_SOCIAL_*`, `VITE_SENTRY_DSN`.

U produkciji server **ne startuje** bez Supabase-a, mejl provajdera i `CLIENT_URL`; polovična
OAuth/Turnstile/TOTP konfiguracija takođe ruši start (namerno).

---

## 9. Verifikacija (ono što je zaista pokrenuto za ovu analizu)

```powershell
npm test               # = npm --prefix server test  (vitest, 18 fajlova)
npm run lint           # = tsc --noEmit (frontend)
cd server; npx tsc --noEmit
npm run build          # tsc -b && vite build
```

| Provera | Rezultat |
|---|---|
| Vitest | **18 fajlova / 146 testova ✅** (uklj. `security254` 15, `deals` 31, `repos` 12, `env` 11) |
| `tsc --noEmit` frontend | ✅ 0 grešaka |
| `tsc --noEmit` backend | ✅ 0 grešaka |
| `vite build` | ✅ prolazi; upozorenje: `index` 751 kB / `RichTextEditor` 431 kB |
| E2E prisustvo (API) | ✅ 13/13: register → verify-email → login → CSRF cookie → heartbeat → `/api/presence` → profil `isOnline` → leaderboard `isOnline` → `/auth/me` → logout |
| Playwright E2E (UI) | ⚠️ **nije pokrenut** — Playwright nije zavisnost projekta; skripte `.qa/shoot.mjs` i `_presence-e2e.mjs` zahtevaju spoljni harness |

**Očekivana stanja u `_presence-e2e.mjs` (kada se pokrene):**

| Polje | Vrednost |
|---|---|
| `afterLogin.url` | `/` (B-06: `next` se ignoriše — ako je test očekivao `/admin`, to je bug, ne flaky test) |
| `heartbeat.status` | `200`, `body.isOnline === true` |
| `profile.ring` | `true` (klasa `.is-online` na `<img>` unutar `.profile-avatar-frame`) |
| `profile.title` | `"Online sada"` |
| `profile.pill` | `null` — klasa `.online-pill` **ne postoji** u kodu; status je u `title`/`aria-label` |

> Test je takođe imao pokvarenu prvu liniju (`i ur// E2E…` → `SyntaxError`); popravljena je u
> `_presence-e2e.mjs`. Selektori imena (`getByRole` iz Playwright test API-ja) zahtevaju
> `@playwright/test`; u čistom `playwright` paketu koristi `page.locator('button', { hasText: … })`.

### 9.1 QA checklist koji još treba proći u UI-ju
- [ ] Gost: `/`, `/forum`, `/deals`, `/games`, `/leaderboard`, `/terms`, `/privacy`, `/rules`, 404
- [ ] Prijava/pokvarena lozinka/2FA/turnstile reset posle greške (B-05)
- [ ] Registracija → mejl → `/verify?token=`
- [ ] Nova tema sa anketom → glas → drugi glas istog korisnika (odbijen)
- [ ] Objava deal-a bez IGDB ključa, glasanje, istek deal-a (status `expired`)
- [ ] `/admin` kao moderator i kao member (B-06/B-07), badge prijava (B-13)
- [ ] Mobilni 360 px: `MobileTabBar`, FAB (B-08)
- [ ] Sesija: refresh posle 15 min, logout-all na drugom uređaju, `npm run dev:clean` posle `EADDRINUSE`

---

## 10. Struktura projekta (stvarna)

```text
Forum/
├─ src/                        # SPA (React 19)
│  ├─ pages/                   # 30+ ruta (lazy u App.tsx)
│  ├─ components/
│  │  ├─ ui/                   # Button, Card, Badge, Tabs, Modal, Feedback, OnlineAvatar…
│  │  ├─ forum/                # PollWidget
│  │  ├─ deals/                # DealCard, DealForm, VoteButtons, dealUtils
│  │  ├─ profile/              # ProfileHeader, AccountSecurity, ConnectedAccounts, ProfileSections
│  │  └─ auth/                 # OAuthButtons, Turnstile, AuthShell
│  ├─ lib/                     # api.ts, realtime.ts, pageMeta.ts, sanitizeHtml.ts, badges.ts…
│  ├─ store/                   # authStore, presenceStore (Zustand)
│  ├─ App.tsx                  # rute + QueryClient
│  └─ index.css                # Tailwind v4 tema + UI kit
├─ server/
│  ├─ routes/                  # auth, oauth, articles, forum, polls, users, admin,
│  │                           # newsletter, notifications, reports, deals (+ games), categories
│  ├─ lib/                     # store, sessions, presence, gamification, deals, email,
│  │                           # actionTokens, totp, oauth, authConfig, sanitize, logger…
│  ├─ middleware/              # auth, turnstile, sanitize
│  ├─ tests/                   # vitest (18 fajlova)
│  ├─ schema*.sql              # 11 migracija + schema-ALL.sql (generisan)
│  └─ index.ts                 # bootstrap, limiti, CORS/CSRF, robots/sitemap, seed
├─ scripts/                    # dev.mjs, check-env, check-secrets, pack, security-headers
├─ public/                     # _headers (hosting), robots.txt, favicon
├─ .qa/                        # screenshot skripte i snimci ekrana
├─ _presence-e2e.mjs           # Playwright E2E za prisustvo (spoljni harness)
├─ _smoke.ps1, _smoke2.ps1, _start.ps1, _migrate_254.sql   # pomoćne skripte
└─ .github/workflows/ci.yml    # CI (lint, test, build)
```

**Pomoćne skripte u root-u:** `_smoke.ps1`, `_smoke2.ps1`, `_start.ps1`, `_migrate_254.sql`.
`_migrate_254.sql` je ostavina iz 2.5.4 — sadržaj je već u `schema-2.5.4.sql`; bezbedno je
obrisati ili premestiti u `server/archive/`.

---

## 11. Bezbednosni model (rezime)

| Sloj | Mera |
|---|---|
| Sesija | HttpOnly cookie (`nx_at`/`nx_rt`), rotacija refresh-a, detekcija ponovne upotrebe, `token_version` (`tv`) za globalnu odjavu |
| CSRF | Double-submit: `nx_csrf` + `X-CSRF-Token` na svim mutirajućim `/api` zahtevima; Bearer klijent bez cookie-ja prolazi |
| XSS | DOMPurify na klijentu, `xss`/`sanitize*` na serveru; CSP `script-src 'self'` (API dozvoljava `challenges.cloudflare.com`), `frame-ancestors 'none'` |
| Brute force | Rate limit po IP-u (auth 20/15 min), po emailu (10/15 min), po korisniku (teme/odgovori/deals), 2FA po tiketu (8/15 min); Turnstile opciono |
| Lozinke | min 8 znakova, lista čestih, bcrypt cost 12, rehash legacy naloga pri prijavi |
| Ban | `bans` tabela + `users.is_banned`; greška baze = 503 (nikad „istekao ban“) |
| SSRF | Deal linkovi: samo https, javni host, blokirane privatne/metadata adrese |
| Autorizacija | `authenticate` → `authorize('admin','moderator')` → `requireVerified`; javni oblici korisnika bez `email`/`isBanned` |
| Zavisnosti | `npm audit` nije deo `verify` — dodati po potrebi |

---

## 12. Licenca i doprinos

MIT (prema starom README-u). PR-ovi dobrodošli; za veće izmene prvo issue.

> **Pre PR-a:** `npm run verify` (lint + test + build) i `cd server && npx tsc --noEmit`.

---

**NEXUS 2.6.1 — stabilan, testiran i dokumentovan. Sledeća iteracija: bugovi P0 iz §5 i
Supabase Storage za medije.**
