import {
  Crown, Flame, HandHeart, Medal, MessageSquare, Sparkles, Star, Target, Users, type LucideIcon,
} from 'lucide-react';
import { BADGE_RARITY_LABELS, getBadge, type BadgeIconName, type BadgeRarity } from '../../lib/badges';
import { cn } from './cn';

const BADGE_ICONS: Record<BadgeIconName, LucideIcon> = {
  sparkles: Sparkles,
  'message-square': MessageSquare,
  star: Star,
  target: Target,
  'hand-heart': HandHeart,
  users: Users,
  medal: Medal,
  flame: Flame,
  crown: Crown,
};

/**
 * Boje po retkosti — „Obsidian Cyber-Pulse“ escalacija:
 * slate → emerald → cyan → violet → cyber rose/prestige.
 */
export const RARITY_STYLES: Record<BadgeRarity, { ring: string; text: string; glow: string; label: string }> = {
  common: {
    ring: 'border-white/12 bg-white/[0.03]',
    text: 'text-slate-400',
    glow: 'rgba(148, 163, 184, 0.25)',
    label: BADGE_RARITY_LABELS.common,
  },
  uncommon: {
    ring: 'border-emerald-500/35 bg-emerald-500/[0.08]',
    text: 'text-emerald-300',
    glow: 'rgba(16, 185, 129, 0.35)',
    label: BADGE_RARITY_LABELS.uncommon,
  },
  rare: {
    ring: 'border-cyan-500/40 bg-cyan-500/[0.08]',
    text: 'text-cyan-300',
    glow: 'rgba(6, 182, 212, 0.4)',
    label: BADGE_RARITY_LABELS.rare,
  },
  epic: {
    ring: 'border-violet-500/45 bg-violet-500/[0.1]',
    text: 'text-violet-300',
    glow: 'rgba(139, 92, 246, 0.45)',
    label: BADGE_RARITY_LABELS.epic,
  },
  legendary: {
    ring: 'border-rose-500/55 bg-gradient-to-r from-rose-500/[0.14] to-violet-600/[0.14]',
    text: 'text-rose-200',
    glow: 'rgba(244, 63, 94, 0.5)',
    label: BADGE_RARITY_LABELS.legendary,
  },
};

export function BadgeIcon({ name, size = 16 }: { name: BadgeIconName; size?: number }) {
  const Icon = BADGE_ICONS[name] ?? Sparkles;
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * Bedž sa animiranim sjajem (retkost >= rare). Animacija se isključuje
 * globalnim `prefers-reduced-motion` pravilom u `index.css`.
 */
export function BadgeChip({
  id,
  size = 'sm',
  showRarity = false,
  hideLabel = false,
  className,
}: {
  id: string;
  size?: 'xs' | 'sm' | 'md';
  showRarity?: boolean;
  /** Prikazuje samo ikonicu (naziv i retkost daje roditelj). */
  hideLabel?: boolean;
  className?: string;
}) {
  const badge = getBadge(id);
  if (!badge) return null;
  const style = RARITY_STYLES[badge.rarity];
  const animated = badge.rarity === 'rare' || badge.rarity === 'epic' || badge.rarity === 'legendary';
  const iconSize = size === 'xs' ? 12 : size === 'md' ? 18 : 14;

  return (
    <span
      title={`${badge.name} — ${badge.desc}`}
      className={cn(
        'badge-chip inline-flex items-center gap-1.5 rounded-[6px] border font-medium',
        size === 'xs' && 'px-2 py-0.5 text-[11px]',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-sm',
        style.ring,
        style.text,
        animated && 'badge-chip-animated',
        className,
      )}
      style={animated ? ({ '--badge-glow': style.glow } as React.CSSProperties) : undefined}
    >
      <BadgeIcon name={badge.icon} size={iconSize} />
      {hideLabel ? <span className="sr-only">{badge.name}</span> : <span className="truncate">{badge.name}</span>}
      {showRarity && (
        <span className="hidden text-[11px] font-bold uppercase tracking-wide opacity-70 sm:inline">
          {style.label}
        </span>
      )}
    </span>
  );
}
