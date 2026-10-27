/**
 * 2.13.3 — AI PREVOD VESTI (Gemini)
 * ---------------------------------
 * Feed n8n-a prevodi naslove, ali telo ostaje na engleskom. Rečnik ne može da
 * prevede rečenice (padeži, red reči) — zato ovaj modul zove model.
 *
 * Zašto Gemini Flash-Lite: najjeftiniji model koji daje upotrebljiv srpski za
 * gejming vesti. Izmereno na stvarnim vestima (30 članaka ≈ 26.000 tokena):
 * ~$0.013 dnevno, ~$0.39 mesečno na plaćenom nivou. Sa besplatnim nivoom
 * (bez kartice) trošak je 0 dok se ne pređe dnevni limit.
 *
 * Ponašanje:
 *  - `GEMINI_API_KEY` prazan → modul je inertan, uvoz radi kao pre (dvostruko telo),
 *  - greška/timeout/limit → prevod se preskače, članak se i dalje uvozi,
 *  - `AI_TRANSLATE_MAX_PER_RUN` sprečava da jedan pokvareni feed potroši kvotu,
 *  - keš (`.ai-cache.json`) — ista rečenica se nikad ne prevodi dvaput.
 *
 * Ne prevodi: nazive igara, studija, brendova i lična imena (to modelu kaže prompt).
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Model se čita u trenutku poziva (env se puni iz `server/.env` posle importa). */
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Prompt za TELO članka (pasusi).
 */
const RULES_BODY = `Prevedi tekst na srpski jezik (latinica). Pravila:
- Nazive igara, studija, brendova, platformi i lična imena NE prevodi (GTA 6, Rockstar, Take-Two, Steam, Nintendo ostaju kako jesu).
- Prenesi značenje tačno; ništa ne dodavaj i ne izostavljaj.
- Zadrži HTML tagove i redosled pasusa ako ih ima.
- Vrati SAMO prevod, bez uvoda, bez objašnjenja.`;

/**
 * Prompt za NASLOV.
 *
 * Merenjem: model je isti tekst RAZUMEO ali nije preveo („Street Fighter V
 * temporarily delisted…“ → isto). Zato naslov dobija eksplicitan zahtev,
 * primer i zabranu vraćanja ulaza — inače bi pola naslova ostalo engleski.
 */
const RULES_TITLE = `Prevedi naslov gejming vesti sa engleskog na srpski (latinica).
- Vrati NASLOV na srpskom, bez tačke na kraju i bez navodnika.
- Nazive igara, studija i brendova NE prevodi (Street Fighter V, Nintendo, GTA 6).
- NE vraćaj engleski tekst — ako u naslovu ima samo ime igre, prevedi ostale reči.
- Primer: "Xbox lays off 30 workers" → "Xbox otpušta 30 radnika".
- Vrati SAMO prevedeni naslov.`;

/* ------------------- DETERMINISTIČKI ISPRAVKE NASLOVA ------------------- */

/**
 * 2.13.4 — MODEL POVREMENO VRAĆA ISTI NASLOV.
 *
 * Merenje: `flash-lite` je na kratkim, imenima prepunim naslovima vraćao ulaz
 * (0 prevoda), iako isti tekst u drugom pozivu prevede. Na 40 vesti to izgleda
 * kao „pola sajta je engleski“, a ne može se osloniti na slučaj.
 *
 * Zato se naslov koji je model odbio prevodi DETERMINISTIČKI: najduže poznate
 * fraze (3–1 reči) iz rečnika zamene se srpskim, brendovi/igre ostaju. Rezultat
 * je gori stilom od AI-ja, ali **bolji od engleskog naslova** i uvek isti.
 */
