/**
 * KATALOG BEDŽEVA — jedini izvor istine na frontendu.
 *
 * Kodovi moraju da se poklapaju sa `server/schema-2.5.1.sql` (tabela `badges`)
 * i sa `evaluateBadges()` u `server/lib/gamification.ts`. Ranije su frontend
 * (`founder`, `legend`) i server (`influencer`, `veteran`) imali različite
 * kataloge, pa se polovina bedževa prikazivala kao nepoznata.
 */

export type BadgeRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BadgeDefinition {
  id: string;
  name: string;
  /** Kratak opis uslova (identičan SQL opisu). */
  desc: string;
  /** Lucide ikonica. */
  icon: BadgeIconName;
  rarity: BadgeRarity;
  /** Kako se bedž dobija — prikazuje se u katalogu. */
  how: string;
}

export type BadgeIconName =
  | 'sparkles'
  | 'message-square'
  | 'star'
  | 'target'
  | 'hand-heart'
  | 'users'
  | 'medal'
  | 'flame'
  | 'crown';

export const BADGE_RARITY_LABELS: Record<BadgeRarity, string> = {
  common: 'Čest',
  uncommon: 'Neuobičajen',
  rare: 'Redak',
  epic: 'Epski',
  legendary: 'Legendaran',
};

export const BADGES: BadgeDefinition[] = [
  {
    id: 'first_post',
    name: 'Prva objava',
    desc: 'Objavite prvu temu ili odgovor',
    icon: 'message-square',
    rarity: 'common',
    how: 'Napišite prvu poruku na forumu.',
  },
  {
    id: 'helpful',
    name: 'Pomoćnik',
    desc: 'Napišite 25 odgovora',
    icon: 'hand-heart',
    rarity: 'uncommon',
    how: 'Pomozite drugima u 25 odgovora.',
  },
  {
    id: 'contributor',
    name: 'Kontributor',
    desc: 'Otvorite 10 tema',
    icon: 'star',
    rarity: 'rare',
    how: 'Otvorite deset diskusija.',
  },
  {
    id: 'expert',
    name: 'Ekspert',
    desc: 'Dostignite 500 karme',
    icon: 'target',
    rarity: 'rare',
    how: 'Sakupite 500 karme od glasova zajednice.',
  },
  {
    id: 'influencer',
    name: 'Influenser',
    desc: 'Povežite 4 gaming naloga',
    icon: 'users',
    rarity: 'epic',
    how: 'Povežite Steam, Discord, Twitch i još jedan nalog.',
  },
  {
    id: 'veteran',
    name: 'Veteran',
    desc: 'Dostignite 5.000 XP',
    icon: 'medal',
    rarity: 'epic',
    how: 'Provedite vreme u zajednici i skupite 5.000 XP.',
  },
  {
    id: 'founder',
    name: 'Osnivač',
    desc: 'Među prvim članovima zajednice',
    icon: 'crown',
    rarity: 'legendary',
    how: 'Dodeljuje se ručno (osnivači i osoblje portala).',
  },
  {
    id: 'legend',
    name: 'Legenda',
    desc: 'Posebno dodeljeno dostignuće',
    icon: 'flame',
    rarity: 'legendary',
    how: 'Dodeljuje administracija za vanredan doprinos.',
  },
  {
    id: 'article_commenter',
    name: 'Čitač sa mišljenjem',
    desc: 'Komentarišite 5 članaka',
    icon: 'message-square',
    rarity: 'rare',
    how: 'Napišite pet komentara na člancima portala.',
  },
  {
    id: 'streak_keeper',
    name: 'Čuvar niza',
    desc: '7 dana prijave zaredom',
    icon: 'flame',
    rarity: 'rare',
    how: 'Prijavite se svaki dan sedam dana zaredom.',
  },
  {
    id: 'level_10',
    name: 'Veteran nivoa',
    desc: 'Dostignite nivo 10',
    icon: 'medal',
    rarity: 'epic',
    how: 'Razvijajte nalog kroz aktivnost dok ne dostignete nivo 10.',
  },
  // 3.0.0 — sistemski bedževi (dodeljuje administracija). Bez ovih definicija
  // `BadgeChip` vraća `null`, pa korisnik sa dodeljenim bedžom nije video ništa.
  {
    id: 'beta-tester',
    name: 'Beta tester',
    desc: 'Rano testiranje platforme',
    icon: 'sparkles',
    rarity: 'uncommon',
    how: 'Dodeljuje administracija učesnicima zatvorene bete.',
  },
  {
    id: 'tournament-winner',
    name: 'Šampion turnira',
    desc: 'Pobeda na NEXUS turniru',
    icon: 'crown',
    rarity: 'legendary',
    how: 'Dodeljuje administracija pobedniku turnira.',
  },
  {
    id: 'vip-supporter',
    name: 'VIP pretplatnik',
    desc: 'Podrška zajednici',
    icon: 'hand-heart',
    rarity: 'rare',
    how: 'Dodeljuje administracija donatorima i pretplatnicima.',
  },
  {
    id: 'content-creator',
    name: 'Kreator sadržaja',
    desc: 'Gaming sadržaj u ime portala',
    icon: 'star',
    rarity: 'epic',
    how: 'Dodeljuje administracija kreatorima koji sarađuju sa portalom.',
  },
  {
    id: 'community-mvp',
    name: 'MVP zajednice',
    desc: 'Poseban doprinos zajednici',
    icon: 'target',
    rarity: 'epic',
    how: 'Dodeljuje administracija za izuzetan doprinos zajednici.',
  },
  {
    id: 'hardware-guru',
    name: 'Hardver guru',
    desc: 'Stručnost u hardveru i build-ovima',
    icon: 'users',
    rarity: 'rare',
    how: 'Dodeljuje administracija autorima pouzdanih build-ova i saveta.',
  },
];

export const BADGE_MAP: Record<string, BadgeDefinition> = Object.fromEntries(
  BADGES.map((badge) => [badge.id, badge]),
);

export function getBadge(id: string): BadgeDefinition | undefined {
  return BADGE_MAP[id];
}
