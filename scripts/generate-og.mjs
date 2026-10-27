/**
 * N-13 — STATIČKA OG SLIKA (fallback za mreže bez JS-a)
 * ----------------------------------------------------
 * `npm run generate:og` upisuje `public/og/default.png` (1200×630) — slika koja
 * stoji u `index.html` (`og:image`) i koristi se kada nema dinamičke (`/api/og/…`).
 *
 * `npm run check:og` (deo `npm run verify`) NE renderuje ništa: proverava da je
 * slika commit-ovana i da su joj dimenzije 1200×630 — kao `schema:verify`, ali
 * za OG. Bez ovoga se `og:image` tiho pokvari (izgubljen fajl ili pogrešno
 * sačuvana slika), a mreže prikažu preview bez slike ili isečenu.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'public', 'og', 'default.png');
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

const verifyOnly = process.argv.includes('--verify');

/** `sharp` je zavisnost servera (nema je u root `node_modules`). */
async function loadSharp() {
  // CJS paket: `require.resolve` (iz server foldera) → `import()` preko file URL-a.
  const candidates = [path.join(root, 'server'), root];
  for (const from of candidates) {
    try {
      const req = createRequire(path.join(from, 'package.json'));
      const entry = req.resolve('sharp');
      const mod = await import(pathToFileURL(entry).href);
      const sharp = mod.default ?? mod;
      if (typeof sharp === 'function') return sharp;
    } catch {
      // probaj sledeći
    }
  }
  return null;
}

async function verify() {
  if (!fs.existsSync(output)) {
    console.error(`[og] ✖ nedostaje ${path.relative(root, output)} — pokreni \`npm run generate:og\`.`);
    process.exit(1);
  }
  const sharp = await loadSharp();
  if (!sharp) {
    // Bez sharp-a proveravamo samo PNG zaglavlje (IHDR: width/height na bajtovima 16..24).
    const buffer = fs.readFileSync(output);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return assertSize(width, height, 'png header');
  }
  const { width, height } = await sharp(fs.readFileSync(output)).metadata();
  return assertSize(width, height, 'sharp');
}

function assertSize(width, height, via) {
  if (width !== OG_WIDTH || height !== OG_HEIGHT) {
    console.error(`[og] ✖ dimenzije ${width}×${height} (${via}), očekivano ${OG_WIDTH}×${OG_HEIGHT}.`);
    process.exit(1);
  }
  console.log(`[og] ✓ public/og/default.png — ${width}×${height} (${via})`);
}

async function generate() {
  // Jedan izvor šablona: `server/lib/ogImage.ts` (isti SVG kao `/api/og/…`).
  const tsx = createRequire(path.join(root, 'server', 'package.json')).resolve('tsx/cli');
  const script = path.join(root, 'server', 'scripts', 'generate-og-static.ts');
  execFileSync(process.execPath, [tsx, script, output], { cwd: path.join(root, 'server'), stdio: 'inherit' });
  await verify();
}


if (verifyOnly) await verify();
else await generate();
