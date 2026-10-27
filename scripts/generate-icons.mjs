/**
 * F-7 — IKONE ZA PWA (`public/icons/*.png`)
 * ----------------------------------------
 * `manifest.webmanifest` traži 192×192, 512×512 i maskable 512×512. Ikone se
 * generišu iz istog izvora kao OG slika (`sharp` iz `server/node_modules`), pa
 * nema ručno commit-ovanih binarnih fajlova bez izvora.
 *
 *   npm run generate:icons     — upisuje 3 PNG-a
 *   npm run check:icons        — (deo `verify`) proverava da su tu i 192/512
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const iconsDir = path.join(root, 'public', 'icons');
const verifyOnly = process.argv.includes('--verify');

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

async function loadSharp() {
  for (const from of [path.join(root, 'server'), root]) {
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

/**
 * „N“ monogram na tamnoj podlozi. `maskable` verzija ima veći unutrašnji
 * padding (40%) jer Android može da iseče do 20% svake strane (safe zone).
 */
function svg(size, maskable) {
  const padding = maskable ? size * 0.22 : size * 0.1;
  const fontSize = maskable ? size * 0.34 : size * 0.46;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${maskable ? 0 : size * 0.22}" fill="#0B0D14"/>
  <rect x="${padding}" y="${padding}" width="${size - padding * 2}" height="${size - padding * 2}" rx="${size * 0.18}" fill="url(#g)" opacity="0.16"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="Inter Tight, Inter, Arial, sans-serif" font-weight="800"
        font-size="${fontSize}" fill="#E8EBF2">N</text>
</svg>`;
}

function pngSize(buffer) {
  if (buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function verify() {
  const sharp = await loadSharp();
  for (const target of targets) {
    const file = path.join(iconsDir, target.file);
    if (!fs.existsSync(file)) {
      console.error(`[icons] ✖ nedostaje public/icons/${target.file} — pokreni \`npm run generate:icons\`.`);
      process.exit(1);
    }
    const buffer = fs.readFileSync(file);
    const size = sharp ? await sharp(buffer).metadata() : pngSize(buffer);
    if (!size || size.width !== target.size || size.height !== target.size) {
      console.error(`[icons] ✖ ${target.file} nije ${target.size}×${target.size}.`);
      process.exit(1);
    }
  }
  console.log(`[icons] ✓ ${targets.length} PWA ikone (192/512/maskable)`);
}

async function generate() {
  const sharp = await loadSharp();
  if (!sharp) {
    console.error('[icons] ✖ `sharp` nije instaliran (npm install --prefix server).');
    process.exit(1);
  }
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const target of targets) {
    const buffer = Buffer.from(svg(target.size, target.maskable));
    await sharp(buffer).png({ compressionLevel: 9 }).toFile(path.join(iconsDir, target.file));
  }
  await verify();
}

if (verifyOnly) await verify();
else await generate();
