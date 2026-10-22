import { Code2, ShieldCheck, Wrench } from 'lucide-react';
import { cn } from '../ui';

/**
 * Značka uloge sa suptilnim neon okvirom (Obsidian Cyber-Pulse).
 * - admin     → electric violet (prestige)
 * - dev       → cyber rose (kreator sadržaja)
 * - moderator → neon cyan (MODERATOR bedž)
 * Boja nikad nije jedini signal — uvek je prisutan i tekstualni label.
 */
const ROLE_STYLES = {
  admin: {
    label: 'Admin',
    icon: ShieldCheck,
    frame: 'role-frame-admin',
    chip: 'text-violet-200 border-violet-500/40 bg-violet-500/15 shadow-[inset_0_0_12px_rgba(124,58,237,0.18)]',
    glow: 'rgba(168, 85, 247, 0.6)',
  },
  dev: {
    label: 'Dev',
    icon: Code2,
    frame: 'role-frame-dev',
    chip: 'text-rose-200 border-rose-500/40 bg-rose-500/12 shadow-[inset_0_0_12px_rgba(244,63,94,0.16)]',
    glow: 'rgba(244, 63, 94, 0.55)',
  },
  moderator: {
    label: 'Moderator',
    icon: Wrench,
    frame: 'role-frame-mod',
    /* Neon cyan — jasno vidljiv „MODERATOR“ bedž. */
    chip: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/15 shadow-[inset_0_0_12px_rgba(6,182,212,0.16)]',
    glow: 'rgba(6, 182, 212, 0.6)',
  },
} as const;

export function RoleEmblem({ role, className }: { role?: string | null; className?: string }) {
  if (!role || !(role in ROLE_STYLES)) return null;
  const style = ROLE_STYLES[role as keyof typeof ROLE_STYLES];
  const Icon = style.icon;

  return (
    <span
      className={cn(
        'role-emblem inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider',
        style.chip,
        className,
      )}
      style={{ '--role-glow': style.glow } as React.CSSProperties}
    >
      <Icon size={12} className="role-emblem-icon" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** Avatar okvir po ulozi (animirana rotirajuća granica). */
export function roleAvatarFrame(role?: string | null): string {
  if (!role || !(role in ROLE_STYLES)) return '';
  return ROLE_STYLES[role as keyof typeof ROLE_STYLES].frame;
}

export function roleGlow(role?: string | null): string | undefined {
  if (!role || !(role in ROLE_STYLES)) return undefined;
  return ROLE_STYLES[role as keyof typeof ROLE_STYLES].glow;
}
