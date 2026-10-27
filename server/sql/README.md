# server/sql — migracije za živu bazu

Jedan fajl po verziji, **u redosledu puštanja**. Svaki je idempotentan
(`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` pre `ADD`), pa se može
pustiti više puta i posle `schema-ALL.sql`.

> Za novi projekat i dalje važi **jedan fajl**: `server/schema-ALL.sql`
> (Supabase → SQL Editor → Run). Ovaj folder postoji za slučaj „baza već radi,
> treba mi samo novi deo“ i za istoriju promena.

| # | Fajl | Šta uvodi |
|---|---|---|
| 00 | `00-00-header.sql` | `uuid-ossp`, `pg_trgm`, `pgcrypto` |
| 01 | `01-core.sql` | Korisnici, članci, forum, notifikacije, audit, reporti, banovi |
| 02 | `02-2.4.1.sql` | Bezbednost/praćenje, ankete, audit log |
| 03 | `03-2.4.3.sql` | Email verifikacija, reporti, banovi, blokiranja, `thread_subscriptions` |
| 04 | `04-2.4.4.sql` | Sesije, OAuth nalozi, sesijske tabele |
| 05 | `05-2.5.1.sql` | Kategorije, statistika, RLS |
| 06 | `06-2.5.2.sql` | Newsletter double opt-in |
| 07 | `07-2.5.3.sql` | Profilna proširenja |
| 08 | `08-2.5.4.sql` | `auth_sessions`, `oauth_accounts` |
| 09 | `09-polls.sql` | Ankete |
| 10 | `10-2.6.0-deals.sql` | `games`, `deals`, `deal_votes` |
| 11 | `11-2.6.1-presence.sql` | `user_presence` |
| 12 | `12-2.6.2-presence-away.sql` | `away`, `online_users()` |
| 13 | `13-2.6.2-storage.sql` | Storage bucket `media` |
| 14 | `14-2.6.2-search-lexicon.sql` | `fold_srpski`, `stem_srpski`, `search_terms` |
| 15 | `15-2.6.2-search.sql` | `search_articles/-threads/-deals` |
| 16 | `16-2.6.2-search-lang.sql` | Jezik pretrage (no-op za starije verzije) |
| 17 | `17-2.6.4-sharing.sql` | `xp_budget`, `spend_daily_xp`, `totp_pending` |
| 18 | `18-2.6.5-rpc-fixes.sql` | Popravke RPC-ova/indeksa |
| 19 | `19-2.6.6-search-replies.sql` | Pretraga pojedinačnih odgovora |
| 20 | `20-2.6.6-deal-topic.sql` | F-3: `forum_threads.deal_id` + FK |
| **21** | **`21-2.7.0-retention.sql`** | **F-1…F-14: `deal_claims`, `deal_watches`, `game_collections*`, `user_warnings`, `user_daily_activity`, `push_subscriptions`, `pc_*`, `trusted_devices`, `thread_subscriptions.email_on_reply`** |
| **22** | **`22-2.7.2-email-notifikacije.sql`** | **`site_meta`, prošireno `notifications.type` CHECK (`warning`, `streak`, `level_up`, `price_alert`), soft-delete tragovi `deleted_at`/`deleted_by`** |
| **23** | **`23-2.7.2-verify.sql`** | **Ni ne menja šemu — ispisuje ✓/✗ za svaku tabelu i kolonu iz 21/22 i broj redova (provera posle puštanja)** |
| **24** | **`24-2.8.0-guides.sql`** | **2.8.0 — `game_guides` (community vodiči po igri), `guide_votes`, RPC `cast_guide_vote`** |
| **29** | **`29-6.0.0-xp-progression.sql`** | **XP/nivo: `xp_for_level`, `level_from_xp`, trigger `trg_users_level_from_xp` (nivo se izvodi iz XP-a), backfill starih redova, RPC `bump_user_xp` (admin korekcija mimo dnevnog limita)** |

## Kako se pušta

```powershell
# 1) provera šta baza već ima (bez otkrivanja tajni)
npm run check:db

# 2) u Supabase → SQL Editor: otvori fajl po fajl, redom (21 → 22 → 24)
#    ili jednokratno ceo server/schema-ALL.sql — sadrži iste sekcije
#    23 ne menja ništa: ispisuje ✓/✗ po tabeli i koloni (provera posle puštanja)
```

`29-…` je obavezan ako admin XP bonus (ili stari podaci) ne menja nivo: bez
njega nivo se izvodi samo u aplikaciji, a `users.level` u bazi može da zaostane.

`22-…` je obavezan za sve baze koje su puštene pre 2.7.2: bez `site_meta`
digest/throttle red zakazanih kampanja padaju na memoriju procesa, a bez
proširenog CHECK-a notifikacije `warning`/`streak`/`level_up`/`price_alert`
se ne upisuju.

## Gde se ovo proverava

- `npm run check:db` → tabele, kolone i broj redova; `exit 1` ako nešto fali.
- `cd server; npm run schema:verify` → statička provera `schema-ALL.sql`
  (funkcija pre definicije, neidempotentne komande).
- `npm test` → testovi nad istim repozitorijumima.

## Napomena o izvoru

Fajlovi `00`–`20` su generisani iz `schema-ALL.sql` skriptom
`node server/scripts/split-schema.mjs`. Novi (`21`, `22`, `24`) su ručno napisani i
**sadržaj je 1:1 sa odgovarajućim sekcijama u `schema-ALL.sql`** — kad menjaš
šemu, menjaš oba mesta (ili ponovo pokreneš `split-schema` i vratiš ručne fajlove).

⚠️ **Upozorenje:** `split-schema.mjs` briše CELO folder `server/sql/` i piše samo
`.sql` fajlove — pokretanje skripte briše `README.md` i ručne migracije koje nisu
u `schema-ALL.sql` pod vlastitim markerom `-- SEKCIJA:`. Posle pokretanja skripte
proveri `git status server/sql` i vrati ručne fajlove iz git-a.
