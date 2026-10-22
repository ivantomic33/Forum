# 🎮 NEXUS GAMING PORTAL & FORUM

Napredni gejming portal visoke estetske vrednosti sa modernim **dark-mode cyber-gaming dizajnom**, **staklomorfnim (glass morphism) efektima**, **neonskim akcentima** i **3D gejmifikovanim elementima**.

---

## ✨ Karakteristike

### 🗞️ **Portal & Magazin**
- **Hero objave** sa naprednim pretraživanjem i kategorijama
- **Reakcije** (Like, GG, Hype, Fire, Mind Blown)
- **Bookmark sistem** za čuvanje članaka
- **Realan breaking-news ticker** (`GET /api/articles/ticker`)
- **Paginacija** — "Prikaži još vesti" učitava sledeću stranu, bez duplikata
- **Admin panel** za upravljanje sadržajem

### 💬 **Gejming Forum**
- **Subforumi**: PC Gaming, Consoles, Esports, Hardware, LFG, Off-Topic
- **Compact lista tema** sa glasovima, pin/lock indikatorima, rang bedžom i poslednjom aktivnošću
- **Karma sistem** (Upvote/Downvote) za svaku temu i odgovor
- **Nested replies** — multi-level komentarisanje
- **Interaktivne ankete** — `PollWidget` sa glasanjem, procentima i zaštitom od duplog glasa
- **Spoiler tags** — skrivanje spojlera
- **Forum Leaderboard** — rang-lista najaktivnijih članova
- **Mobilna donja navigacija** + FAB za novu temu (360px+)

### 🔗 **Povezivanje (2.4.4)**
- **Gaming nalozi i bedževi** se čitaju/pišu u `connected_accounts` i `user_badges` (kolone u `users` su keš)
- **Subforumi** dolaze iz `forum_categories`; broj tema/poruka računa `forum_category_stats()` u jednom upitu
- **Bedž katalog**: jedan izvor istine (`server/schema-ALL.sql` + `src/lib/badges.ts`) — `first_post`, `helpful`,
  `contributor`, `expert`, `influencer` (4 naloga), `veteran` (5.000 XP); `founder`/`legend` se dodeljuju ručno
- **Povezivanje naloga**: `connected_accounts.revoked_at` čuva istoriju — ponovno povezivanje ne daje XP ponovo
- **Soft delete**: obrisane teme i odgovori nestaju iz listi i vraćaju 404, ali ostaju u bazi (autor/moderator ih vide)
- **Sačuvani članci/teme** u `article_bookmarks` / `forum_bookmarks`; `GET /api/users/:username/saved`
- **Kvestovi** — `GET /api/users/:username/quests`, progres se ažurira u `awardXp()` (`advance_quest` RPC)
- **Karma autora** pri glasu preko `apply_user_karma` RPC-a (leaderboard tačan)
- **Bans** se upisuju u `bans` (razlog + rok); istekle banove ukidaju `authenticate` i `POST /api/auth/login`.
  Greška baze pri proveri bana vraća 503 — nikad se ne tumači kao „ban je istekao“.
