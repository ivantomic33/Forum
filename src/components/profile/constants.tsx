import type { ReactNode } from 'react';

/** Zajednicke definicije profila (platforme, bedževi, avatari). */

export const GAMING_PLATFORMS = [
  { id: 'steam', name: 'Steam', tag: 'PC', accent: '#8b9bb4' },
  { id: 'discord', name: 'Discord', tag: 'Voice & Chat', accent: '#8b9bb4' },
  { id: 'youtube', name: 'YouTube', tag: 'Highlights', accent: '#c45c5c' },
  { id: 'twitch', name: 'Twitch', tag: 'Livestream', accent: '#d4a017' },
  { id: 'epic', name: 'Epic Games', tag: 'Store', accent: '#8b9bb4' },
  { id: 'riot', name: 'Riot Games', tag: 'Valorant / LoL', accent: '#c45c5c' },
];

/** Katalog bedževa je deljen sa serverom — vidi `src/lib/badges.ts`. */
export { BADGES, BADGE_MAP, getBadge } from '../../lib/badges';

export const PRESET_AVATARS = [
  'nexus_admin', 'NeuroGamer', 'HardwareGeek', 'TechMaster99',
  'CyberSamurai', 'PixelHero', 'Vanguard', 'ShadowSniper',
];

/** Skeletonski prikaz hero kartice (loading). */
export function ProfileHeroSkeleton() {
  return (
    <section className="profile-hero" aria-busy="true">
      <span className="sr-only">Ucitavanje profila…</span>
      <div className="ui-skeleton profile-cover !rounded-none" />
      <div className="space-y-3 px-5 pb-6 pt-0 sm:px-6 md:px-8">
        <div className="-mt-12 flex items-end gap-5">
          <div className="ui-skeleton h-24 w-24 rounded-[22px] border-4 border-surface-1 sm:h-[124px] sm:w-[124px]" />
          <div className="space-y-2 pb-2">
            <div className="ui-skeleton h-7 w-48" />
            <div className="ui-skeleton h-4 w-64 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="ui-skeleton h-16 rounded-xl" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function StatChip({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="profile-stat-cell">
      <span className="profile-stat-cell-icon">{icon}</span>
      <div className="flex flex-col leading-tight">
        <span className="profile-stat-cell-value">{value}</span>
        <span className="profile-stat-cell-label">{label}</span>
      </div>
    </div>
  );
}
