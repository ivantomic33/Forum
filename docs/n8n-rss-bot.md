# n8n → NEXUS: uvoz vesti iz RSS-a

Kratko uputstvo kako da RSS bot iz n8n-a objavljuje vesti na portal.

**Tvoj feed:** `https://dexter1221.app.n8n.cloud/webhook/gaming-news-rss`
(30 stavki, vesti na srpskom, 35-minutni interval — provereno radi).

Dve opcije, ista ruta na serveru:

| | Kad koristiti |
|---|---|
| **A. Skripta** `npm run ingest:news` (preporučeno) | Feed vraća 30 vesti; skripta ih mapira, očisti i pošalje. Ponovno pokretanje je bezbedno (duplikati se preskaču). |
| **B. n8n HTTP Request node** | Ako želiš da n8n sam šalje po jednu vest kad se pojavi. Donji deo dokumenta. |

---

## 0. Opcija A — skripta iz repoa

```powershell
npm run ingest:news:dry   # samo prikaži šta bi poslalo
npm run ingest:news       # pošalji na API
```

- Čita `RSS_FEED_URL` (podrazumevano tvoj feed), `API_URL` (default `http://localhost:4000`)
  i `ARTICLES_INGEST_API_KEY` iz `server/.env`.
- Skida prefiks `[Polygon]` iz naslova (izvor ide u `authorName`), dekodira entitete,
  uzima naslovnu sliku iz `enclosure`/`media:thumbnail`/prvog `<img>`,
  mapira kategoriju (Hardver/Esports/Recenzije/Vodići/Film i TV/Vesti),
  seče tagove na 24 karaktera i skraćuje naslove na 150.
- **Preskače** `Guides` i `Reviews` (`RSS_EXCLUDE_CATEGORIES`).
- Deduplikaciju ipak radi server — drugi prolaz vraća `duplikat`.
- Za Cron / Task Scheduler (svakih 30 min):

  ```powershell
  schtasks /create /tn "NEXUS vests" /tr "cmd /c cd /d C:\Users\Tomicc\Desktop\Forum && npm run ingest:news" /sc minute /mo 30
  ```

> Napomena: feed ima **`pubDate` u srednje-evropskom vremenu** (CET/CEST). Skripta po
> podrazumevanju skida 60 min; u letnjem vremenu dodaj `--feed-offset=120`.

### Pun tekst i bolje slike

Feed n8n-a nema `content:encoded` — opis je 1–2 rečenice. Zato skripta otvara
originalnu stranicu i uzima:

| Šta | Kako |
|---|---|
| **Pun tekst** | prvih 8 pasusa članka (bez reklama, komentara, „related“) — `--paragraphs=N` |
| **Bolja slika** | `og:image` sa stranice (1600px) umesto 640–800px iz feeda |
| **Tačan datum** | `datePublished` sa stranice → `publishedAt` u API-ju |

Rezultat: ~700 znakova → **1.200–8.000 znakova po vesti**, sve 29 vesti sa slikom.

- `--no-scrape` — isključi otvaranje stranica (brzo, ali ostaje samo kratak opis iz feeda).
- `--delay=400` — pauza između zahteva ka istom sajtu (protiv 403/429).
- Sajt koji blokira botove (403) ne obara uvoz — vest ide sa opisom iz feeda.
- Tekst je **prevedeni sažetak sa izvora**, ne prepisivanje — svaki članak završava
  linkom „Pročitaj ceo tekst na <izvor>“.

---

## 0.b — Šta je novo u 2.13.0

| Funkcija | Kako se uključuje |
|---|---|
| **Kategorije iz sadržaja** (Konzole, Hardver, Biznis, Esports, Film i TV, Mobilno…) | automatski — pravila u `mapCategory` |
| **Srpski tagovi** (`News`→`Vesti`, `Hardware`→`Hardver` + brend iz naslova) | automatski |
| **Grupa događaja** (`eventId`) + stranica `/event/:id` | automatski (`detectEvent`) |
| **Hot vest → forum tema** | automatski (`NEWS_FORUM_DISCUSSION=0` gasi) |
| **Slika u naš Storage** (nema hotlinka) | automatski (`NEWS_MIRROR_IMAGES=0` gasi) |
| **Inkrementalni uvoz** | automatski posle prvog uspešnog prolaza (`.rss-state.json`) |
| **Retry/backoff** za feed i API | automatski |
| **Izveštaj po izvoru** u terminalu | automatski |
| **Admin**: `GET /api/admin/news/sources`, `GET /api/admin/news/digest` | samo admin/moderator |

### Migracija (obavezno za dedupe/event/grupe)

Supabase → **SQL Editor** → nalepi i pokreni:

```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS news_source VARCHAR(80);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS event_id VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_url
  ON articles (source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_event
  ON articles (event_id, published_at DESC) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_articles_news_source
  ON articles (news_source, created_at DESC) WHERE news_source IS NOT NULL;
NOTIFY pgrst, 'reload schema';
```

(isto je u `server/schema-2.13.0-news-sources.sql`). **Bez migracije sve radi** —
server upisuje bez tih kolona, a dedupe tada čita link iz tela članka.

### Dnevni cron (samo nove vesti)

```powershell
schtasks /create /tn "NEXUS vests" /tr "cmd /c cd /d C:\Users\Tomicc\Desktop\Forum && npm run ingest:news" /sc minute /mo 30
```

Svaki sledeći prolaz šalje samo vesti objavljene posle prošlog uvoza (minus 10 min).
Ručno: `npm run ingest:news -- --full` (sve ponovo, dedupe odbija duplikate),
`--since=6h`, `--no-scrape`, `--paragraphs=14`.

---

## 0.a — Automatski uvoz (cron) — 2.13.6

Bez ovoga vesti ulaze **samo kad neko pokrene skriptu**. Dve opcije, ista skripta:

### A. GitHub Actions (preporučeno za produkciju)

`.github/workflows/news-ingest.yml` — pokreće se **svakih 30 minuta**, i kad je
računar ugašen. Besplatno za javne repozitorijume.

Podešavanje (jednom): GitHub → **Settings → Secrets and variables → Actions**:

| Secret | Vrednost |
|---|---|
| `API_URL` | `https://<tvoj-api-domen>` (bez završne kose crte) |
| `ARTICLES_INGEST_API_KEY` | isti ključ kao u `server/.env` |
| `RSS_FEED_URL` | (opciono) |
| `GEMINI_API_KEY` | (opciono) za AI prevod |

Ručno pokretanje: **Actions → „News ingest“ → Run workflow** (može `--full` i `--dry-run`).
Dva pokretanja nikad ne idu paralelno (`concurrency`), da se AI kvota ne troši dvaput.

### B. Windows Task Scheduler (dok razvijaš lokalno)

```powershell
npm run news:cron:setup      # registruj, svakih 30 min (API mora da radi!)
.\scripts\setup-cron.ps1 -Test      # pokreni odmah, bez registracije
.\scripts\setup-cron.ps1 -Interval 15
npm run news:cron:remove     # obriši zadatak
```

Log: `logs/news-ingest.log`. Ograničenje: radi **samo dok je računar uključen**
(Windows nadoknađuje propušteni termin po buđenju).

> **Zaštita u skripti (2.13.6):** pre skrejpovanja skripta proveri `GET /api/health`.
> Ako API nije dostupan — prekida odmah sa jasnom porukom i exit kodom 1,
> umesto da potroši 30 skrejpova i plaćeni AI prevod, pa padne na svakom POST-u.

---

## 0.c — Šta nedostaje za „punjeni“ RSS bot (2.13.1)

### ✅ Rešeno automatski

| Problem | Rešenje |
|---|---|
| Nekim vestima nedostaje slika | ekstrakcija iz `og:image` → `enclosure` → prvog `<img>` u telu; mirror u Storage |
| Telo je engleski, portal je srpski | `buildBilingualBody()` — srpski sažetak gore, original u označenom bloku |
| Nekim vestima nedostaje telo | trokorak ekstrakcija: JSON-LD `articleBody` → `<p>` van boilerplate-a → div-blokovi |
| Nepoznata kategorija | pravila u `news-rules.mjs`; igra pobeđuje platformu (`Pokemon Unite` ≠ Konzole) |
| Nema uvida u kvalitet | izveštaj posle uvoza + `qualityFlags` u `.rss-state.json` |

### ✅ Tačke 4, 5, 6 (2.13.2)

| Tačka | Gde | Šta radi |
|---|---|---|
| **4. Izvori u adminu** | `AdminNewsSources.tsx` + `GET /api/admin/news/sources` | trake po izvoru (ukupno i +N/7d), tagovi po kategoriji, poslednjih 10 uvoza sa ⚠ za „bez slike / kratak tekst“ |
| **5. Sažetak događaja** | `buildEventSummary()` + `GET /api/articles/event/:id` | 2–3 rečenice iz opisa vesti (najnovije prvo) + `timeline` sa datumima; prikaz ispod naslova `/event/:id`, i kao meta description |
| **6. De-duplikacija slika** | marker `<!--source-image:URL-->` u `content`-u | ista naslovna slika se **ne** mirroruje dvaput — drugi uvoz vraća postojeći WebP (proverено: oba puta isti fajl) |

> Marker je HTML komentar, ne `<span data-…>`: sanitizator dozvoljava `span`
> samo bez atributa, pa bi atribut bio obrisan. `cover_image` posle mirror-a
> sadrži naš URL, pa je marker jedini način da se prepozna original.

