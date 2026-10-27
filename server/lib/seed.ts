import bcrypt from 'bcryptjs';
import {
  db as dataLayerRef,
  MEMORY_CATEGORIES,
  levelFromXp,
  levelRange,
  type DataLayer,
  type UserRecord,
  type ArticleRecord,
  type ThreadRecord,
  type ReplyRecord,
} from './store.js';
import { computeDiscountPct, type DealRecord } from './deals.js';
import { logger } from './logger.js';
// B22 — seed hash-evi prate istu „kost“ kao aplikacija (4 u testovima).
import { BCRYPT_COST } from './validation.js';

/**
 * #13 — `forum_categories` je izvor istine za subforume. Seed je idempotentan:
 * dodaje samo slugove kojih nema, pa UI i validacija uvek rade sa istim listom.
 */
async function seedCategories(): Promise<number> {
  if (dataLayerRef.kind !== 'supabase') return 0;

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: existing, error } = await client.from('forum_categories').select('slug, name');
  if (error) {
    logger.warn(`[seed] forum_categories nije dostupna: ${error.message}`);
    return 0;
  }

  const known = new Set((existing ?? []).map((row: any) => row.slug ?? row.name));
  const missing = MEMORY_CATEGORIES.filter(
    (category) => !known.has(category.slug) && !known.has(category.name),
  );
  if (!missing.length) return 0;

  const { error: insertError } = await client.from('forum_categories').insert(
    missing.map((category) => ({
      slug: category.slug,
      name: category.name,
      description: category.description,
      icon: category.icon,
    })),
  );
  if (insertError) {
    logger.warn(`[seed] forum_categories insert: ${insertError.message}`);
    return 0;
  }
  return missing.length;
}