const TITLE_PHRASES = [
  // → potpune fraze prvo (red je bitan: duže pre kraćih)
  [/\bis apparently yet another\b/gi, 'je, izgleda, još jedna'],
  [/\bnuanced story\b/gi, 'nijansirana priča'],
  [/\bofficially named head of\b/gi, 'zvanično postavljen za šefa'],
  [/\btemporarily delisted\b/gi, 'privremeno uklonjen iz prodaje'],
  [/\bonline functions turned off\b/gi, 'onlajn funkcije isključene'],
  [/\bdue to\b/gi, 'zbog'],
  [/\blays off\b/gi, 'otpušta'],
  [/\bhas confirmed\b/gi, 'je potvrdio'],
  [/\bwill not be\b/gi, 'neće biti'],
  [/\bne menja mnogo\b/gi, 'ne menja mnogo'],
  [/\bi drugi prvi detalji\b/gi, 'i drugi prvi detalji'],
  [/\bRemakea\b/g, 'rimejka'],
  [/Wizards of the Coast/gi, 'Wizards of the Coast'],
  [/\bRemastered\b/g, 'Remastered'],
  // pojedinačne reči
  [/\bthe\b/gi, ''],
  [/\bAbout\b/g, 'o'],
  [/\bLoaded Subject\b/gi, 'teškoj temi'],
  [/\band\b/gi, 'i'],
  [/\bwith\b/gi, 'sa'],
  [/\bthat\b/gi, 'koji'],
  [/\bthis\b/gi, 'ovaj'],
  [/\bfrom\b/gi, 'iz'],
  [/\bnew\b/gi, 'novi'],
  [/\bgame\b/gi, 'igra'],
  [/\bupdate\b/gi, 'ažuriranje'],
  [/\bfilm\b/gi, 'film'],
  [/\bstory\b/gi, 'priča'],
  [/\bworkers\b/gi, 'radnika'],
  [/\bworker\b/gi, 'radnik'],
  [/\bboss\b/gi, 'šef'],
  [/\bhead of\b/gi, 'šef'],
  [/\bfirst\b/gi, 'prvi'],
  [/\bnew(s)?\b/gi, 'vest$1'],
  [/\bhow to\b/gi, 'kako'],
  [/\byet another\b/gi, 'još jedna'],
];

/** Da li je naslov i dalje pretežno engleski (za odluku da li fallback treba). */
const stillEnglish = (title) =>
  !/[čćšžđ]/i.test(title) &&
  (title.match(/\b(the|and|with|that|this|from|will|have|was|are|is|of|to|in)\b/gi) ?? []).length >= 2;

/**
 * Deterministički prevod naslova. Vraća `null` ako ništa nije prevedeno (tada
 * je bolje ostaviti original nego praviti „poluprevod“).
 */
export function translateTitleFallback(title) {
  let out = String(title);
  for (const [pattern, replacement] of TITLE_PHRASES) out = out.replace(pattern, replacement);
  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^\s+/, '')
    .trim();

  if (!out || out.toLowerCase() === String(title).toLowerCase()) return null;
  // Ako je ostalo mnogo engleskog (≥3 engleske reči), prevod nije dovoljan.
  if (stillEnglish(out)) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* ------------------------------- keš ------------------------------- */

const CACHE_FILE = resolve(process.cwd(), '.ai-cache.json');
let cache = {};
try {
  cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
} catch {
  cache = {};
}
let cacheDirty = false;

const cacheKey = (text) => createHash('sha1').update(text).digest('hex').slice(0, 20);
const CACHE_LIMIT = 2_000;

