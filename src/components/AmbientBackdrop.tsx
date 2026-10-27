/**
 * AMBIENT BACKDROP — L4 (čestice) i L5 (sken linija) crne baze.
 *
 * Dizajn 3.0 OBSIDIAN VIOLET: 18 tačaka 1-2px koje lebde nagore 40-90 s i
 * jedna 1px sken nit koja prelazi ekran za 14 s. Oba sloja su `fixed`,
 * `pointer-events: none`, `z-index: 0` — ispod `#root` (z-index 1), tako da
 * nikad ne smetaju tekstu. Animacija je samo na `transform`/`opacity`.
 *
 * Isključeno: mobilni (< 768px), `prefers-reduced-motion` (CSS u `base.css`)
 * i svetla tema (CSS u `theme.css`).
 */
const PARTICLES = 18;

/** Deterministične pozicije (bez Math.random → nema hidratacionog skoka). */
const particleStyle = (i: number) => ({
  left: `${(i * 37) % 100}%`,
  top: `${(i * 53) % 100}%`,
  width: i % 5 === 0 ? '2px' : '1px',
  height: i % 5 === 0 ? '2px' : '1px',
  animationDuration: `${40 + (i % 7) * 8}s`,
  animationDelay: `${-(i * 3.1)}s`,
});

export default function AmbientBackdrop() {
  return (
    <>
      <div className="nx-particle-layer nx-particles" aria-hidden="true">
        {Array.from({ length: PARTICLES }, (_, i) => (
          <i key={i} style={particleStyle(i)} />
        ))}
      </div>
      <div className="nx-particle-layer nx-scan" aria-hidden="true" />
    </>
  );
}