- **Javni profil i rang-lista** ne vraćaju `email` ni `isBanned` (samo vlasnik vidi svoj email)
- **Limiti po korisniku**: 10 novih tema / 10 min i 30 odgovora / 10 min (ključ je `userId` iz tokena, ne samo IP)- **Sesije (2.5.2)**: JWT nosi `tv` (verzija sesije) koji se poredi sa `users.token_version`; logout, `POST /api/auth/logout-all`, promena i reset lozinke, kao i brisanje naloga poništavaju sve ranije tokene. Legacy tokeni bez `tv` važe dok se verzija prvi put ne poveća
- **Require verified (2.5.2)**: teme, odgovori, glasovi, komentari, reakcije i prijave zahtevaju potvrđen email (`requireVerified`; admin/moderator izuzeti)
- **Newsletter (2.5.2)**: pravi double opt-in — `subscribe` upisuje `is_active=false` (pending), a aktivacija ide kroz `/confirm` uz čuvanje vremena, IP adrese i user-agenta potvrde
- **Komentari članaka (2.5.2)**: čuvaju se u `article_comments` (Supabase), ne u memoriji procesa
- **Reakcije na članke (2.5.2)**: jedna reakcija po korisniku i tipu (`article_reactions` UNIQUE), atomično uvećanje preko `apply_article_reaction` RPC-a
- **Neobjavljeni članci (2.5.2)**: `GET /:idOrSlug`, `/saved` i `/bookmarks/mine` vraćaju samo `published` članke (osim za staff)
- **GDPR/ZZPL (2.5.2)**: `GET /api/users/me/export` (JSON izvoz) i `DELETE /api/users/me` (brisanje ličnih podataka + anonimizacija sadržaja + poništavanje sesija); akcije su u Profil → Podešavanja
- **SPA SEO (2.5.3)**: `usePageMeta` postavlja title/description/canonical/OG/Twitter/JSON-LD po ruti (`NewsArticle` na članku, `DiscussionForumPosting` na temi, `noindex` za obrisano); server servira `/robots.txt` i dinamički `/sitemap.xml` iz baze. Bez prerendera, crawler koji ne izvršava JS vidi samo statički `index.html`
- **Rate limiting po nalogu**: pored IP limita, login i `forgot-password` imaju i limit po email adresi (`RATE_LIMIT_ACCOUNT_MAX`, 10/15 min)
- **Frontend zaglavlja (2.5.4)**: CSP (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP i HSTS; postavlja ih `scripts/security-headers.mjs` na Vite dev/preview, a za hosting `public/_headers`. Helmet pokriva samo API
- **Saglasnost i uzrast (2.5.4)**: registracija beleži `terms_version`, `terms_accepted_at` i IP; zahteva eksplicitnu potvrdu 15+ godina (ZZPL)
- **Ankete (2.5.4)**: u Supabase režimu greška baze je **503**, nema tihog upisa u memoriju procesa
- **Fontovi (2.5.4)**: Inter / Inter Tight / JetBrains Mono se serviraju sa našeg domena (`@fontsource`), bez Google Fonts
- **Admin guard (2.5.5)**: `/admin` se ne renderuje ne-staff korisnicima — anonimni → `/login?next=/admin`, prijavljeni bez ovlašćenja → početna
- **Aktivnost profila (2.5.5)**: datumi bedževa i povezanih naloga dolaze iz `user_badges.awarded_at` / `connected_accounts.created_at`; događaj bez datuma se prikazuje bez izmišljenog `01.01.2026.`
- **Lokalizacija (2.5.5)**: datumi i vremena koriste `sr-Latn-RS` (latinica), dosledno ostatku sajta
- **Društvene mreže (2.5.5)**: ikonice u futeru se prikazuju samo za profile postavljene kroz `VITE_SOCIAL_*` — nema linkova ka početnim stranicama servisa
- **Blokade** u `user_blocks`; odgovori blokiranih korisnika se sakrivaju
- **Newsletter** šalje potvrdu preko Resend/Brevo (double opt-in)
- **Email** (Resend/Brevo) za verifikaciju, reset i newsletter; tokeni perzistentni u `auth_tokens`
- **Produkcija**: `VITE_API_URL`, `CLIENT_URL` (lista domena), `trust proxy`, opcioni Sentry

### 🔐 **Sigurnost i skaliranje (2.4.3)**
- **Moderacija**: prijava sadržaja (`POST /api/reports`), moderacioni red `/admin/reports`, banovi sa razlogom i rokom (`banReason`, `banDays`)
- **Notifikacije**: prave notifikacije na odgovor, @mention i upvote; `GET /api/notifications` + polling na 30s
- **Sopstveni sadržaj**: `PUT/DELETE /api/forum/threads/:id` i `/replies/:id` (soft delete, `edited` oznaka)
- **Blokiranje korisnika**: `POST /api/users/block`, `DELETE /api/users/block/:userId`, `GET /api/users/blocks/mine`
- **Članci**: bookmark i komentari na serveru (`/api/articles/:id/bookmark`, `/api/articles/:id/comments`)

### 🔐 **Sigurnost i skaliranje (2.4.1)**
- **Rate limiting po nameni**: 400/15 min za čitanje, 10/15 min za login/register, 60/min za `check-username`/`check-email`; `trust proxy` je podrazumevano isključen i uključuje se eksplicitno (`TRUST_PROXY=1` ili lista IP adresa) — inače se `X-Forwarded-For` ignoriše i limit se ne može zaobići lažnim zaglavljem
- **Zod validacija** na svim mutirajućim rutama (naslov 3–150, sadržaj ≤ 20.000, max 5 tagova, `https:` URL za avatar)
- **Sanitizacija razdvojena**: rich text (`img`/`span` dozvoljeni, samo https) i plain text (naslovi bez markupa)
- **Lozinke**: min 8 znakova, lista čestih lozinki, bcrypt cost 12 (+ rehash legacy naloga pri prijavi), verifikacija email-a i reset tokeni (SHA-256 hash, jednokratni)
- **Body limit 100 KB**, Pino structured logging sa `requestId`, generičke greške u produkciji
- **Newsletter**: double opt-in i odjava preko potpisanog tokena
- **Admin zaštita**: zabranjeno menjati sopstvenu rolu / degradirati drugog admina + `GET /api/admin/audit-log`

### 👤 **Gejmifikovani Profil**
- **3D Level & XP sistem** sa rang nazivima (Rookie → Grandmaster Vanguard)
- **Mreža Gejming Naloga**: Steam, Discord, Twitch, YouTube Gaming, Epic Games, Riot Games
- **Bedž i Quest sistem** sa holografskim postoljem
- **Karma rang-lista** i aktivnost tracking
- **Tabovi**: Forum teme, Odgovori, Sačuvano, Aktivnost

## 🔐 **Sigurnost**
- JWT autentifikacija — token se šalje kao `Authorization: Bearer` i trenutno se čuva u `localStorage`/`sessionStorage`
  (HttpOnly cookie **nije** u upotrebi; cookie fallback na serveru služi samo za buduću migraciju)
- Bcrypt hash lozinki
- XSS i SQL injection zaštita
- Rate limiting
- Helmet security headers
- CORS podešavanja

---

## 🛠️ Tehnološki Stack

### Frontend
- **React 19** + **TypeScript** (Vite build tool)
- **Tailwind CSS v4** — fluid design sa custom dark-mode paletom
- **React Router** — routing
- **Lucide React** — ikonice
- **Framer Motion** — animacije

### Backend
- **Node.js** + **Express**
- **TypeScript** sa ESM modulima
- **TSX** — TypeScript execution runtime
- **Bcrypt** — password hashing
- **JWT** — autentifikacija
- **Cookie Parser**, **Helmet**, **CORS**, **Compression**

### Baza Podataka
- **Supabase** (PostgreSQL)
- Kompletan šema fajl: `server/schema.sql`

---

## 📦 Instalacija

### 1. **Kloniraj repozitorijum**
```bash
git clone <repo-url>
cd Forum
```

Root lockfile (`package-lock.json`) pripada frontendu, a `server/package-lock.json`
backend-u. Čuvaj oba lockfile-a u git-u radi ponovljivih instalacija.

### 2. **Instaliraj frontend i backend zavisnosti**

Iz project root-a:

```powershell
npm run setup
```

Komanda instalira root i `server/` lockfile-ove odvojeno. Možeš i ručno da pokreneš
`npm ci` u root-u pa u `server/`.

### 3. **Konfiguriši bazu podataka (Supabase)**

1. Kreiraj novi Supabase projekat na [supabase.com](https://supabase.com)
2. U **Project Settings → API** preuzmi `Project URL` i `service_role` ključ
3. Izvrši šemu:
   - Otvori **SQL Editor** u Supabase dashboardu
   - Pokreni **jedan** fajl: `server/schema-ALL.sql` (sve tabele, RPC, trigeri, RLS, indeksi i Storage bucket).
     Idempotentan je — bezbedno ga je pustiti i ponovo. Provera bez baze: `cd server; npm run schema:verify`
   - `schema-2.5.3.sql` dodaje jedan glas po korisniku (parcijalni UNIQUE indeksi), RPC `cast_forum_vote` (atomičan upsert glasa + karma u transakciji), `sum_article_views`/`sum_thread_views` za metrike i indekse za paginaciju listi. **Bez nje**: glasanje radi preko fallback-a (uslovni upisi), a `/api/admin/stats` pada na agregaciju Vrednosti `views` kolone
   - Izvrši ih redom; migracije su napravljene za ponovljivo pokretanje
   - `schema-2.5.2.sql` dodaje `users.token_version`, kolone za double opt-in (`confirmed_at`, `confirmed_ip`, `confirmed_user_agent`), `article_comments` snapshot autora, F-21 dokaz saglasnosti (`terms_version`, `terms_accepted_at`, `terms_accepted_ip`) i `apply_article_reaction` RPC. **Bez nje**: odjava/reset ne poništavaju tokene, newsletter aktivacija prijavljuje 404 (pending red bez `confirmed_at` kolona pada), komentari i reakcije vraćaju 500
   - `schema-2.4.1.sql` koristi stvarni backend model (`category_id`, author lookup); nemoj dodavati duplirane `subforum`/`author_name` kolone
   - Migracija uključuje RLS bez browser policies; backend service-role ključ zaobilazi RLS

> `schema-2.4.1.sql` dodaje `badges`/`connected_accounts` kolone, normalizovane
> `username_lower`/`email_lower`, indekse za liste i SQL funkcije za atomične
> preglede/karmu. Bez njega aplikacija radi, ali se bedževi i povezani nalozi
> čuvaju u `server/.data/user-extras.json`, a pregledi se broje sa retry-em.
4. Pri prvom startu server automatski popunjava demo podatke (korisnici, članci, teme) —
   postojeći redovi se preskaču, pa je seed bezbedan za ponovno pokretanje.
   Demo admin nalog (`nexus_admin`) se pravi **samo** ako je postavljen `SEED_ADMIN_PASSWORD`;
   nema hardkodovane lozinke. `schema.sql` više ne ubacuje demo nalog.

### 4. **Konfiguriši environment**

Backend čita `server/.env` (ne root `.env`). Napravi fajl iz primera:

```powershell
Copy-Item server/.env.example server/.env
```

U `server/.env` zameni sledeće vrednosti:

- `JWT_SECRET` — obavezan, najmanje 32 karaktera, jedinstven random secret
- `SUPABASE_URL` — Project URL iz Supabase Project Settings → API
- `SUPABASE_SERVICE_KEY` — server-only `service_role` secret (**ne publishable/anon key**)

Opciono: `NEWSLETTER_SECRET` (odvojeni potpisni ključ), `TRUST_PROXY=1` (host iza jednog trusted proxy-ja).

Pre pokretanja proveri podešavanja bez prikazivanja tajni:

```powershell
npm run check:env
```

Ako server javlja `Data layer: in-memory demo`, Supabase vrednosti nedostaju/nevažeće su.
`JWT_SECRET` nedostajući ili kraći od 32 karaktera prekida server start — ne postoji fallback secret.

---

## 🚀 Pokretanje

### **Pokretanje oba servera odjednom** (preporučeno):

Environment konfigurisan u prethodnom koraku, startuj iz root-a:

```powershell
npm run start:local
```

`start:local` validira `server/.env`, očisti prethodne procese na portovima 4000/5173/5174,
pa pokrene oba servera.

### **Ako dobiješ `EADDRINUSE: address already in use :::4000`**

To znači da je prethodni `tsx watch`/Vite ostao u pozadini (na Windows-u deca procesa
prežive zatvaranje terminala). Umesto ručnog traženja PID-a:

```bash
npm run dev:clean
```

Skripta gasi sve procese na portovima **4000, 5173, 5174**, pa pokreće `dev:all`.
Port se može promeniti i kroz `PORT` u `server/.env`.

To će pokrenuti:
- **Frontend** (Vite dev server): `http://localhost:5173`
- **Backend** (Express API): `http://localhost:4000`

### **Pokretanje pojedinačno:**

#### Frontend:
```bash
npm run dev
```

#### Backend:
```bash
npm run server:dev
```

---

## 📋 Logovi (2.4.1)

U razvoju server ispisuje **jedan red po zahtevu**:

```
[10:24:31]  Data layer: Supabase (https://xxx.supabase.co)
[10:24:31]  NEXUS seed (supabase) — users: +0, articles: +0, threads: +0, ...
[10:24:31]  NEXUS API Server running on http://localhost:4000
[10:24:42]  GET     /api/forum/categories  200 147ms
[10:24:44]  POST    /api/auth/login        401  38ms
```

- `LOG_LEVEL=debug|info|warn|error` — nivo (default `debug` u razvoju).
- `LOG_FORMAT=json` — strukturirani JSON za produkciju/monitoring (Render loguje JSON kao tekst).
- Health check i Vite HMR zahtevi se ne loguju.
- Tokeni, cookie i lozinke su redigovani (`[redacted]`).

## 🎨 Dizajn Sistema

### **Paleta boja** (Dark Cyber-Gaming):

> **Pravilo:** jedna primarna, jedna sekundarna, i semantičke boje. Neon efekti se koriste za
> akcente (badge, ikonica, hover), nikad za telo teksta.

```css
/* Površine */
--color-surface-0: #06070b  /* Najdublji background */
--color-surface-1: #0a0c13  /* Card background */
--color-surface-2: #111420  /* Hover state */
--color-surface-3: #181d2e  /* Active element */
--color-surface-4: #222940  /* Elevated surface */

/* Primarna — Electric Violet */
--color-primary:       #8b5cf6
--color-primary-hover: #7c3aed
--color-primary-glow:  #a78bfa

/* Sekundarna — Cyan */
--color-secondary:      #06b6d4
--color-secondary-glow: #22d3ee

/* Semantičke */
--color-success: #10b981   /* uspeh, online, upvote */
--color-warning: #f59e0b   /* upozorenje, pin  */
--color-error:   #ef4444   /* greška, ban, downvote */
```

Legacy alias-i (`--color-neon`, `--color-cyan`, `--color-accent-green`...) zadržani su radi
kompatibilnosti i pokazuju na primarnu/sekundarnu/semantičku boju — nema treće "treće" boje.

### **Tipografija**:

| Uloga | Font | Gde |
|---|---|---|
| Display / naslovi | **Inter Tight** | `h1`–`h6`, `.font-display`, dugmad |
| Telo teksta | **Inter** | `body` |
| Metapodaci / kod | **JetBrains Mono** | karma, datumi, brojevi, `code` |

Fontovi se učitavaju u `index.html` (`display=swap`). Naslovi su automatski na display fontu
preko base layer pravila u `src/index.css`.

### **Čitljivost (WCAG)**:

- Minimalna veličina sadržaja: **12px** (util klase `text-[10px]`/`text-[11px]` su mapirane na 12px).
- Sekundarni tekst nikad ispod `white/60` (kontrast ≥ 4.5:1 na `#06070b`).
- `:focus-visible` outline je globalan; modal hvata fokus i vraća ga na trigger.
- `prefers-reduced-motion: reduce` isključuje animacije (ticker se pretvara u horizontalni scroll).

### **UI komponente** (`src/components/ui`):

```
Button      varijante: primary | secondary | ghost | danger, size: sm | md | lg
Card        default | static | elevated + interactive
Badge       primary | secondary | success | warning | error | neutral
Tabs        pills | underline (arrow-key navigacija, role="tablist")
Modal       focus trap, ESC, scroll lock, vraćanje fokusa
Feedback    Skeleton, SkeletonCard, SkeletonRows, ErrorState, EmptyState
```

Sve stranice koriste ove primitive; `cyber-card`, `btn-primary` i `glass` klase ostaju kao
legacy aliasi, novo se ne piše njima.

### **Fluid Sizing** (clamp):
```css
--font-size-xs: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
--font-size-sm: clamp(0.875rem, 0.825rem + 0.25vw, 1rem);
--font-size-base: clamp(1rem, 0.95rem + 0.25vw, 1.125rem);
--font-size-lg: clamp(1.125rem, 1.05rem + 0.375vw, 1.25rem);
--font-size-xl: clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem);
--font-size-2xl: clamp(1.5rem, 1.35rem + 0.75vw, 2rem);
--font-size-3xl: clamp(2rem, 1.75rem + 1.25vw, 3rem);
--font-size-4xl: clamp(2.5rem, 2rem + 2.5vw, 4rem);
```

---

## 📂 Struktura Projekta

```
Forum/
├── src/                       # Frontend (React)
│   ├── components/
│   │   ├── ui/                # Button, Card, Badge, Tabs, Modal, Skeleton, Empty/ErrorState
│   │   ├── forum/             # PollWidget, forum-specific komponente
│   │   ├── profile/           # ProfileHeader, ConnectedAccounts, Badges, Settings
│   │   ├── Navbar.tsx         # Desktop navigacija + mobilni meni
│   │   ├── MobileTabBar.tsx   # Donja tab traka (< lg) + FAB "Nova tema"
│   │   ├── NotificationBell.tsx
│   │   └── Layout.tsx, Footer.tsx, motion.tsx, RichTextEditor.tsx
│   ├── pages/              # React Router stranice (lazy-loaded u App.tsx)
│   ├── lib/                    # api.ts (typed fetch klijent), sanitizeHtml
│   ├── store/                  # Zustand (authStore)
│   ├── index.css                 # Tailwind teme + UI kit stilovi
│   ├── App.tsx                   # Rute + React.lazy + Toaster
│   └── main.tsx                  # React entry point
│
├── server/           # Backend (Node + Express)
│   ├── routes/
│   │   ├── auth.ts             # /api/auth
│   │   ├── articles.ts         # /api/articles (+ /ticker, paginacija)
│   │   ├── forum.ts            # /api/forum (threads, replies, vote)
│   │   ├── polls.ts            # /api/forum/threads/:id/poll/vote
│   │   └── users.ts, admin.ts, newsletter.ts
│   ├── lib/
│   │   ├── store.ts           # Data layer (Supabase ↔ in-memory)
│   │   ├── seed.ts            # Idempotentni demo podaci
│   │   └── pollsSupabase.ts   # Ankete u Supabase-u
│   ├── schema.sql             # Glavna šema (pokreni u SQL Editor-u)
│   ├── schema-polls.sql       # Tabele za ankete
│   └── index.ts               # Express server entry
│
├── public/                       # Statički fajlovi
├── package.json                # Root dependencies
├── vite.config.ts             # Vite konfiguracija
├── tailwind.config.ts       # Tailwind setup
├── tsconfig.json
└── README.md
```

---

## 🔌 API Endpoints

### **Produkcija: front ↔ API**

- Razvoj: Vite proxy `/api` → `http://localhost:4000`.
- Produkcija: postavi `VITE_API_URL` (npr. `https://api.nexus.rs`) **ili** reverse proxy koji
  servira `/api` sa istog domena. Za CORS postavi `CLIENT_URL` (comma-separated lista).
- Iza proxy-ja: `TRUST_PROXY=1` da rate limiti vide pravu IP adresu.
- SEO: `PUBLIC_APP_URL` (preporučeno) ili prvi domen iz `CLIENT_URL` koristi se za canonical, OG slike i linkove u mejlovima; `VITE_PUBLIC_URL` za frontend.

### **Autentifikacija** (`/api/auth`)
- `POST /api/auth/register` — Registracija korisnika
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout (poništava token; `tv` se povećava na serveru)
- `POST /api/auth/logout-all` — Odjava sa svih ostalih uređaja (vraća svež token za trenutni)
- `GET /api/auth/me` — Trenutni korisnik (zahteva JWT)

### **Portal/Vesti** (`/api/articles`)
- `GET /api/articles?limit=&offset=&category=&search=&featured=` — lista sa paginacijom (`total`, `hasMore`)
- `GET /api/articles/ticker` — naslovi za breaking-news traku (iz stvarnih članaka + tema)
- `GET /api/articles/:slug` — pojedinačni članak
- `POST /api/articles` — Kreiraj članak (admin/moderator)
- `PUT /api/articles/:id` — Ažuriraj članak (admin/moderator)
- `DELETE /api/articles/:id` — Obriši članak (admin)
- `POST /api/articles/:id/reactions` — Reakcija (like/gg/hype/fire/mind_blown)
- `POST/DELETE /api/articles/:id/bookmark` — Sačuvaj/ukloni članak
- `GET /api/articles/bookmarks/mine` — Sačuvani članci ulogovanog korisnika
- `GET/POST /api/articles/:id/comments` — Komentari članka (nested, sanitizovani)

### **Forum** (`/api/forum`)
- `GET /api/forum/categories` — Lista subforuma sa statistikom
- `GET /api/forum/:subforum/threads?sort=hot|new|top&search=&limit=&cursor=` — liste tema (`all` za sve), cursor paginacija
- `GET /api/forum/threads/:id` — tema + odgovori + `poll`
- `POST /api/forum/:subforum/threads` — Kreiraj temu (opciono `poll: { question, options }`)
- `POST /api/forum/threads/:id/comments` — Odgovori (nested preko `parentId`)
- `POST /api/forum/threads/:id/vote` — Glasaj (up/down/null)
- `POST /api/forum/threads/:id/poll/vote` — Glas u anketi `{ optionIndex }` (1 glas/korisnik)
- `POST/DELETE /api/forum/threads/:id/bookmark` — Sačuvaj/ukloni temu
- `GET/POST/DELETE /api/forum/threads/:id/follow` — Prati temu (notifikacije o novim odgovorima)
- `PATCH /api/forum/threads/:id/moderate` — Pin/lock/delete (mod/admin)
- `PUT /api/forum/threads/:id` — Izmena sopstvene teme (ili mod/admin)
- `DELETE /api/forum/threads/:id` — Soft delete sopstvene teme
- `PUT /api/forum/replies/:id` — Izmena sopstvenog odgovora
- `DELETE /api/forum/replies/:id` — Soft delete sopstvenog odgovora

### **Notifikacije** (`/api/notifications`)
- `GET /api/notifications?unreadOnly=&limit=` — lista + `unreadCount`
- `GET /api/notifications/unread-count` — lagani brojač za zvonce
- `PATCH /api/notifications/read` — označi sve (ili `{ notificationIds }`) kao pročitano
- `DELETE /api/notifications/:id` — obriši sopstvenu notifikaciju

### **Prijave sadržaja** (`/api/reports`)
- `POST /api/reports` — `{ targetType, targetId, reason }` (član, ne moderator)
- `GET /api/reports?status=` — moderacioni red (mod/admin)
- `PATCH /api/reports/:id` — `{ status: 'resolved' | 'dismissed', resolutionNote? }` (mod/admin)

### **Prisustvo — „Online sada“ (2.6.1)**
- `POST /api/auth/heartbeat` — otkucaj prijavljenog korisnika (SPA zove na mount, pri povratku u tab i na 25s dok je tab vidljiv). Bez otkucaja 90s → offline
- `GET /api/presence` — `{ online: string[] }` (početno stanje / fallback kada WebSocket nije dostupan)
- `GET /api/users/:username`, `/api/users/leaderboard/top`, `/api/forum/.../threads`, `/api/forum/threads/:id` vraćaju `isOnline` / `authorOnline`
- Server objavljuje promene preko Supabase Realtime Broadcast kanala `presence:global` (događaji `presence` i `notification`), a `users.status` je keš za liste
- Šema: `server/schema-ALL.sql` (`user_presence` + RLS deny-by-default). Bez nje prisustvo živi u memoriji procesa
- Frontend: `src/lib/realtime.ts` (javni anon ključ), `src/store/presenceStore.ts` (kanal + heartbeat), `OnlineAvatar` (`src/components/ui/OnlineAvatar.tsx`) — zeleni prsten (`--color-success`) na navbaru, profilu, forum temi i rang-listi
- Konfiguracija: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` u root `.env.local`. Service-role ključ ostaje samo na serveru

### **Ankete** — Supabase tabele

Za trajno čuvanje anketa u Supabase-u pokreni još i `server/schema-polls.sql`
(`forum_polls`, `forum_poll_votes`). Bez njih anketa radi, ali se čuva u memoriji procesa.

### **Verifikacija i reset** (`/api/auth`)
- `POST /api/auth/verify-email` — `{ token }` → postavlja `is_verified`
- `GET /api/auth/verify-email/:token` — provera da li je link još važeći (pre klika)
- `POST /api/auth/forgot-password` — uvek isti odgovor (bez enumeracije naloga)
- `POST /api/auth/reset-password` — `{ token, password }`

Frontend rute za linkove iz mejla: `/forgot-password`, `/reset?token=`, `/verify?token=`, `/newsletter/confirm?token=`.

### **Newsletter** (`/api/newsletter`)
- `POST /api/newsletter/subscribe` — double opt-in
- `GET /api/newsletter/confirm?token=...` — potvrda pretplate
- `POST /api/newsletter/unsubscribe` — `{ token }` (potpisan link)

### **Admin** (`/api/admin`)
- `GET /api/admin/stats` — metrike
- `GET /api/admin/audit-log` — ko je menjao role/banove

### **Korisnici** (`/api/users`)
- `GET /api/users/:username` — Korisnički profil
- `GET /api/users/:username/threads?limit=` — Teme korisnika
- `GET /api/users/:username/replies?limit=` — Odgovori korisnika (po author_id)
- `GET /api/users/:username/activity` — Nedavna aktivnost
- `GET /api/users/leaderboard/top?limit=50&sort=karma|level` — rang lista (javni podaci, bez emaila)
- `PUT /api/users/profile` — Ažuriraj sopstveni profil
- `POST /api/users/accounts/connect` — Poveži gaming nalog
- `DELETE /api/users/accounts/:platform` — Ukloni gaming nalog
- `PATCH /api/users/:id/role` — Admin: promena role/ban (`banReason` obavezan uz `isBanned: true`, opciono `banDays`; upis u `bans`)
- `POST /api/users/block` — Blokiraj korisnika `{ userId }`
- `DELETE /api/users/block/:userId` — Odblokiraj korisnika
- `GET /api/users/blocks/mine` — Lista blokiranih korisnika
- `GET /api/users/:username/saved` — Sačuvani članci i teme (samo vlasnik)
- `GET /api/users/:username/quests` — Kvestovi sa progresom (vlasnik ili mod/admin)
- `GET /api/users/me/export` — Izvoz svih ličnih podataka (JSON; bez hasha lozinke)
- `DELETE /api/users/me` — Brisanje naloga: lični podaci se uklanjaju, sadržaj se anonimizuje, sesije prestaju da važe

---

### **Email i skladište**
- `RESEND_API_KEY` ili `BREVO_API_KEY` + `EMAIL_FROM` — verifikacija, reset, newsletter.
  U produkciji server **ne startuje** bez ključa (provere pri startu: `assertProductionConfig`) — nema tihe greške pri slanju.
- `DEV_EXPOSE_TOKENS=1` — samo uz `NODE_ENV=development`: vraća `verificationToken`/`resetToken`/`confirmToken` u API odgovoru i ispisuje dev linkove u log. U svim drugim režimima tokeni ostaju samo u mejlu.
- `SENTRY_DSN` (server) i `VITE_SENTRY_DSN` (front) — opciono; zahteva `@sentry/node` / `@sentry/react`.
- Supabase Storage bucket za avatare/slike **nije** povezan u 2.4.4 (ostaje za sledeću iteraciju).

## 🎯 Smernice za Dalje Razvijanje

### **Frontend TODO:**
- [x] Real-time notifikacije + prisustvo (Supabase Realtime Broadcast, 2.6.1) — zvonce se osveži odmah; polling na 30s ostaje kao rezerva
- [x] „Online sada“ — zeleni prsten na avatarima (`OnlineAvatar`), heartbeat + TTL 90s
- [ ] Dark/Light mode toggle (`color-scheme` promenljive su već u `@theme`)
- [ ] File upload za avatare i cover slike (Supabase Storage)
- [ ] Search API sa full-text pretraživanjem (PostgreSQL `pg_trgm`)

### **Backend TODO:**
- [ ] Email notifikacije (Newsletter + verifikacija/reset) preko provajdera — tokeni su spremni, fali SMTP
- [ ] Pokrenuti `server/schema-ALL.sql` u Supabase SQL Editor-u (RLS je deny-by-default; server koristi service key)
- [ ] Perzistentno skladište za dnevni XP budžet (trenutno u memoriji procesa)

### **Database TODO:**
- [ ] Kreirati stored procedure za automatsko povećanje XP-a
- [ ] Dodati trigger za quest completion detection
- [ ] Implementirati moderaciju sistem (bans, warnings)

---

## 🧪 Testing

```powershell
npm run build      # Vite build (frontend)
npm run lint       # ESLint
npm test           # Vitest — validacija, XP logika i regresije (server/tests)
npm run verify     # lint + test + build
npm run check:secrets  # provera da u gitu nema .env/logova/tajni
npm run pack:source    # čista zip arhiva iz `git archive`-a (bez .env, logova, node_modules, dist, .data)
```

> Za deljenje koda **nikad** ne pakuj radni folder u zip — koristi `npm run pack:source`.
> Radni folder sadrži `.env`, logove i `server/.data` sa lokalnim podacima.

CI (`.github/workflows/ci.yml`) pokreće `lint`, backend `tsc`, testove i build na svaki push/PR.

### **Testni korisnik (opciono, samo lokalno):**
- **Username**: `nexus_admin`
- **Email**: `admin@nexusgaming.com`
- **Password**: postavlja se kroz `SEED_ADMIN_PASSWORD` u `server/.env` — nema univerzalne demo lozinke, a bez te promenljive nalog se ne kreira
- **Role**: Administrator

---

## 📄 Licenca

MIT License — možete slobodno koristiti, modifikovati i distribuirati ovaj projekat.

---

## 🤝 Doprinos

Pull requestovi su dobrodošli! Za veće izmene, molimo prvo otvorite issue da diskutujemo šta biste želeli da promenite.

---

## 📧 Kontakt

Za pitanja ili podršku, kontaktirajte: **admin@nexusgaming.com**

---

**🎮 Dobrodošli u NEXUS — Where Gamers Unite! 🚀**


## Backend API rute (stvarne putanje)

- Kreiranje teme: `POST /api/forum/:subforum/threads`
- Odgovor na temu: `POST /api/forum/threads/:threadId/comments`
- Lista tema: `GET /api/forum/:subforum/threads?sort=hot|new|top`
- Tema sa odgovorima: `GET /api/forum/threads/:id`

Ne postoji `POST /api/forum/threads/:id/reply`; klienți treba da koriste `/comments` rutu iznad.