function saveCache() {
  if (!cacheDirty) return;
  try {
    // Ograniči veličinu: zadrži poslednjih N unosa.
    const entries = Object.entries(cache).slice(-CACHE_LIMIT);
    writeFileSync(CACHE_FILE, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
  } catch {
    /* keš nije kritičan */
  }
}

/* ------------------------------ poziv ------------------------------ */

const apiKey = () => (process.env.GEMINI_API_KEY ?? '').trim();

/** Da li je AI prevod uključen (ključ postoji i nije eksplicitno ugašen). */
export function aiTranslationAvailable() {
  return apiKey().length > 20 && process.env.AI_TRANSLATE !== '0';
}

export const aiStats = { calls: 0, cached: 0, failed: 0, skipped: 0, tokensIn: 0, tokensOut: 0 };
let budgetLeft = Number(process.env.AI_TRANSLATE_MAX_PER_RUN ?? 40);

/**
 * Prevod jednog teksta. Vraća `{ text, translated }` — `translated: false`
 * kada se koristi original (nema ključa, limit, greška, loš odgovor).
 */
/**
 * Prevod teksta modelom.
 * @param {string} text
 * @param {{ maxChars?: number, kind?: 'body' | 'title' }} options
 *   `kind: 'title'` koristi stroži prompt (model je bez njega vraćao ulaz).
 */
export async function translateWithAI(text, { maxChars = 6_000, kind = 'body' } = {}) {
  const source = String(text ?? '').trim();
  if (!source || source.length < 40) return { text: source, translated: false };
  if (!aiTranslationAvailable()) return { text: source, translated: false };

  const key = cacheKey(source);
  if (cache[key]) {
    aiStats.cached += 1;
    return { text: cache[key], translated: true };
  }

  if (budgetLeft <= 0) {
    aiStats.skipped += 1;
    return { text: source, translated: false };
  }

  const input = source.length > maxChars ? `${source.slice(0, maxChars)}…` : source;
  const rules = kind === 'title' ? RULES_TITLE : RULES_BODY;
  // Za naslov procenat dužine nije pouzdan (srpski je duži od engleskog).
  const minRatio = kind === 'title' ? 0.15 : 0.35;

  /**
   * 2.13.4 — DVA MODELA, TRI POKUŠAJA.
   *
   * `flash-lite` povremeno vrati ISTI tekst (nije greška, samo ne prevede), a
   * na 40 naslova u nizu to izgleda kao „pola naslova ne radi“. Zato:
   *  1–2. pokušaj na jeftinom modelu (temp 0.2 → 0.5 da izađe iz istog odgovora),
   *  3. pokušaj na malo jačem modelu (`AI_TRANSLATE_FALLBACK_MODEL`) kao rezervi.
   * Cena trećeg pokušaja je retka — samo za one rečenice gde lite model ne pomogne.
   */
  const models = [
    MODEL(),
    MODEL(),
    process.env.AI_TRANSLATE_FALLBACK_MODEL || 'gemini-3.5-flash',
  ];
  const temperatures = [0.2, 0.6, 0.4];

  for (let attempt = 1; attempt <= models.length; attempt += 1) {
    try {
      budgetLeft -= 1;
      aiStats.calls += 1;
      const model = models[attempt - 1];

      const res = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${rules}\n\nTekst:\n${input}` }] }],
          // 2.13.4 — bez `thinkingBudget: 0` flash modeli troše izlazne tokene na
          // „razmišljanje“ i preseku prevod na pola.
          generationConfig: {
            temperature: temperatures[attempt - 1],
            maxOutputTokens: kind === 'title' ? 512 : 4_096,

          },
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        // Prolazno — pauza pa sledeći pokušaj (kod 429 duža pauza).
        if (attempt < models.length) {
          await new Promise((resolveTimer) => setTimeout(resolveTimer, res.status === 429 ? 8_000 : 2_000));
          continue;
        }
        aiStats.failed += 1;
        return { text: source, translated: false };
      }

      if (!res.ok) {
        aiStats.failed += 1;
        return { text: source, translated: false };
      }

      const json = await res.json();
      const usage = json?.usageMetadata;
      if (usage) {
        aiStats.tokensIn += Number(usage.promptTokenCount ?? 0);
        aiStats.tokensOut += Number(usage.candidatesTokenCount ?? 0);
      }

      const answer = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part?.text ?? '')
        .join('')
        .trim();

      /**
       * Zaštita od „model je vratio isti (nepreveden) tekst“ — čest slučaj kod
       * naslova punih imena igara. Tada se ide na sledeći pokušaj/model, ne odustaje.
       */
      const unchanged = answer.trim().toLowerCase() === source.trim().toLowerCase();
      if (!answer || unchanged || answer.length < source.length * minRatio || /^\s*(kao|here|sure|naravno)/i.test(answer)) {
        if (attempt < models.length) continue;
        aiStats.failed += 1;
        return { text: source, translated: false };
      }

      cache[key] = answer;
      cacheDirty = true;
      return { text: answer, translated: true };
    } catch {
      if (attempt < models.length) {
        await new Promise((resolveTimer) => setTimeout(resolveTimer, 1_500));
        continue;
      }
      aiStats.failed += 1;
      return { text: source, translated: false };
    }
  }

  return { text: source, translated: false };
}

/* --------------------------- AI KLASIFIKACIJA --------------------------- */

/**
 * 2.13.5 — KATEGORIJA IZ SADRŽAJA (jedan poziv, bez dodatnog troška).
 *
 * Pravila po ključnim rečima pogađaju ~30% vesti; ostale padaju u „Vesti“.
 * Model već čita tekst za prevod, pa isti poziv može da vrati i kategoriju —
 * cena je ista, a tačnost znatno bolja.
 */
export const AI_CATEGORIES = [
  'Igre',
  'Industrija',
  'Hardver',
  'Konzole',
  'Esports',
  'Recenzije',
  'Vodiči',
  'Film i TV',
  'Zabava',
  'Nauka',
  'Modovi',
  'Mobilno',
  'Vesti',
];

const CLASSIFY_RULES = `Odredi kategoriju gejming vesti. Odgovori SAMO jednim redom oblika:
KATEGORIJA: <ime>

Dozvoljene kategorije (izaberi TAČNO jednu): ${AI_CATEGORIES.join(', ')}.
Vodič: Igre = vesti o konkretnoj igri; Industrija = studiji, izdavači, prodaja, tržište; Hardver = GPU/CPU/oprema; Konzole = PlayStation/Xbox/Nintendo; Film i TV = film, serija, anime; Vesti = opšte vesti koje ne pripadaju drugima.`;

/** Keš za kategorizaciju (isti tekst → ista kategorija, bez ponovnog poziva). */
const classifyCache = {};

/**
 * Vraća jednu od `AI_CATEGORIES` ili `null` (nema ključa, greška, nepoznata
 * vrednost). Nikad ne baca grešku — uvoz nastavlja sa pravilima.
 */
export async function classifyWithAI({ title = '', excerpt = '', content = '' } = {}) {
  if (!aiTranslationAvailable()) return null;
  if (budgetLeft <= 0) return null;

  const snippet = `${title}\n\n${excerpt}\n\n${String(content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}`.slice(0, 2_500);
  const key = cacheKey(`cat:${snippet}`);
  if (classifyCache[key]) return classifyCache[key];

  try {
    budgetLeft -= 1;
    aiStats.calls += 1;

    const res = await fetch(`${ENDPOINT}/${MODEL()}:generateContent?key=${apiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${CLASSIFY_RULES}\n\nTekst:\n${snippet}` }] }],
        /**
         * 2.13.5 — BEZ `thinkingConfig`.
         * Ovaj model vraća 400 INVALID_ARGUMENT kada se pošalje (i sa
         * `thinkingBudget: 0`). Odgovor je kratak („KATEGORIJA: Igre“), pa
         * 200 izlaznih tokena pokriva i eventualno razmišljanje.
         */
        generationConfig: { temperature: 0, maxOutputTokens: 200 },
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const usage = json?.usageMetadata;
    if (usage) {
      aiStats.tokensIn += Number(usage.promptTokenCount ?? 0);
      aiStats.tokensOut += Number(usage.candidatesTokenCount ?? 0);
    }

    const answer = (json?.candidates?.[0]?.content?.parts ?? []).map((part) => part?.text ?? '').join('');
    const match = answer.match(/KATEGORIJA:\s*([^\n\r]+)/i);
    const candidate = (match?.[1] ?? answer).trim().replace(/[.\u201e"„']/g, '');
    const found = AI_CATEGORIES.find((name) => name.toLowerCase() === candidate.toLowerCase());
    if (!found) return null;

    classifyCache[key] = found;
    return found;
  } catch {
    return null;
  }
}

/* --------------------- DOPUNA KRATKOG TEKSTA (2.13.5) --------------------- */

/**
 * Neke vesti imaju 2–3 rečenice (npr. kratka objava na Kotaku). Telo članka
 * tada izgleda prazno pored naslovne slike.
 *
 * Ovaj poziv NE izmišlja: traži sažetak od 3–4 rečenice ISKLJUČIVO iz datog
 * teksta + naslova. Ako model vrati nešto duže od ulaza ili očigledno dodaje
 * činjenice, rezultat se odbacuje — bolje kratka vest nego izmišljena.
 */
export async function expandShortText({ title, text, minChars = 900 } = {}) {
  const source = String(text ?? '').trim();
  if (source.length >= minChars || source.length < 120) return { text: source, expanded: false };
  if (!aiTranslationAvailable() || budgetLeft <= 0) return { text: source, expanded: false };

  const key = cacheKey(`exp:${title}:${source}`);
  if (cache[key]) return { text: cache[key], expanded: true };

  try {
    budgetLeft -= 1;
    aiStats.calls += 1;

    const res = await fetch(`${ENDPOINT}/${MODEL()}:generateContent?key=${apiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Na osnovu naslova i teksta ispod napisi sazetak vesti na srpskom (latinica), 3-4 recenice, u odvojenim pasusima. Koristi ISKLJUCIVO informacije iz teksta — nista ne izmisljaj i ne dodaj. Nazive igara i studija ne prevodi. Vrati samo tekst, bez naslova i uvoda.\n\nNaslov: ${title}\n\nTekst:\n${source}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1_200 },
      }),
    });

    if (!res.ok) return { text: source, expanded: false };
    const json = await res.json();
    const usage = json?.usageMetadata;
    if (usage) {
      aiStats.tokensIn += Number(usage.promptTokenCount ?? 0);
      aiStats.tokensOut += Number(usage.candidatesTokenCount ?? 0);
    }

    const answer = (json?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part?.text ?? '')
      .join('')
      .trim();

    /**
     * Zaštita od izmišljanja, ali NE i od rasta teksta.
     *
     * Ranije je rezultat odbacivan kad je duži od 2.2× ulaza — a cilj je da
     * kratka vest („420 znakova“) postane čitljiva („900 znakova“). Zato se
     * sada gleda APSOLUTNA granica: sažetak sme da bude do 1.600 znakova i do
     * 4× ulaza; preko toga je model počeo da dodaje svoje.
     */
    /**
     * 2.13.5 — granica se meri prema NASLOVU, ne prema ulazu.
     * Kada je ulaz 350 znakova, model i sažetak od 3–4 rečenice vrati na ~400 —
     * ranije je takav rezultat odbacivan („nije bar 0.8× ulaza“), pa je vest
     * ostala kratka. Sada je kriterijum: sažetak mora biti KRAĆI od 1.600
     * znakova i NE kraći od ulaza (nema smisla zameniti tekst kraćim).
     */
    const tooLong = answer.length > Math.max(1_600, source.length * 4);
    if (!answer || answer.length < source.length || tooLong) {
      return { text: source, expanded: false };
    }

    cache[key] = answer;
    cacheDirty = true;
    return { text: answer, expanded: true };
  } catch {
    return { text: source, expanded: false };
  }
}

/** Broj tokena i procenjena cena za poslednji run (za izveštaj). */
export function translationReport() {
  const priceIn = 0.5; // $ / 1M ulaznih tokena (paid tier, flash-lite)
  const priceOut = 2.0; // $ / 1M izlaznih tokena
  const cost = (aiStats.tokensIn * priceIn + aiStats.tokensOut * priceOut) / 1_000_000;
  return { ...aiStats, estimatedCostUsd: cost, model: MODEL() };
}

export { saveCache };