### ✅ AI prevod (2.13.3 / 2.13.4)

Feed n8n-a prevodi **samo neke** naslove („OSVRT…“ pored „Street Fighter V temporarily delisted“). Zato uvoz prevodi sve što nije srpsko — naslov i telo.

| | |
|---|---|
| **Model** | `gemini-3.5-flash-lite` (fallback `gemini-3.5-flash` za tvrdoglave naslove) |
| **Ključ** | `GEMINI_API_KEY` u `server/.env` (nikad u frontend/git) |
| **Cena** | izmereno: ~858 tokena po vesti → **~$0.0013 po vesti**, ~$0.04 za 30 vesti |
| **Keš** | `.ai-cache.json` — ista rečenica se nikad ne plaća dvaput |
| **Limit** | `AI_TRANSLATE_MAX_PER_RUN=40` poziva po pokretanju |
| **Isključivanje** | `--no-ai` ili `AI_TRANSLATE=0` → vraća se dvostruko telo (sažetak + original) |

Dvosloјna zaštita:
1. **AI** prevede; ako vrati isti tekst (dešava se na naslovima punim imena igara),
2. **deterministički fallback** (`translateTitleFallback`) zameni poznate fraze —
   lošiji stil, ali uvek isti rezultat i bolji od engleskog naslova.

Izveštaj na kraju uvoza:
```
AI prevod: 43 poziva · 12 iz keša · 0 neuspeha · 39.120 tokena · ~$0.0430
```

> **Napomena o ceni:** Gemini 2.5 modeli su povučeni. Za ključ EVE generacije
> radi samo `gemini-3.x` serija, pa je cena viša od prvobitne procene za 2.5 —
> ali i dalje ispod 5$ mesečno za 30 vesti dnevno. Besplatni nivo važi dok se
> ne pređe dnevni limit (bez kartice).

### ⚠️ Što još može da se doda (nije urađeno)

1. ~~AI prevod tela teksta~~ — urađeno u 2.13.3/2.13.4 (vidi sekciju ispod).
2. **Više izvora, ne jedan feed.** Skripta je spremna za `--feed=`; više RSS-ova
   znači jedno pokretanje po feedu (`RSS_FEED_URL` po izvoru) i zdrav portal i kad
   n8n padne.
3. **Praćenje izvora u adminu.** `GET /api/admin/news/sources` vraća brojeve;
   treba još grafički prikaz u `/admin` (komponenta ekvivalentna kartici statistike).
4. **Automatski „developing story“ tekst.** `eventId` postoji, ali kartica „Priča se
   razvija“ je samo značka; može da sabira naslove u 2-rečenični sažetak događaja.
5. ~~De-duplikacija slika~~ — urađeno u 2.13.2.
6. **Cron na serveru, ne lokalno.** `schtasks` radi samo dok je računar uključen;
   za produkciju — Render Cron / GitHub Actions `schedule:` koji poziva
   `npm run ingest:news`.

---

## 1. Šta server očekuje

| | |
|---|---|
| URL | `POST https://<tvoj-api-domen>/api/articles/ingest` |
| Auth header | `X-Ingest-Key: <ARTICLES_INGEST_API_KEY>` |
| Content-Type | `application/json` |
| Body limit | 100 KB (isto kao ostale rute) |

Telо zahteva (JSON):

```json
{
  "title": "Naslov vesti (3–150 karaktera, obavezno)",
  "content": "<p>HTML sadržaj, 20–50.000 karaktera, obavezno</p>",
  "sourceUrl": "https://izvor.com/vest/123",
  "excerpt": "Kratak opis (opciono, ≤ 400)",
  "category": "Vesti",
  "tags": ["esports", "cs2"],
  "coverImage": "https://.../slika.jpg",
  "authorName": "Naziv izvora",
  "isFeatured": false
}
```

- `sourceUrl` je **obavezan** i služi za deduplikaciju (mora `https://`).
- `authorName` je samo tekstualna oznaka izvora (npr. "IGN"), ne kreira korisnika —
  autor članka je admin nalog sa servera.
- `tags` — najviše 5, svaki do 24 karaktera.
- `coverImage` — mora `https://` ako je poslat; prazan string ili izostavljeno polje je
  dozvoljeno (vest bez slike, frontend prikazuje svoj fallback).

Odgovori:

| Status | Značenje |
|---|---|
| `201` | Vest je objavljena (`status: published`, vidljiva odmah) |
| `200` `{ duplicate: true }` | Ista vest već postoji (isti `sourceUrl` ili isti naslov u 24h) — nije greška |
| `400` | Validacija (`details[]` ima poruke po polju) |
| `401` | Pogrešan `X-Ingest-Key` |
| `503` `INGEST_DISABLED` | `ARTICLES_INGEST_API_KEY` nije podešen na serveru |
| `429` | Rate limit (previše POST-ova sa iste IP) |

