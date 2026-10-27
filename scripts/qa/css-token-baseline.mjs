/**
 * N-08 — baseline za `scripts/check-css-tokens.mjs` (pokreće se iz `npm run lint:css`).
 *
 * Pomoćna skripta živi u `scripts/qa/` (N-12), a uvoz je relativan iz nje.
 *
 * `src/index.css` je podeljen na slojeve; ovaj fajl beleži koliko konkretnih
 * vrednosti (boja/senki) još stoji van `tokens.css` po fajlu. Provera pada
 * ako se broj **poveća** — nove vrednosti idu u `tokens.css`, a stari dug se
 * samo smanjuje (svaki pređeni `var(--…)` spusti broj u istom commitu).
 *
 * `legacy-palette.css` se ne broji: ceo sloj je mapiranje starih Tailwind
 * boja i nestaje kada komponente pređu na semantičke klase.
 */
export const BASELINE = {
  // U-01..U-10 — smanjeno u prolazu: base 13→11, ui-kit 94→82 (akcenti sada
  // koriste `var(--color-*)`, a ne hardkodovan hex).
  'base.css': 11,
  'components/typography.css': 4,
  'components/ui-kit.css': 81,
  'components/leaderboard.css': 2,
  'components/feature.css': 42,
  'components/utilities.css': 7,
};