export async function seedInitialData(db: DataLayer): Promise<void> {
  // Idempotentno: dodaju se samo entiteti kojih još nema (bezbedno i za Supabase,
  // gde schema.sql može već sadržati admin korisnika).
  const created = {
    users: 0,
    articles: 0,
    threads: 0,
    replies: 0,
    newsletter: 0,
    categories: 0,
    games: 0,
    deals: 0,
  };

  created.categories = await seedCategories();

  // Lozinke demo naloga dolaze iz env-a — NEMA hardkodovanog `admin123`.
  // Bez `SEED_ADMIN_PASSWORD` admin nalog se preskače (ostali demo korisnici
  // dobijaju generisanu lozinku koja se ne loguje).
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  // B22 — seed hash-evi koriste istu „kost“ kao ostatak aplikacije (u testovima 4).
  const memberPassword =
    process.env.SEED_MEMBER_PASSWORD?.trim() ?? (await bcrypt.hash(crypto.randomUUID(), BCRYPT_COST));
  const adminPasswordHash = adminPassword ? await bcrypt.hash(adminPassword, BCRYPT_COST) : null;
  const memberPasswordHash = memberPassword.startsWith('$2')
    ? memberPassword
    : await bcrypt.hash(memberPassword, BCRYPT_COST);

  if (!adminPasswordHash) {
    logger.warn(
      '[seed] SEED_ADMIN_PASSWORD nije postavljen — demo admin (nexus_admin) neće biti kreiran, pa ni /admin nije dostupan.',
    );
  }

  // 1. Korisnici
  const admin: UserRecord = {
    id: 'user_admin',
    username: 'nexus_admin',
    email: 'admin@nexusgaming.com',
    password: adminPasswordHash ?? '',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=nexus_admin',
    bio: 'Lead architect of NEXUS Portal. Dark-mode zealot & mechanical keyboard collector.',
    role: 'admin',
    // XP mora da odgovara nivou (`levelProgress(xp).level`), jer se nivo NIKAD ne
    // čita iz keš kolone. Sa 18.750 XP to je nivo 14 — podaci su ranije tvrdili 47.
    level: levelFromXp(18750),
    xp: 18750,
    xpNeeded: levelRange(levelFromXp(18750)).end,
    karma: 8942,
    badges: ['founder', 'contributor', 'expert', 'veteran'],
    connectedAccounts: {
      steam: 'NexusGamer_2026',
      discord: 'NexusGamer#1337',
      twitch: 'NexusLive',
    },
    isVerified: true,
    isBanned: false,
    status: 'online',
    createdAt: '2024-01-15T12:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
  };

  const neuro: UserRecord = {
    id: 'user_neuro',
    username: 'NeuroGamer',
    email: 'neuro@nexusgaming.com',
    password: memberPasswordHash,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NeuroGamer',
    bio: 'Senior editor @ NEXUS. RPG and immersive sim connoisseur.',
    role: 'moderator',
    level: levelFromXp(11200),
    xp: 11200,
    xpNeeded: levelRange(levelFromXp(11200)).end,
    karma: 4310,
    badges: ['contributor'],
    connectedAccounts: {
      steam: 'NeuroGamer',
      discord: 'Neuro#0001',
    },
    isVerified: true,
    isBanned: false,
    status: 'online',
    createdAt: '2024-03-10T10:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
  };

  const hardwareGeek: UserRecord = {
    id: 'user_hwgeek',
    username: 'HardwareGeek',
    email: 'hwgeek@nexusgaming.com',
    password: memberPasswordHash,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=hw1',
    bio: 'Overclocking enthusiast. 144Hz is my baseline, 4K is my destination.',
    role: 'member',
    level: levelFromXp(6800),
    xp: 6800,
    xpNeeded: levelRange(levelFromXp(6800)).end,
    karma: 1540,
    badges: ['first_post', 'helpful'],
    connectedAccounts: {
      steam: 'HardwareGeek',
    },
    isVerified: true,
    isBanned: false,
    status: 'online',
    createdAt: '2024-06-01T09:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
  };

  const techMaster: UserRecord = {
    id: 'user_techm',
    username: 'TechMaster99',
    email: 'techmaster@nexusgaming.com',
    password: memberPasswordHash,
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=tech1',
    bio: 'Custom loop watercooling and custom keycaps. Day-job sysadmin.',
    role: 'member',
    level: levelFromXp(9900),
    xp: 9900,
    xpNeeded: levelRange(levelFromXp(9900)).end,
    karma: 2890,
    badges: ['helpful', 'veteran'],
    connectedAccounts: {
      steam: 'TechMaster99',
      discord: 'TechMaster#4040',
    },
    isVerified: true,
    isBanned: false,
    status: 'away',
    createdAt: '2024-04-12T14:30:00.000Z',
    lastSeenAt: new Date().toISOString(),
  };

  if (adminPasswordHash) {
    admin.badges = ['founder', 'contributor', 'expert', 'veteran', 'early_bird'];
  }

  const seedUsers = adminPasswordHash
    ? [admin, neuro, hardwareGeek, techMaster]
    : [neuro, hardwareGeek, techMaster];

  for (const u of seedUsers) {
    // Tačna provera bez wildcardsa (username_lower = lower(trim(username)))
    let existing = await db.users.findByUsername(u.username);

    // N-03 — ručno kreiran `nexus_admin` (npr. iz ranijeg seed-a pokrenutog bez
    // `SEED_ADMIN_PASSWORD`) nikad nije imao lozinku. Kada je lozinka sada
    // postavljena, postavi je — inače je admin nalog i dalje neupotrebljiv.
    if (existing && adminPasswordHash && u.role === 'admin' && !existing.password) {
      await db.users
        .update(existing.id, { password: adminPasswordHash })
        .catch((err) => logger.warn({ err }, '[seed] admin lozinka nije upisana'));
      existing = (await db.users.findById(existing.id)) ?? existing;
    }

    if (existing) {
      // Uskladi ID tako da reference (teme, članci) pokazuju na postojeći red
      u.id = existing.id;
      // N-03 — idempotentno dopuni demo podatke (bedževi, bio, verifikacija):
      // stari red admina iz schema.sql je često bez `is_verified`/bedževa, pa
      // profil i /admin izgledaju prazno iako su podaci stigli.
      const patch: Partial<UserRecord> = {};
      if (!existing.role) patch.role = u.role;
      if (!existing.badges?.length) patch.badges = u.badges;
      if (!existing.isVerified) patch.isVerified = true;
      if (!existing.bio) patch.bio = u.bio;
      if (Object.keys(patch).length) {
        await db.users.update(u.id, patch).catch((err) => {
          logger.warn({ err }, '[seed] user patch nije uspeo');
        });
      }
      continue;
    }
    const createdUser = await db.users.create(u);
    u.id = createdUser.id;
    created.users += 1;
  }

  // 2. Članci za portal — 8 članaka u 4 kategorije (Vesti, Hardware, Najave, Recenzija),
  //    pa svaka stranica /category/:name ima sadržaj.
  // Bez admin naloga (nema SEED_ADMIN_PASSWORD) članci pripadaju moderatoru.
  const owner = adminPasswordHash ? admin : neuro;

  const articles: ArticleRecord[] = [
    {
      id: 'art_1',
      slug: 'cyberpunk-2077-phantom-liberty-analiza',
      title: 'Cyberpunk 2077: Phantom Liberty DLC stiže sa revolucionarnim promenama',
      excerpt: 'CD Projekt Red najavljuje ekspanziju koja će zauvek promeniti Night City — od policijskog 2.0 sistema do vehicular borbe.',
      content: `Night City nikada nije izgledala ovako realno. CD Projekt Red najavljuje ekspanziju koja će zauvek promeniti Cyberpunk 2077.

## Phantom Liberty — Nova era Night Cityja

Nakon dugotrajnih nadogradnji, CD Projekt Red otkriva svoju ključnu ekspanziju za Cyberpunk 2077. Phantom Liberty nije samo novi paket misija već temeljni redizajn brojnih core mehanika.

### Ključne novine ekspanzije:

- **Dogtown**: Nova izolovana četvrt pod kontrolom paravojne grupe Barghest sa preko 15 sati originalne priče.
- **Policijski sistem 2.0**: Adaptivni AI, nivoi potere i barikade koje reaguju na vaš stil igranja.
- **Vehicular Combat**: Pucanje kroz prozore, mounted mitraljezi i lanseri raketa na vozilima.
- **Novo Relic stablo veština**: Cyberware nadogradnje sa jedinstvenim borbenim perk-ovima.

### Tehnički skok

Phantom Liberty je građen sa ray tracing i path tracing tehnologijama u fokusu:
- RTX 40/50 serija donosi DLSS 3.5 Ray Reconstruction
- DirectStorage podrška za trenutno učitavanje tekstura
- Minimalno 16GB DDR4/DDR5 i NVMe SSD postaju standard

*Ocena redakcije: 9.5 / 10 — Definitivno izdanje Night Cityja.*`,
      coverImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&q=80',
      authorId: neuro.id,
      author: neuro.username,
      category: 'Vesti',
      tags: ['Cyberpunk', 'RPG', 'CDPR', 'Ray Tracing'],
      status: 'published',
      isFeatured: true,
      views: 12400,
      reactions: { like: 342, gg: 189, hype: 420, fire: 98, mind_blown: 67 },
      publishedAt: '2026-10-15T10:00:00.000Z',
      createdAt: '2026-10-15T09:30:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    },
    {
      id: 'art_2',
      slug: 'nvidia-rtx-5090-ti-benchmark-rezultati',
      title: 'NVIDIA RTX 5090 Ti: Benchmark rezultati otkrivaju neverovatne performanse',
      excerpt: 'Nova Blackwell arhitektura donosi preko 70% skok u path tracing scenarijima uz GDDR7 memorijski propusni opseg.',
      content: `Prva serija sintetičkih i real-world benchmark testova za NVIDIA vodeću grafičku kartu donosi impresivne brojeve.

U rezoluciji 4K sa punim path tracingom, RTX 5090 Ti bez ikakvog upscalinga postiže stabilnih 85+ frejmova u sekundi u Cyberpunku i Alan Wake 2.

GDDR7 memorija pruža 1.8 TB/s propusnog opsega, što eliminiše svako VRAM usko grlo pri 4K/8K renderingu i modeliranju.`,
      coverImage: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=1200&q=80',
      authorId: owner.id,
      author: owner.username,
      category: 'Hardware',
      tags: ['GPU', 'Nvidia', 'RTX', 'Benchmark'],
      status: 'published',
      isFeatured: true,
      views: 8900,
      reactions: { like: 215, gg: 88, hype: 310, fire: 145, mind_blown: 112 },
      publishedAt: '2026-10-14T14:00:00.000Z',
      createdAt: '2026-10-14T13:00:00.000Z',
      updatedAt: '2026-10-14T14:00:00.000Z',
    },
    {
      id: 'art_3',
      slug: 'elden-ring-2-fromsoftware-najava',
      title: 'Elden Ring 2: FromSoftware potvrđuje razvoj nastavka Lands Between sage',
      excerpt: 'Miyazaki obećava još kompleksniju i vertikalniju mapu, novu magijsku školu i kooperativni sistem bez prekida.',
      content: `FromSoftware je zvanično potvrdio da radi na direktnom nastavku Elden Ringa.

Prema rečima Hidetake Miyazakija, nastavak se fokusira na ranije neistražene kosmičke entitete izvan Lands Between-a, sa još većim stepenom vertikalnosti u dizajnu dvoraca i podzemnih svetova.`,
      coverImage: 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1200&q=80',
      authorId: neuro.id,
      author: neuro.username,
      category: 'Najave',
      tags: ['Elden Ring', 'FromSoftware', 'Soulsborne', 'RPG'],
      status: 'published',
      isFeatured: true,
      views: 15600,
      reactions: { like: 890, gg: 420, hype: 1240, fire: 310, mind_blown: 450 },
      publishedAt: '2026-10-13T16:00:00.000Z',
      createdAt: '2026-10-13T15:00:00.000Z',
      updatedAt: '2026-10-13T16:00:00.000Z',
    },
    {
      id: 'art_4',
      slug: 'top-10-indie-igara-2026',
      title: 'Top 10 indie igara koje morate isprobati u 2026. godini',
      excerpt: 'Od piksel art metroidvania do psiholoških sci-fi zagonetki — ovo su mali dragulji koji zaslužuju vašu punu pažnju.',
      content: `Godina 2026. donosi procvat nezavisnih razvojnih timova. Izdvajamo 10 naslova koji inovacijama nadmašuju AAA industriju.`,
      coverImage: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&q=80',
      authorId: neuro.id,
      author: neuro.username,
      category: 'Lista',
      tags: ['Indie', 'PC', 'Preporuke'],
      status: 'published',
      isFeatured: false,
      views: 5400,
      reactions: { like: 120, gg: 45, hype: 95, fire: 22, mind_blown: 18 },
      publishedAt: '2026-10-12T11:00:00.000Z',
      createdAt: '2026-10-12T10:00:00.000Z',
      updatedAt: '2026-10-12T11:00:00.000Z',
    },
    {
      id: 'art_5',
      slug: 'tekken-8-season-3-balans-patch',
      title: 'Tekken 8: Sezona 3 donosi balans patch i novog borca',
      excerpt: 'Bandai Namco menja sistem heat napada, dodaje trening mod za ranked i najavljuje lika koji fanovi traže od 2019.',
      content: `Tekken 8 ulazi u treću sezonu sa najvećim balans paketom do sada.

Smanjuje se „heat smash“ damage, a ranked sistem dobija zaštitu od smurf naloga. Novi borac stiže u zimskom patchu.`,
      coverImage: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1200&q=80',
      authorId: hardwareGeek.id,
      author: hardwareGeek.username,
      category: 'Vesti',
      tags: ['Tekken', 'Fighting', 'Bandai Namco'],
      status: 'published',
      isFeatured: false,
      views: 4300,
      reactions: { like: 98, gg: 34, hype: 76, fire: 21, mind_blown: 12 },
      publishedAt: '2026-10-11T09:00:00.000Z',
      createdAt: '2026-10-11T08:30:00.000Z',
      updatedAt: '2026-10-11T09:00:00.000Z',
    },
    {
      id: 'art_6',
      slug: 'ddr5-8400-memory-overclocking-vodic',
      title: 'DDR5 na 8400 MT/s: Koliko zapravo dobijate u igrama?',
      excerpt: 'Testirali smo 12 kitova memorije na Intel i AMD platformama — razlika između CL30 i CL38 je manja nego što marketing tvrdi.',
      content: `Brzina memorije je godinama „besplatni FPS“, ali sa DDR5-8000+ granica se pomera.

Zaključak: za 1440p i više GPU je i dalje presudan; u 1080p e-sport naslovima 6000 CL30 je najbolji odnos cene i performansi.`,
      coverImage: 'https://images.unsplash.com/photo-1541029071515-84cc54f84dc5?w=1200&q=80',
      authorId: techMaster.id,
      author: techMaster.username,
      category: 'Hardware',
      tags: ['RAM', 'DDR5', 'Overclocking', 'Benchmark'],
      status: 'published',
      isFeatured: false,
      views: 6100,
      reactions: { like: 143, gg: 52, hype: 88, fire: 30, mind_blown: 41 },
      publishedAt: '2026-10-10T12:00:00.000Z',
      createdAt: '2026-10-10T11:00:00.000Z',
      updatedAt: '2026-10-10T12:00:00.000Z',
    },
    {
      id: 'art_7',
      slug: 'gta-6-odlozeno-na-jesen-2026',
      title: 'GTA 6 zvanično odložen za jesen 2026 — šta to znači za industriju',
      excerpt: 'Rockstar potvrđuje odlaganje. Analiziramo uticaj na konkurenciju, konzole i tržište akcija.',
      content: `Rockstar je potvrdio novi datum izlaska GTA 6.

Ostali izdavači uglavnom pomeraju svoje naslove dalje od datuma, a analitičari očekuju rekordan prihod na lansiranju.`,
      coverImage: 'https://images.unsplash.com/photo-1493711662062-fa541adb3fc8?w=1200&q=80',
      authorId: neuro.id,
      author: neuro.username,
      category: 'Najave',
      tags: ['GTA 6', 'Rockstar', 'PC', 'Konzole'],
      status: 'published',
      isFeatured: true,
      views: 22100,
      reactions: { like: 1200, gg: 410, hype: 2100, fire: 540, mind_blown: 320 },
      publishedAt: '2026-10-09T15:00:00.000Z',
      createdAt: '2026-10-09T14:00:00.000Z',
      updatedAt: '2026-10-09T15:00:00.000Z',
    },
    {
      id: 'art_8',
      slug: 'recenzija-silent-hill-2-remake',
      title: 'Recenzija: Silent Hill 2 Remake — horor koji i dalje zna da zaboli',
      excerpt: 'Bloober Team je uspeo da sačuva atmosferu originala uz modernu kameru i borbu. Ocena: 9/10.',
      content: `Remake Silent Hill 2 nije samo grafički remaster.

Atmosfera je zadržana zahvaljujući odličnom zvuku i novoj kameri iz trećeg lica, a borba je dobila težinu. Minus: tehnički problemi pri prvom izlasku.`,
      coverImage: 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=1200&q=80',
      authorId: neuro.id,
      author: neuro.username,
      category: 'Recenzija',
      tags: ['Silent Hill', 'Horor', 'PS5', 'PC'],
      status: 'published',
      isFeatured: false,
      views: 9700,
      reactions: { like: 410, gg: 120, hype: 260, fire: 88, mind_blown: 95 },
      publishedAt: '2026-10-08T10:00:00.000Z',
      createdAt: '2026-10-08T09:00:00.000Z',
      updatedAt: '2026-10-08T10:00:00.000Z',
    },
  ];

  for (const a of articles) {
    if (await db.articles.findBySlug(a.slug)) continue;
    await db.articles.create(a);
    created.articles += 1;
  }

  // 3. Forum teme
  const t1: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'hardware',
    title: 'Da li vredi kupiti RTX 5080 ili čekati 5090?',
    content: `Pozdrav ekipo! 🎮

Planiram da nadogradim grafičku karticu i trenutno sam na RTX 3080. Budžet mi je oko 1500€ i razmišljam između RTX 5080 koja je već dostupna i čekanja na RTX 5090 koja stiže za par meseci.

**Moja konfiguracija:**
- CPU: Ryzen 9 7950X
- RAM: 32GB DDR5-6000
- Monitor: 4K 144Hz

Da li mislite da vredi čekati 5090 sa 24GB VRAM-a za dugoročni 4K gaming?`,
    author: hardwareGeek.username,
    authorId: hardwareGeek.id,
    tags: ['Grafičke', 'Kupovina', 'Nvidia', 'Savet'],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    karma: 145,
    views: 3412,
    replies: 0,
    createdAt: '2026-10-17T08:00:00.000Z',
    lastReplyAt: '2026-10-17T09:15:00.000Z',
  };

  const t2: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'pc-gaming',
    title: '[MEGA THREAD] Elden Ring 2 — Sve što znamo do sada',
    content: `Zvanična zbirka svih najava, intervjua i procurelih detalja o Elden Ring 2 projektu. Pravila teme: koristite [spoiler] tagove za sve leak-ovane detalje o priči!`,
    author: owner.username,
    authorId: owner.id,
    tags: ['Elden Ring', 'FromSoftware', 'Mega Thread'],
    isPinned: true,
    isLocked: false,
    isSpoiler: false,
    karma: 892,
    views: 28900,
    // `reply_count` u bazi drži trigger — seed ne sme da napiše izmišljen broj.
    replies: 0,
    createdAt: '2026-10-14T10:00:00.000Z',
    lastReplyAt: '2026-10-17T11:00:00.000Z',
  };

  const t3: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'lfg',
    title: '[LFG] Traže se 2 igrača za Destiny 2 / Helldivers 2 večernje raidove',
    content: `Igramo redovno od 20h do 23h, opuštena atmosfera, Discord obavezan. Javite se ovde ili me dodajte na Steamu!`,
    author: techMaster.username,
    authorId: techMaster.id,
    tags: ['LFG', 'Helldivers', 'Destiny', 'Co-op'],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    karma: 48,
    views: 890,
    replies: 0,
    createdAt: '2026-10-16T18:00:00.000Z',
    lastReplyAt: '2026-10-17T07:30:00.000Z',
  };

  created.games = await seedGames(db);

  const t4: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'consoles',
    title: 'PS5 Pro vs Xbox Series X — za šta se isplati u 2026?',
    content: `Planiram da pređem sa PS4 na nešto novo. Gledam PS5 Pro i Series X — koja konzola bolje drži 60fps posle tri godine od izlaska?

Bitna mi je i biblioteka ekskluziva (volim single-player).`,
    author: neuro.username,
    authorId: neuro.id,
    tags: ['PS5', 'Xbox', 'Konzole', 'Savet'],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    karma: 74,
    views: 2100,
    replies: 0,
    createdAt: '2026-10-15T12:00:00.000Z',
    lastReplyAt: '2026-10-15T12:00:00.000Z',
  };

  const t5: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'esports',
    title: 'VCT 2026 — prognoze za playoff fazu',
    content: `Ko je vaš favorit ovogodišnjeg VCT-a? Bracket je izuzetno težak — pišite svoje top 4 i objašnjenje.`,
    author: techMaster.username,
    authorId: techMaster.id,
    tags: ['Esports', 'Valorant', 'VCT'],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    karma: 36,
    views: 740,
    replies: 0,
    createdAt: '2026-10-16T09:00:00.000Z',
    lastReplyAt: '2026-10-16T09:00:00.000Z',
  };

  const t6: ThreadRecord = {
    id: crypto.randomUUID(),
    subforum: 'off-topic',
    title: 'Koja vam je najbolja gaming postavka pod 1000€?',
    content: `Sastavljam radni/gaming sto iz početka. Slike i specifikacije dobrodošle — monitor, periferije i rasveta u cenu.`,
    author: hardwareGeek.username,
    authorId: hardwareGeek.id,
    tags: ['Setup', 'Periferije', 'Off-Topic'],
    isPinned: false,
    isLocked: false,
    isSpoiler: false,
    karma: 22,
    views: 560,
    replies: 0,
    createdAt: '2026-10-17T10:00:00.000Z',
    lastReplyAt: '2026-10-17T10:00:00.000Z',
  };

  // N-03 — 6 tema u 4 subforuma (hardware, pc-gaming, lfg, consoles, esports, off-topic).
  for (const t of [t1, t2, t3, t4, t5, t6]) {
    // Supabase generiše UUID, pa je deduplikacija po naslovu. Uvek uskladi
    // `t.id` sa stvarnim ID-jem u bazi (odgovori referenciraju thread_id).
    const existing = (await db.forum.listThreads()).find((item) => item.title === t.title);
    if (existing) {
      t.id = existing.id;
      continue;
    }
    const createdThread = await db.forum.createThread(t);
    t.id = createdThread.id;
    created.threads += 1;
  }

  // 4. Odgovori na temu 101
  const r1: ReplyRecord = {
    id: crypto.randomUUID(),
    threadId: t1.id,
    parentId: null,
    author: techMaster.username,
    authorId: techMaster.id,
    content: 'Imam RTX 5080 već dve nedelje i u 4K sa DLSS Quality sve radi na 90+ FPS bez štucanja. Ako ti se ne daje još 600€ preko, 5080 je odlična kupovina.',
    karma: 42,
    isSpoiler: false,
    createdAt: '2026-10-17T08:30:00.000Z',
  };

  const r2: ReplyRecord = {
    id: crypto.randomUUID(),
    threadId: t1.id,
    parentId: r1.id,
    author: hardwareGeek.username,
    authorId: hardwareGeek.id,
    content: 'Hvala na odgovoru! Da li si primetio da prelazi preko 16GB VRAM-a u najtežim igrama sa modovima?',
    karma: 8,
    isSpoiler: false,
    createdAt: '2026-10-17T08:45:00.000Z',
  };

  const r3: ReplyRecord = {
    id: crypto.randomUUID(),
    threadId: t1.id,
    parentId: null,
    author: owner.username,
    authorId: owner.id,
    content: 'Moj savet: ako radiš sa 3D renderingom ili modovanjem sa 4K teksturama, sačekaj 5090 zbog 24GB. Za čisto igranje, 5080 je više nego dovoljan.',
    karma: 67,
    isSpoiler: false,
    createdAt: '2026-10-17T09:15:00.000Z',
  };

  // Deduplikacija po (tema, autor, sadržaj) — radi i kada je id UUID.
  // `threadId` se upisuje uvek (stari kod je ostavljao `crypto.randomUUID()`
  // iz seed-a, što je u Supabase-u pucalo na FK ka nepostojećoj temi).
  for (const r of [r1, r2, r3]) {
    r.threadId = t1.id;
    const existingReplies = await db.forum.listReplies(r.threadId);
    // c2 je odgovor na c1: parentId mora biti UUID zapisa koji zaista postoji
    r.parentId = r.parentId && existingReplies.some((reply) => reply.id === r.parentId) ? r.parentId : null;
    const existing = existingReplies.some(
      (reply) => reply.author === r.author && reply.content === r.content,
    );
    if (existing) continue;
    const createdReply = await db.forum.createReply(r);
    // Sledeći odgovori (r2 → r1) koriste stvarni ID iz baze
    if (r === r1) r2.parentId = createdReply.id;
    created.replies += 1;
  }

  // 5. Newsletter seed
  await db.newsletter.subscribe('member1@gaming.rs');
  await db.newsletter.subscribe('esports.fan@nexus.com');

  // 6. Deals (2.6.0) — 3 demo deal-a + 3 igre (i u Supabase razvojnoj bazi, da
  //    /deals i /games nisu prazni posle seed-a).
  created.deals = await seedDeals(db, [neuro, hardwareGeek, techMaster]);

  const summary = Object.entries(created)
    .map(([key, value]) => `${key}: +${value}`)
    .join(', ');
  logger.info(`NEXUS seed (${db.kind}) — ${summary}`);
}

