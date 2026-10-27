/**
 * 2.13.0 — ZAJEDNIČKA PRAVILA ZA VESTI
 * -----------------------------------
 * Kategorija, srpski tagovi, grupa događaja i „zašto je bitno“.
 *
 * Žive ovde (a ne u `ingest-rss.mjs`) jer ih koriste DVA mesta:
 *  - uvoz (`ingest-rss.mjs`) — pri objavi nove vesti,
 *  - backfill (`relabel-news.mjs`) — kada se pravilo promeni, stare vesti se
 *    reklasifikuju bez ručnog rada.
 *
 * Bez zavisnosti (nema `fetch`, nema baze) da bi ih mogao da uveze i test.
 */

/* --------------------------- tekst pomoćnici --------------------------- */

/** Skida tagove i dekodira najčešće entitete (dovoljno za klasifikaciju). */
export function plainText(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reže na granici reči (naslov 150, opis 300, tag 24 — limite šeme). */
export function clip(value, max) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max * 0.6))).trimEnd()}…`;
}

/* ------------------------------ kategorije ------------------------------ */

/**
 * Pravilo = [kategorija, regex]. Poredak je bitan (konkretnije pre opštijeg).
 * `Film i TV` se preskače u glavnoj petlji — bira se samo kada vest NIJE o igri.
 */
/**
 * 2.13.5 — `\b` je nepouzdan uz slova sa dijakritikom (č, ć, š, ž, đ):
 * u JS regexu bez `u` zastavice `\b` gleda samo ASCII, pa `\bvodič` ne pogađa
 * „Vodič“ na početku. Zato se granica piše eksplicitno: `(^|[^\p{L}])…(?![\p{L}])`.
 * Funkcija vraća regex sa pravilnom granicom za reč sa dijakritikom.
 */
const wordRe = (words) => new RegExp(`(^|[^\\p{L}])(${words})(?![\\p{L}])`, 'iu');

export const CATEGORY_RULES = [
  ['Vodiči', wordRe('vodič\\p{L}*|event guide|kako da|saveti|tutorijal|guide|how to|walkthrough|tips')],
  /**
   * 2.13.5 — NOVE KATEGORIJE iz analize: 30 od 44 vesti je završavalo u „Vesti“
   * jer nijedno postojeće pravilo nije pogađalo temu. Zabava/Nauka/Modovi/Industrija
   * pokrivaju ostatak bez razvlačenja „Vesti“ na sve.
   */
  ['Zabava', wordRe('kviz|glasajte|anketa|takmičenje nagrada|giveaway|humor|zabavan|najstrašnij\\p{L}*|najsmješnij\\p{L}*|internetsk\\p{L}*|meme|viral')],
  /**
   * Nauka je uska: istraživanje, studija, neuronauka. `AI model` ulazi ovde, a
   * ne industrija — tekst o modelu nije vest o poslovanju.
   */
  ['Nauka', wordRe('istraživač\\p{L}*|istrazivac\\p{L}*|naučnic\\p{L}*|naucnic\\p{L}*|studija pokazuje|neuro\\p{L}*|psiholog\\p{L}*|AI model|veštačka inteligencija|artificial intelligence')],
  /**
   * 2.13.5 — `NE` je česta reč u naslovima („Jednostavno ne možete pobeći“) i
   * nije „NE!“ (studio). Zato se studio/izdavač traže u KONTEKSTU, a ne kao
   * samostalni akronim; `revenue` je već pokriven pravilom Biznis iznad.
   */
  ['Modovi', wordRe('modovi|modding|modder|co-op|kooperativ\\p{L}*|community patch|fan remake|fan projekat')],
  ['Industrija', /\b(razvijač|razvijac|izdavač|izdavac|publisher|developer|tržište|trziste|analitičar|analiticar|istraživanje tržišta|radna mesta|zaposleni|sindikat)\b/i],
  /**
   * 2.13.5 — `recenzij\w*` umesto `recenzij`.
   * `\b` posle „recenzij“ ne postoji („Recenzij**a**“), pa pravilo nikad nije
   * pogađalo naslov koji počinje tom rečju. Isti propust je bio i za `ocen`.
   */
  ['Recenzije', wordRe('recenzij\\p{L}*|ocen\\p{L}*|review|first impressions|hands-on|benchmark')],
  /** Liste i top-liste („12 najboljih trenutaka“, „10 najboljih karata“). */
  ['Liste', /\b(najbolj(i|ih)|top \d+|best (?:\d+|of|moments|cards|games|builds))\b/i],
  /**
   * Hardver: brend delova ili konkretna komponenta. Nema `remaster`/`gigabajt` —
   * „Remastered ne menja mnogo“ nije hardver, a „300GB za pre-loading“ je vest.
   */
  ['Hardver', /\b(nvidia|amd gpu|intel core|intel arc|rtx|gtx|geforce|ryzen|radeon|gpu|graficka karta|grafick|procesor|cpu|ssd|nvme|hardver|hardware|steam deck|laptop|matien|tastatur|vodeno hladjenje)/i],
  ['Biznis', /\b(otpušt|otpust|otkazi|otpremnin|layoffs?|buyouts?|akvizicij|prihod|revenue|profita|akcionar|berz|investitor|milijardi|billion|sindikat|bankrot|insolven|sajber napad|cyberattack|kompanija|studio)\b/i],
  ['Esports', /\b(esport|turnir|šampionat|sampionat|tournament|valorant|cs2|dota 2|overwatch league|pro player|prize pool|worlds|majors)\b/i],
  /**
   * „Xbox radnici“, „otpremnine“ — vest o ljudima/novcu, ne o konzoli. Biznis
   * pravilo iznad ovo pokriva; ovde ostaju samo jasni finansijski/pravni signali.
   */
  ['Biznis', /\b(otpremnin|sindikat|radnic[ie]|zaposlen|tužb|tuzb|prihod|profit|akcionar|investicij|milijard|billion|bankrot|sajber napad|cyberattack|gašenje|gasenje)\b/i],
  ['Film i TV', /\b(film|netflix|hbo|disney\+|anime|trailer|trejler|glumac|reditelj|bioskop|movie|casts?\b|tv series|serija|serije)\b/i],
  ['Konzole', /\b(ps5|ps4|console|konzol[ae]?|switch 2|nintendo|state of play)\b/i],
  ['Mobilno', /\b(iphone|android app|android\b|ios\b|ipad|mobile game|mobiln[a-z]* igr|app store|google play|pok[eé]mon go)\b/i],
  /**
   * „Igre“ — vesti o konkretnoj igri bez žanrovskog signala. Poslednje pravilo
   * jer ga lako pogodi bilo šta; služi da „Vesti“ ostane za prave opšte vesti.
   */
  ['Igre', /\b(igra|igre|igranje|gejmplej|gameplay|demo|early access|rpg|dlc|season|sezona|update|ažuriranje|patch|izdanje|expansion)\b/i],
  /** Isključivo film/serija (kad naslov nema igru): „Film“ tek posle igara. */
  ['Film-strong', /\b(film|serij[a-z]*|movie|glumac|glumci|reditelj|bioskop|hbo|netflix|disney\+|dcu|mcu|avengers|doomsday|x-men|anime serij)\b/i],
  /** Igre čiji naziv ne pominje konzolu („Pokemon Unite se gasi“, „Dark Messiah“). */
  ['Igre-poznate', /\b(pok[eé]mon unite|pok[eé]mon tcg|dark messiah|dark messiaha|radiance booster|riftbound|lord of the rings|harry potter|doom the dark ages|metroid|splatoon|animal crossing|kirby|wolf among us|bioshock|life is strange|ghost of|ecstatica|dmz|modern warfare|silent hill|ratchet (?:&|and) clank|final fantasy|evercrisis|street fighter|magic: the gathering|teenage mutant ninja turtles|tmnt)\b/i],
  ['Žanr', /\b(fps|rpg|mmo|farming sim|simulator|survival horror|metroidvania|roguelike|battle royale|tower defense|deckbuilding|first-person)\b/i],
  ['Igre', /\b(magic: the gathering|roblox|death stranding|ghost of|phantom blade|stalker|life is strange|final fantasy|diablo|overwatch)\b/i],
];

/**
 * Nazivi igara koje ne smeju da završe u „Konzole“ samo zato što pominju
 * platformu („Pokemon Unite na Switchu“) — prepoznaju se pre ostalih pravila.
 */
export const KNOWN_GAMES =
  /\b(pok[eé]mon unite|pok[eé]mon tcg|pok[eé]mon go|dark messiah|radiance booster|riftbound|deus ex|magic: the gathering|roblox|death stranding|ghost of|phantom blade|stalker|life is strange|final fantasy|diablo|overwatch|metroid|splatoon|animal crossing|kirby|wolf among us|bioshock|ecstatica|dmz|modern warfare)\b/i;

/** „Film i TV“ ne otima vest o igri koja usput pominje seriju/trejler. */
export const GAME_SIGNALS =
  /\b(survival horror|assassin|resynced|square enix|devs?\b|studio|dlc|magic: the gathering|modern warfare|warzone|dmz|fortnite|zelda|pokemon|pokémon|mario|silent hill|bioshock|mass effect|wolf among us|elden ring|dark souls|gta|minecraft|update|ažuriranje|patch|gameplay|remake|remaster|beta|multiplayer|single-player|pre-load)\b/i;

/**
 * Kategorije koje smeju da se odrede iz TELA (naslov je nepouzdan za njih).
 * 2.13.5 — dodata „Industrija“: vest o studiju/izdavaču često nema tu reč u naslovu.
 */
export const BODY_SAFE_CATEGORIES = new Set(['Hardver', 'Biznis', 'Recenzije', 'Vodiči', 'Industrija', 'Nauka']);

/**
 * 2.13.5 — Recenzija se prepoznaje i kad je u TELU („Naša ocena: 8/10“,
 * „The review of…“). Bez ovoga je „Recenzija: Elden Ring“ iz tela padala u Vesti.
 */
const REVIEW_BODY_SIGNAL = /\b(recenzij\w*|ocen\w*|review|first impressions|hands-on|score|verdict)\b/i;
const ESPORTS_CONTEXT = /\b(turnir|šampionat|sampionat|tournament|prize pool|pro player|competitive|worlds|majors)\b/i;

/** Kategorija po ključnim rečima u datom tekstu (`strict` = samo naslov). */
function classifyText(text, strict) {
  for (const [name, pattern] of CATEGORY_RULES) {
    if (!strict && !BODY_SAFE_CATEGORIES.has(name)) continue;
    if (name === 'Film i TV') continue;
    /**
     * 2.13.5 — ŽANR/POZNATA IGRA → kategorija „Igre“ (a ne „Vesti“).
     * Ranije je sve padalo u „Vesti“, pa je 30/44 vesti bilo u jednoj kanti.
     * Liste ostaju neutralne — one nisu tema, nego format.
     */
    if (name === 'Žanr' || name === 'Igre' || name === 'Igre-poznate') {
      if (pattern.test(text)) return 'Igre';
      continue;
    }
    /**
     * Liste su FORMAT, ne tema: „10 najboljih bossova“ je vodič, „12 najboljih
     * igara“ ostaje opšta vest. Zato Liste sama vraća Vesti, ali ne prekida
     * proveru ostalih pravila (ranije je prekidala, pa je „Vodič za boss“
     * završavao u Vesti).
     */
    if (name === 'Liste') {
      if (pattern.test(text) && !/\b(vodič\w*|guide|kako da|saveti)\b/i.test(text)) return 'Vesti';
      continue;
    }
    /**
     * Poznata igra pobeđuje platformu: „Pokemon Unite na Switchu“ je vest o
     * igri, ne o konzoli. (Vest o samoj konzoli nema naziv igre u naslovu.)
     */
    if (name === 'Konzole' && KNOWN_GAMES.test(text)) continue;
    // „Film i TV“ samo kada vest nije o igri (naziv igre ima prioritet).
    if (name === 'Film-strong') {
      if (pattern.test(text) && !GAME_SIGNALS.test(text) && !/\b(igra|igre|game|igrica)\b/i.test(text)) return 'Film i TV';
      continue;
    }
    /**
     * Hardver je hardver samo uz konkretnu komponentu. Naslovi koji pominju
     * `AI`, `remaster`, `update` su vesti/recenzije — ne GPU vesti.
     */
    if (name === 'Hardver') {
      if (/\bremaster|remake|patch notes|update\b/i.test(text)) continue;
      if (!/\b(nvidia|rtx|gtx|geforce|ryzen|radeon|gpu|grafick|procesor|cpu|ssd|nvme|steam deck|laptop|monitor|tastatur)\b/i.test(text)) continue;
      if (/\bai\b/i.test(text) && !/hardver|gpu|procesor/i.test(text)) continue;
    }
    if (name === 'Esports') {
      if (pattern.test(text) && ESPORTS_CONTEXT.test(text)) return 'Esports';
      continue;
    }
    if (pattern.test(text)) return name;
  }
  return null;
}

/**
 * Kategorija vesti: naslov je najtačniji signal, telo razrešava samo kada naslov
 * ne kaže ništa — i to samo za bezbedne kategorije (Hardver/Biznis/Recenzije/Vodiči).
 */
export function classifyArticle({ title = '', excerpt = '', content = '', tags = [] } = {}) {
  const feedTags = tags.join(' ').toLowerCase();
  if (/review|recenzij/.test(feedTags)) return 'Recenzije';
  if (/guide|vodič|vod\b/.test(feedTags)) return 'Vodiči';

  const fromTitle = classifyText(title, true);
  if (fromTitle) return fromTitle;

  const body = `${excerpt}\n${plainText(content).slice(0, 1200)}`;

  // Recenzija iz tela pre bilo koje žanrovske kategorije.
  if (REVIEW_BODY_SIGNAL.test(body)) return 'Recenzije';

  const gameish =
    GAME_SIGNALS.test(title) ||
    GAME_SIGNALS.test(body) ||
    /\b(demo|steam next fest|early access|game|igra|rpg|review|players)\b/i.test(body);
  if (gameish) return classifyText(body, false) ?? 'Vesti';

  return /\b(film|movie|serij|serije|netflix|hbo|disney\+|anime|glumac|glumci|stars|cast|casts|trailer|trejler|bioskop|studios|dcu|mcu)\b/i.test(title)
    ? 'Film i TV'
    : 'Vesti';
}

/* -------------------------------- tagovi -------------------------------- */

export const TAG_TRANSLATIONS = new Map(
  Object.entries({
    news: 'Vesti',
    games: 'Igre',
    gaming: 'Gejming',
    hardware: 'Hardver',
    pc: 'PC',
    console: 'Konzole',
    review: 'Recenzije',
    reviews: 'Recenzije',
    guide: 'Vodiči',
    guides: 'Vodiči',
    esports: 'Esports',
    esport: 'Esports',
    industry: 'Industrija',
    business: 'Biznis',
    'action adventure': 'Akcija i avantura',
    'hack & slash': 'Hack & Slash',
    strategy: 'Strategija',
    interview: 'Intervju',
    impressions: 'Utisci',
    feature: 'Reportaža',
    'first person': 'Prvo lice',
    'multiplayer competitive': 'Multiplayer',
    'gaming industry': 'Industrija',
    'game development': 'Razvoj igara',
    'graphics cards': 'Grafičke karte',
    'polygon lists': 'Liste',
    'action & adventure': 'Akcija i avantura',
    'action-adventure': 'Akcija i avantura',
    'first-person': 'Prvo lice',
    'multiplayer-competitive': 'Multiplayer',
    'now playing': 'Igramo',
    'data breach': 'Sajber napad',
    'hack & slash': 'Hack & Slash',
    'open world': 'Otvoreni svet',
    'game awards': 'Game Awards',

    opinion: 'Mišljenje',
    general: 'Opšte',
    genre: 'Žanr',
    comedy: 'Komedija',
    horror: 'Horor',
    fantasy: 'Fantazija',
    fighting: 'Borilačke',
    mod: 'Mod',
    mods: 'Modovi',
    'news lists': 'Liste',
    drama: 'Drama',
    party: 'Zabava',
    commentary: 'Komentar',
    'the bests': 'Najbolje',
    dlc: 'DLC',
    rpg: 'RPG',
    fps: 'FPS',
    mmo: 'MMO',
    indie: 'Indie',
    mobile: 'Mobilno',
    android: 'Android',
    ios: 'iOS',
    tv: 'TV',
    film: 'Film',
    movie: 'Film',
    series: 'Serije',
    anime: 'Anime',
    ai: 'AI',
    'virtual reality': 'VR',
    vr: 'VR',
    playstation: 'PlayStation',
    xbox: 'Xbox',
    nintendo: 'Nintendo',
    steam: 'Steam',
    pokemon: 'Pokémon',
    'pokemon go': 'Pokémon GO',
    dlc: 'DLC',
    update: 'Ažuriranje',
    'new game plus': 'New Game+',
    patch: 'Patch',
    bethesda: 'Bethesda',
    sony: 'Sony',
    microsoft: 'Microsoft',
    capcom: 'Capcom',
    ubisoft: 'Ubisoft',
    ea: 'EA',
  }),
);

const KEEP_AS_IS =
  /^(rpg|fps|mmo|pc|vr|ai|dlc|ios|tv|ea|sega|sony|xbox|nvidia|amd|intel|steam|nintendo|playstation|ubisoft|capcom|bethesda|microsoft|rockstar)/i;

export const BRAND_PATTERN =
  /\b(GTA\s*(?:6|VI)?|Fortnite|Minecraft|Zelda|Pokémon|Pokemon|Call of Duty|Battlefield|Silent Hill|Resident Evil|Dark Souls|Elden Ring|Halo|Mass Effect|Roblox|Magic: The Gathering|Xbox|PlayStation|Nintendo|Switch 2|Steam Deck|Rockstar|Valve|FromSoftware)\b/i;

const GENERIC_TAG = /^(news|games|gaming|features?|articles?|update|ažuriranje|patch)$/i;

/** Srpski tagovi; brend iz naslova je prvi. Kategorija se ne ponavlja kao tag. */
export function buildTags(rawTags = [], title = '', category = '') {
  const out = new Set();
  const add = (tag) => {
    const clean = clip(String(tag ?? '').trim(), 24);
    if (clean.length >= 2 && !GENERIC_TAG.test(clean) && out.size < 5) out.add(clean);
  };

  const brand = title.match(BRAND_PATTERN);
  if (brand) add(brand[1].replace(/^pokemon$/i, 'Pokémon').replace(/^gta$/i, 'GTA'));

  for (const raw of rawTags) {
    const translated = TAG_TRANSLATIONS.get(String(raw).toLowerCase().trim());
    if (translated) add(translated);
    else if (KEEP_AS_IS.test(String(raw))) add(raw);
    else if (String(raw).length <= 24) add(raw);
  }

  if (out.size === 0 && category) add(category);
  return [...out].slice(0, 5);
}

/* ---------------------------- grupa događaja ---------------------------- */

export const EVENT_TOPICS = [
  [/\bgta\s*(6|vi)\b/i, 'gta-6', 'GTA 6'],
  [/\bfortnite\b/i, 'fortnite', 'Fortnite'],
  [/\b(zelda|nintendo switch|switch 2|nintendo)\b/i, 'nintendo', 'Nintendo'],
  [/\b(xbox|microsoft gaming)\b/i, 'xbox', 'Xbox'],
  [/\b(playstation|ps5|sony interactive)\b/i, 'playstation', 'PlayStation'],
  [/\b(call of duty|modern warfare|warzone)\b/i, 'call-of-duty', 'Call of Duty'],
  [/\bpok[eé]mon\b/i, 'pokemon', 'Pokémon'],
  [/\bstalker\b/i, 'stalker-2', 'STALKER 2'],
  [/\bsilent hill\b/i, 'silent-hill', 'Silent Hill'],
  [/\b(otpušt|otpust|otkazi|otpuštanj|layoff)/i, 'otkazi-u-industriji', 'Otkazi u industriji'],
  [/\b(akvizicij|preuzimanj|kupuje|acqui)/i, 'akvizicije', 'Akvizicije'],
  [/\b(nvidia|rtx 50|rtx 40|geforce)\b/i, 'nvidia', 'NVIDIA'],
  [/\b(\bai\b|veštačka inteligencija|artificial intelligence)/i, 'ai-u-igrama', 'AI u igrama'],

  /**
   * 2.13.5 — proširena lista iz stvarnih vesti (4 događaja koja su očigledno
   * pripadala zajedno, a nisu bila grupisana). Red je važan: specifičnije pre
   * opštijeg (Ratchet pre Sony, Dark Messiah pre „magičnih“ tema).
   */
  [/\bdark messiah\b/i, 'dark-messiah', 'Dark Messiah'],
  [/\bratchet (?:&|and) clank\b/i, 'ratchet-clank', 'Ratchet & Clank'],
  [/\b(?:final fantasy|ff7|ff14|ff16)\b/i, 'final-fantasy', 'Final Fantasy'],
  [/\bevercrisis\b/i, 'final-fantasy', 'Final Fantasy'],
  [/\bmagic: the gathering\b/i, 'magic-the-gathering', 'Magic: The Gathering'],
  [/\b(?:teenage mutant ninja turtles|tmnt)\b/i, 'tmnt', 'Teenage Mutant Ninja Turtles'],
  [/\bstreet fighter\b/i, 'street-fighter', 'Street Fighter'],
  [/\b(?:wolf among us|telltale)\b/i, 'the-wolf-among-us', 'The Wolf Among Us'],
  [/\b(?:dungeons? (?:&|and) dragons|wizards of the coast|hasbro)\b/i, 'dnd', 'Dungeons & Dragons'],
  [/\b(?:roblox)\b/i, 'roblox', 'Roblox'],
  [/\b(?:warcraft|world of warcraft|blizzard)\b/i, 'warcraft', 'Warcraft'],
  [/\b(?:half-life|valve)\b/i, 'valve', 'Valve'],
  [/\b(?:battlefield)\b/i, 'battlefield', 'Battlefield'],
  [/\b(?:call of duty|dmz|modern warfare|warzone)\b/i, 'call-of-duty', 'Call of Duty'],
  [/\b(?:elder scrolls|skyrim|bethesda)\b/i, 'bethesda', 'Bethesda'],
  [/\b(?:fromsoftware|elden ring|dark souls|armored core)\b/i, 'fromsoftware', 'FromSoftware'],
  [/\b(?:resident evil|capcom)\b/i, 'resident-evil', 'Resident Evil'],
  [/\b(?:assassin'?s creed|ubisoft)\b/i, 'assassins-creed', "Assassin's Creed"],
];

/** Ključ i naslov događaja iz naslova/tagova/opisa, ili `null`. */
export function detectEvent(title = '', tags = [], description = '') {
  const haystack = `${title} ${tags.join(' ')} ${description}`;
  for (const [pattern, id, label] of EVENT_TOPICS) {
    if (pattern.test(haystack)) return { id, title: label };
  }
  return null;
}

/* --------------------------- „zašto je bitno“ --------------------------- */

/**
 * Jedna rečenica uz naslov. Kada kategorija nema ništa pametno da kaže, ostaje
 * `null` — bolje ništa nego izmišljen tekst. Vraća i `null` za opštu kategoriju
 * „Vesti“ bez događaja.
 */
export function whyItMatters(category, eventLabel, publishedAt = '') {
  const when = publishedAt
    ? new Date(publishedAt).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'long' })
    : '';
  switch (category) {
    case 'Biznis':
      return 'Odluka menja ko pravi igre i koliko će industrija ulagati u njih.';
    case 'Hardver':
      return 'Utiče na cenu i dostupnost opreme u narednim mesecima.';
    case 'Esports':
      return 'Rezultat menja tabelu i raspored narednih turnira.';
    case 'Konzole':
      return 'Vest menja planove za igranje na konzoli ove godine.';
    case 'Film i TV':
      return 'Bitno je za fanove serijala koji prate priču van igre.';
    case 'Recenzije':
      return 'Ocena pokazuje da li vredi uložiti vreme i novac.';
    case 'Vodiči':
      return `Korak-po-korak za događaj${when ? ` (${when})` : ''}.`;
    default:
      return eventLabel ? `Deo teme „${eventLabel}“ — pratimo razvoj događaja.` : null;
  }
}

/**
 * 2.13.0 — „zašto je bitno“ i za opšte vesti koje nose brend ili događaj
 * („Radnici Xboxa…“, „GTA 6 prelazi 40 milijardi“). `whyItMatters()` to već
 * rešava; ovo je izvezena verzija za backfill da ne dupliramo logiku.
 */
export const whyItMattersFor = (category, eventLabel, publishedAt) => whyItMatters(category, eventLabel, publishedAt);

/**
 * 2.13.0 — naslov grupe za događaje koji se otkrivaju po KLJUČNOJ REČI, a ne po
 * brendu („otkazi u industriji“). Koristi se u backfill-u za `event_title`.
 */
const EVENT_TITLES = new Map(EVENT_TOPICS.map(([, id, label]) => [id, label]));
export const eventTitleFor = (eventId) => EVENT_TITLES.get(eventId) ?? null;
