/**
 * 2.13.1 — PREVOD BEZ AI-JA? NE.
 * ------------------------------
 * Pokušaj prevoda preko rečnika je ODBIJEN namerno, posle merenja.
 *
 * Rečnik ne zna gramatiku: „Rockstar igre ima potvrđeno taj GTA 6 je odložen
 * u sledeći godina“ i „Mojang najavljeno novi Minecraft ažuriranje za igrači“
 * su netačni rod, padež i red reči. Takav tekst je GORI od engleskog — čitalac
 * na portalu na srpskom poveruje da je to naš tekst, a to je poluprevod.
 * Zato ovaj modul ne prevodi, nego radi ono što se može uraditi pouzdano:
 *
 *  1. `extractKeySentences()` — vadi 2–3 najvažnije rečenice (lead) iz tela,
 *     da članak ne bude prazan.
 *  2. `buildBilingualBody()` — telo je na SRPSKOM sažetku (naslov i opis feeda),
 *     a originalni tekst ide ISPOD, jasno označen kao citat izvora na engleskom.
 *
 * Srpski tekst koji je već preveden (n8n prevodi naslove i opise) se ne dira:
 * `looksSerbian()` vraća `true` za tekst sa č, ć, š, ž, đ ili čestim srpskim
 * rečima, pa se telo ostavlja kako jeste.
 *
 * Za pravi prevod rečenica treba model (LLM). Uputstvo i cene su u
 * `docs/n8n-rss-bot.md` → „Kada uključiti AI prevod“.
 */

/**
 * Heuristika jezika.
 *
 * Ranije: srpski ako `sr > en * 1.5` — ali „Boss“, „Film“, „is“ postoje i u
 * srpskom, pa su SRPSKI naslovi („Procurio datum izlaska… i drugi prvi detalji“)
 * označavani kao engleski i slati modelu. Sada se traži bar jedan TIPIČNO srpski
 * pokazatelj (dijakritika ili srpska reč), i da engleskih nema više od njega.
 */
export function looksSerbian(text = '') {
  const sample = String(text).slice(0, 1500);
  if (!sample.trim()) return false;
  if (/[čćšžđ]/i.test(sample)) return true;

  const serbianWords = (
    sample.match(/\b(ne menja|mnogo|nešto|nesto|zbog toga|uprkos|dok|kada|sada|još|jos|više|vise|nije|nema|ima|može|moze|bilo|bio|bila|posle|pre|sve|svih|samo|veoma|takođe|takodje|zato|jer|ili|najbolj\w*|trenuta\w*|vesti|vest|igra|igre|igrač\w*|nove|novi|najava\w*|za|od|nije|će|koji|koja|koje|svih|tokom|slede\w*|datum|detalj\w*|izlaska|procuri\w*|mogao|može|zbog|ali|samo|više|kako|koje|ovaj|ovu|drugu|drugi)\b/gi) ??
    []
  ).length;
  const englishWords = (
    sample.match(/\b(the|and|with|that|this|from|they|will|have|was|were|are|apparently|another|officially|know|need|new|how|why|what)\b/gi) ??
    []
  ).length;

  /**
   * Nazivi igara unose engleske reči („The Wolf Among Us“), pa se broj engleskih
   * reči ne sme porediti 1:1. Zato: bar 1 srpska reč I bar 2 srpske kad ima
   * engleskih (naslov je mešan, ali je preveden).
   */
  if (serbianWords >= 2) return true;
  return serbianWords >= 1 && englishWords <= 1;
}

/** Skida tagove, skripte i stilove — ostaje čitljiv tekst. */
export function toPlainText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ključne rečenice iz teksta. Rangiranje je predvidivo i bez modela:
 * težina gejming pojmova + brojevi/novac + ranija pozicija u tekstu.
 */
export function extractKeySentences(html = '', max = 3) {
  const plain = toPlainText(
    String(html)
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n'),
  );

  const sentences = plain
    .split(/(?<=[.!?])\s+(?=[A-ZČĆŠĐŽ"«„])/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 40 && sentence.length <= 320);

  const WEIGHT =
    /\b(studio|developer|publisher|release|launch|sales|copies|million|billion|layoff|cancel|delay|update|patch|player|community|revenue|profit|price|game|igra)\b/i;

  return sentences
    .map((text, index) => ({
      text,
      score:
        (WEIGHT.test(text) ? 3 : 0) +
        (/\d/.test(text) ? 2 : 0) +
        /(%|€|\$)/.test(text) ? 1 : 0 - index * 0.15,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((item) => item.text);
}

/**
 * Telо članka: srpski sažetak gore, original ispod u bloku „Original (izvor)“.
 *
 * @param {object} input
 * @param {string} input.excerpt    sažetak (već na srpskom, iz feeda)
 * @param {string} input.original   originalni tekst (engleski) — pun ili rečenice
 * @param {boolean} input.originalIsSerbian  ako je original već srpski, ne slaže se blok
 * @param {string} input.sourceName ime izvora za zaglavlje bloka
 * @param {string} input.link       link na original
 */
export function buildBilingualBody({ excerpt = '', original = '', originalIsSerbian = false, sourceName = '', link = '' }) {
  const lead = String(excerpt).trim();
  const body = String(original).trim();

  const leadHtml = lead ? `<p><strong>${escapeHtml(lead)}</strong></p>` : '';

  if (!body || originalIsSerbian) {
    return `${leadHtml}${body ? body : ''}`.slice(0, 50_000);
  }

  const note = sourceName ? `Original (${escapeHtml(sourceName)}, engleski)` : 'Original (engleski)';
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block)}</p>`)
    .join('');

  const linkHtml = link
    ? `<p><a href="${escapeHtml(link)}" rel="nofollow noopener noreferrer" target="_blank">Pročitaj ceo tekst na ${escapeHtml(sourceName || 'izvoru')}</a></p>`
    : '';

  return `${leadHtml}<blockquote class="news-original"><p class="news-original-note"><em>${note}</em></p>${paragraphs}</blockquote>${linkHtml}`.slice(
    0,
    50_000,
  );
}

function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
