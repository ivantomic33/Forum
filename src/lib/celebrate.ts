/**
 * #8 — Level-up konfete.
 *
 * Server javlja `awarded.levelUp` u odgovorima (`POST /forum/.../threads`,
 * `connectAccount`) — kad je prag pređen, puca krafet burs! Dve boje: violet
 * (akcija brenda) i emerald (XP/zajednica zona). `prefers-reduced-motion`
 * poštuje canvas-confetti sam po sebi? Ne — zato eksplicitno proveravamo.
 */
import confetti from 'canvas-confetti';

export function celebrateLevelUp() {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#8b5cf6', '#a78bfa', '#34d399', '#f1effa'];

  // Levo
  confetti({
    particleCount: 90,
    spread: 70,
    origin: { x: 0.2, y: 0.6 },
    colors,
    zIndex: 9999,
  });
  // Desno (malo kasni da ne bude identičan zamućeni pravougaonik)
  setTimeout(() => {
    confetti({
      particleCount: 90,
      spread: 70,
      origin: { x: 0.8, y: 0.6 },
      colors,
      zIndex: 9999,
    });
  }, 180);
  // Centralni uzvišeni "volley"
  setTimeout(() => {
    confetti({
      particleCount: 60,
      spread: 100,
      startVelocity: 35,
      origin: { x: 0.5, y: 0.5 },
      colors,
      zIndex: 9999,
    });
  }, 360);
}

/** Poziva se kad stigne `awarded.newBadges` (npr. iz connectAccount). */
export function celebrateBadge(badgeNames: string[]) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!badgeNames.length) return;

  confetti({
    particleCount: 60,
    spread: 80,
    origin: { x: 0.5, y: 0.4 },
    colors: ['#f5c451', '#8b5cf6', '#f1effa'],
    zIndex: 9999,
  });
}
