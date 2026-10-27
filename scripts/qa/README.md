# scripts/qa — pomoćne (jednokratne) skripte

Ove skripte **nisu deo build-a ni testova** (izuzetak: `fix-mojibake-all.mjs`
poziva CI kroz `npm run check:mojibake`). Ovde su da ne stoje u korenu
repozitorijuma pored `README.md`-a i `package.json`-a i da se odmah vidi da su
„alat”, a ne deo aplikacije.

| Fajl | Šta radi |
|---|---|
| `fix-mojibake-all.mjs` | Proverava (bez argumenata) ili popravlja (`--write`) pokvaren UTF-8 u celom projektu. **CI ga poziva** — pokvaren tekst ne ulazi u `main`. |
| `fix-mojibake.mjs` | Isto, ali za fajlove navedene kao argument (`node scripts/qa/fix-mojibake.mjs server/schema-ALL.sql`). |
| `fix-emoji.mjs` | Vraća unicode emoji koji su u izvorima postali `?` ili escape sekvence. |
| `stem-probe.mjs` | Dijagnostika pretrage: ispiše kako PostgreSQL `to_tsvector` seče reč na osnovu (`search.ts`). |
| `tmp-diag10.mjs` | Jednokratna provera stanja `dist/` posle izmene prerendera. |
| `css-token-baseline.mjs` | **Nije više samostalan alat** — baseline za `scripts/check-css-tokens.mjs` (poziva ga `npm run lint:css`). |
| `_migrate_254.sql` | Arhivirana 2.5.4 migracija. **Aktuelna šema je `server/schema-ALL.sql`** — ovo je samo istorija, ne pušta se na bazu. |

Pokretanje (iz korena):

```powershell
npm run check:mojibake   # samo prikaži (exit 1 ako ima problema)
npm run fix:mojibake     # popravi i prikaži
```