/**
 * N-03 — katalog igara za demo. `/deals` i `/games` grupišu deal-ove po
 * `game_id`, pa bez igara Game Page i kartice nemaju šta da prikažu.
 * Idempotentno: `upsert` po `slug`-u.
 */
async function seedGames(db: DataLayer): Promise<number> {
  const catalog = [
    {
      slug: 'elden-ring',
      title: 'Elden Ring',
      coverUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg',
      releaseDate: '2022-02-25',
      igdbId: null,
    },
    {
      slug: 'cyberpunk-2077',
      title: 'Cyberpunk 2077',
      coverUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg',
      releaseDate: '2020-12-10',
      igdbId: null,
    },
    {
      slug: 'god-of-war-ragnarok',
      title: 'God of War Ragnarök',
      coverUrl: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2322010/header.jpg',
      releaseDate: '2022-11-09',
      igdbId: null,
    },
  ];

  let count = 0;
  for (const game of catalog) {
    try {
      if (!(await db.games.findBySlug(game.slug))) count += 1;
      await db.games.upsert(game);
    } catch (err) {
      logger.warn({ err, slug: game.slug }, '[seed] igra nije upisana');
    }
  }
  return count;
}

/** Demo deal-ovi za lokalni razvoj — upisuju se u bilo kom režimu (dev seed). */
async function seedDeals(db: DataLayer, authors: UserRecord[]): Promise<number> {
  if (!authors.length) return 0;

  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const drafts: Array<Omit<DealRecord, 'id' | 'authorId' | 'author' | 'createdAt' | 'updatedAt' | 'discountPct'> & { gameSlug: string; gameTitle: string; days: number }> = [
    {
      title: 'Elden Ring: Shadow of the Erdtree — kompletno izdanje',
      url: 'https://store.steampowered.com/app/2778580/',
      proofUrl: null,
      price: 34.99,
      originalPrice: 59.99,
      currency: 'EUR',
      store: 'Steam',
      platform: 'pc',
      description: 'Base igra + expansion, isti ključ. Akcija traje do kraja nedelje.',
      expiresAt: inDays(3),
      status: 'active',
      isVerified: true,
      score: 14,
      myVote: undefined,
      gameId: null,
      gameSlug: 'elden-ring',
      gameTitle: 'Elden Ring',
      gameCover: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/header.jpg',
      days: 1,
    },
    {
      title: 'Cyberpunk 2077: Ultimate Edition',
      url: 'https://www.gog.com/en/game/cyberpunk_2077_ultimate_edition',
      proofUrl: null,
      price: 29.99,
      originalPrice: 69.99,
      currency: 'EUR',
      store: 'GOG',
      platform: 'pc',
      description: 'DRM-free, uključuje Phantom Liberty.',
      expiresAt: inDays(6),
      status: 'active',
      isVerified: false,
      score: 9,
      myVote: undefined,
      gameId: null,
      gameSlug: 'cyberpunk-2077',
      gameTitle: 'Cyberpunk 2077',
      gameCover: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg',
      days: 2,
    },
    {
      title: 'God of War Ragnarök — PS5',
      url: 'https://store.playstation.com/en-us/product/UP9000-PPSA08329_00-GOWRAGNAROK00000',
      proofUrl: null,
      price: 39.99,
      originalPrice: 69.99,
      currency: 'USD',
      store: 'PlayStation Store',
      platform: 'playstation',
      description: 'Digital Deluxe je isto na akciji.',
      expiresAt: inDays(10),
      status: 'active',
      isVerified: false,
      score: 6,
      myVote: undefined,
      gameId: null,
      gameSlug: 'god-of-war-ragnarok',
      gameTitle: 'God of War Ragnarök',
      gameCover: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2322010/header.jpg',
      days: 3,
    },
  ];

  let count = 0;
  // Idempotentno po naslovu: delimično popunjen seed ne duplira postojeće deal-ove.
  const existing = await db.deals.list({ includeExpired: true, limit: 500 });
  const titles = new Set(existing.deals.map((deal) => deal.title));

  for (let index = 0; index < drafts.length; index += 1) {
    const { gameSlug, gameTitle, days, gameCover, ...draft } = drafts[index];
    if (titles.has(draft.title)) continue;
    const author = authors[index % authors.length];
    const game = await db.games.upsert({
      slug: gameSlug,
      title: gameTitle,
      coverUrl: gameCover,
      releaseDate: null,
      igdbId: null,
    });
    const now = new Date(Date.now() - days * 86_400_000).toISOString();
    try {
      await db.deals.create({
        ...draft,
        // Supabase generiše UUID; memory režim dobija čitljiv ID.
        id: db.kind === 'memory' ? `deal_${gameSlug}` : crypto.randomUUID(),
        authorId: author.id,
        author: author.username,
        gameId: game.id,
        gameSlug: game.slug,
        gameTitle: game.title,
        gameCover: game.coverUrl,
        discountPct: computeDiscountPct(draft.price, draft.originalPrice),
        createdAt: now,
        updatedAt: now,
      });
      count += 1;
    } catch (err) {
      logger.warn({ err, slug: gameSlug }, '[seed] deal nije upisan');
    }
  }
  return count;
}
