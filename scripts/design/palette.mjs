/**
 * NEXUS 3.0 — "OBSIDIAN VIOLET" paleta (ljubičasto / teget / crno)
 *
 * Jedini izvor za nove boje u PDF-u. U aplikaciju se iste vrednosti upisuju u
 * `src/styles/tokens.css` (Tailwind `@theme`), a svetla tema u
 * `src/styles/components/theme.css`.
 */

/** Površine: crna baza + teget slojevi (surface-0 je najniži). */
export const surfaces = [
  { token: 'surface-0', name: 'Void Black', hex: '#050408', use: 'Pozadina cele aplikacije — pravo crno, osnova za sitne animacije' },
  { token: 'surface-1', name: 'Obsidian', hex: '#0B0917', use: 'Glavna pozadina / sekcije (body sloj iznad void-a)' },
  { token: 'surface-2', name: 'Ink Violet', hex: '#121026', use: 'Default kartice, redovi, paneli' },
  { token: 'surface-3', name: 'Navy Deep', hex: '#171A38', use: 'Hover / unutrašnjost kartice, input polja' },
  { token: 'surface-4', name: 'Navy', hex: '#1E2350', use: 'Aktivno stanje, segment, chip, badge brojač' },
  { token: 'surface-5', name: 'Navy Light', hex: '#2A2E66', use: 'Najsvetliji deo skale — retko, za istaknute redove' },
];

/** Akcenti: ljubičasta nosi akciju, teget-plava nosi zonu foruma/hardvera. */
export const accents = [
  { token: 'primary', name: 'Ultraviolet', hex: '#8B5CF6', use: 'JEDINA primarna akcija: dugmad, aktivni tab, akcentni rail sekcije' },
  { token: 'primary-hover', name: 'Ultraviolet Light', hex: '#A78BFA', use: 'Hover akcije i čitljiv ljubičasti tekst na crnom (primary-fg)' },
  { token: 'primary-surface', name: 'Violet 600', hex: '#7C3AED', use: 'Puna površina CTA sa belim tekstom (5,7:1 — AA)' },
  { token: 'primary-deep', name: 'Violet 900', hex: '#4C1D95', use: 'Dubina: gradijent logotipa, shadow, prigušeni obris' },
  { token: 'secondary', name: 'Teal Navy', hex: '#38BDF8', use: 'Zona foruma, PC Gaming, live/online, hardver — NIKAD glavna akcija' },
  { token: 'navy-accent', name: 'Royal Navy', hex: '#3B4BFF', use: 'Sekundarni akcent: linkovi, fokus prsten, „info“ stanja' },
  { token: 'deal', name: 'Signal Amber', hex: '#F5C451', use: 'Popusti: cena, -%, „ističe danas“ (nije u osnovnoj paleti, statusna)' },
  { token: 'danger', name: 'Signal Rose', hex: '#FB7185', use: 'Greške, isteklo, ban — samo status' },
];

/** Tekst i ivice — sve prilagođeno crnoj podlozi. */
export const neutrals = [
  { token: 'text-primary', name: 'Paper', hex: '#F1EFFA', use: 'Naslovi i telo teksta (17,3:1 na surface-1)' },
  { token: 'text-secondary', name: 'Mist', hex: '#B6B2D0', use: 'Sekundarni tekst, meta (9,6:1 na surface-1)' },
  { token: 'text-tertiary', name: 'Ash', hex: '#918CB4', use: 'Tercijarni meta tekst, labele (5,9:1 na surface-2)' },
  { token: 'text-muted', name: 'Dust', hex: '#7B7699', use: 'Placeholder, disabled, „nema podataka“ (4,3:1 — samo ≥ 14px bold ili dekorativno)' },
  { token: 'border-subtle', name: 'Hairline', hex: '#1C1930', use: '1px ivica kartice — kartice se ne „lepe“ za pozadinu' },
  { token: 'border-default', name: 'Hairline +', hex: '#262243', use: 'Ivice inputa, segmenata, razdelne linije' },
  { token: 'border-strong', name: 'Hairline ++', hex: '#363060', use: 'Hover ivica, aktivna kartica' },
  { token: 'border-focus', name: 'Focus', hex: '#A78BFA', use: 'Jedan fokus stil: 2px ljubičasta + 2px offset' },
];

/**
 * Ambijentalni sloj pozadine — "sitne animacije" imaju svoju boju; ne diraju
 * sadržaj i isključuju se na `prefers-reduced-motion`.
 */
export const ambient = [
  { token: 'depth-violet', name: 'Violet glow (gore-lijevo)', hex: 'rgba(139,92,246,.24)', use: 'Radijalni sjaj koji polako „diše“ (18 s)' },
  { token: 'depth-navy', name: 'Teget glow (dolje-desno)', hex: 'rgba(59,75,255,.18)', use: 'Drugi radijalni sloj — daje dubinu bez sivila' },
  { token: 'grid-line', name: 'Mreža', hex: 'rgba(167,139,250,.055)', use: '64px mreža, maskirana ka centru — statična' },
  { token: 'particle', name: 'Čestice / zvezde', hex: 'rgba(199,183,255,.55)', use: 'Sitne tačke koje lebde 40-90 s; 18 tačaka, veličina 1-2px' },
  { token: 'scanline', name: 'Sken linija', hex: 'rgba(139,92,246,.10)', use: '1px linija koja prelazi ekran za 14 s — jedva vidljiva' },
  { token: 'grain', name: 'Film grain', hex: 'rgba(255,255,255,.03)', use: 'Statični fraktalni šum preko cele pozadine' },
];

export const gradients = [
  { name: 'brand', value: 'linear-gradient(135deg, #8B5CF6 0%, #3B4BFF 100%)', use: 'Samo logo, featured badge, auth panel' },
  { name: 'section-rule', value: 'linear-gradient(90deg, #A78BFA, transparent)', use: 'Kratka crta ispod naslova sekcije' },
  { name: 'hero-fade', value: 'linear-gradient(180deg, transparent 30%, #050408 100%)', use: 'Tekst na hero slici ostaje čitljiv' },
  { name: 'card-sheen', value: 'linear-gradient(140deg, rgba(139,92,246,.10), transparent 55%)', use: 'Samo hover afordansa kartice' },
];

/** Kontrast (WCAG 2.1) na surface-1 — računa se, ne prepisuje. */
export const contrastPairs = [
  ['#F1EFFA', '#0B0917', 'text-primary na surface-1', 4.5],
  ['#B6B2D0', '#0B0917', 'text-secondary na surface-1', 4.5],
  ['#918CB4', '#121026', 'text-tertiary na surface-2', 4.5],
  ['#A78BFA', '#0B0917', 'primary-fg na surface-1', 4.5],
  ['#38BDF8', '#0B0917', 'secondary (forum) na surface-1', 4.5],
  ['#F5C451', '#0B0917', 'deal (cena) na surface-1', 4.5],
  ['#FFFFFF', '#7C3AED', 'beli tekst na CTA površini', 4.5],
  ['#1A1203', '#F5C451', 'tamni tekst na amber površini', 4.5],
  ['#FB7185', '#0B0917', 'danger na surface-1', 4.5],
];

export const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const ratio = (fg, bg) => {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
