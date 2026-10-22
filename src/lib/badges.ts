/**
 * KATALOG BEDÅ½EVA — jedini izvor istine na frontendu.
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
];

export const BADGE_MAP: Record<string, BadgeDefinition> = Object.fromEntries(
  BADGES.map((badge) => [badge.id, badge]),
);

export function getBadge(id: string): BadgeDefinition | undefined {
  return BADGE_MAP[id];
}