---

## 2. Podešavanje na serveru

1. Generiši ključ (PowerShell / bilo koji terminal):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. Upiši u `server/.env` (na hostingu — u environment varijable):

   ```env
   ARTICLES_INGEST_API_KEY=<ključ-iz-koraka-1>
   ARTICLES_INGEST_AUTHOR=nexus_admin   # opciono: ID ili username admina-autora
   ```

3. Restartuj API. Provera da radi (PowerShell):

   ```powershell
   $body = @{ title = "Test vest iz n8n"; content = "<p>Provera da uvoz radi ispravno.</p>"; sourceUrl = "https://example.com/test-1" } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/articles/ingest" `
     -Headers @{ "X-Ingest-Key" = "<ključ>" } -ContentType "application/json" -Body $body
   ```

   Ponovi istu komandu — drugi put vraća `duplicate: true`.

> Ključ NIKAD ne ide u frontend (`VITE_*`), u git ni u `docs/` — samo u `server/.env`
> i u n8n kredencijale.

---

## 3. Podešavanje u n8n

Workflow (RSS bot) treba da ima tri node-a: **RSS Read → (opciono) Set/IF → HTTP Request**.

### 3.1 Kredencijal (jednom)

n8n → **Credentials → New → Header Auth**:

- **Name**: `nexus_ingest` (bilo koje ime)
- **Header Name**: `X-Ingest-Key`
- **Header Value**: ključ iz koraka 2

### 3.2 HTTP Request node

| Polje | Vrednost |
|---|---|
| Method | `POST` |
| URL | `https://<tvoj-api-domen>/api/articles/ingest` |
| Authentication | `Generic Credential Type` |
| Generic Auth Type | `Header Auth` |
| Header Auth | `nexus_ingest` |
| Send Headers | isključeno (dolazi iz kredencijala) |
| Send Body | uključeno |
| Body Content Type | `JSON` |
| Specify Body | `Using JSON` |

JSON body (n8n expression, prilagodi imena polja svom RSS node-u):

```json
{
  "title": {{ JSON.stringify($json.title) }},
  "content": {{ JSON.stringify($json["content:encoded"] ?? $json.contentSnippet ?? $json.content) }},
  "sourceUrl": {{ JSON.stringify($json.link) }},
  "excerpt": {{ JSON.stringify(($json.contentSnippet ?? "").slice(0, 300)) }},
  "category": "Vesti",
  "tags": {{ JSON.stringify(($json.categories ?? []).slice(0, 5)) }},
  "coverImage": {{ JSON.stringify($json.enclosure?.url ?? $json.image?.url ?? undefined) }},
  "authorName": {{ JSON.stringify($json.creator ?? "RSS") }}
}
```

Napomene:

- `content` mora imati **najmanje 20 karaktera**; ako feed daje prazan opis, dodaj
  `"<p>" + ... + "</p>"` ili spoji sa linkom na izvor.
- `coverImage` izostavi ako nema slike (prazan string → 400; `undefined`/`null` je ok —
  `JSON.stringify(undefined)` u n8n daje `null`, što je takođe prihvatljivo).
- RSS node često vraća HTML entity-je (`&amp;`, `&#8217;`) — po potrebi dodaj
  Code node koji dekodira tekst pre slanja.

### 3.3 Ruti za greške

- Node postavi na **Retry On Fail** (2 pokušaja, 5 s pauza) — mrežni problemi ka izvoru.
- `Continue On Fail` uključi ako ne želiš da jedan loš feed prekine ceo workflow;
  `duplicate: true` (200) je normalan ishod i ne treba ga tretirati kao grešku.
- Ako n8n i API rade na različitim domenima, HTTPS je dovoljan — CORS se ne primenjuje
  na serverske pozive (nema `Origin` zaglavlja).

---

## 4. Česte greške

| Simptom | Uzrok / rešenje |
|---|---|
| `503 INGEST_DISABLED` | `ARTICLES_INGEST_API_KEY` nije u `server/.env` ili je restart izostao |
| `401 Neispravan ingest ključ` | Header `X-Ingest-Key` nije poslat (kredencijal nije izabran u node-u) ili se razlikuje od env vrednosti |
| `400 Sadržaj je prekratak` | Feed daje prazan opis — dodaj fallback tekst/link |
| `503 INGEST_NO_AUTHOR` | U bazi nema admin naloga; postavi `ARTICLES_INGEST_AUTHOR` |
| Uvek `duplicate: true` | Isti `sourceUrl` za više stavki (feed koristi isti `link`); koristi `$json.guid` kao `sourceUrl` |
| Vest nije na sajtu | Članak je `published`; proveri da nije zakazano vreme u budućnosti i osveži listu (`GET /api/articles`) |
