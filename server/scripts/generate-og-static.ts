/**
 * N-13 — STATIČKA OG SLIKA (izvor za `public/og/default.png`)
 * -----------------------------------------------------------
 * Renderuje **istu** grafiku kao dinamički endpoint `/api/og/…`
 * (`server/lib/ogImage.ts`), pa statička i dinamička slika nikad ne odlutaju.
 *
 * Pokreće se iz `scripts/generate-og.mjs` preko `tsx` (TS modul servera).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ogTemplateSvg } from '../lib/ogImage.js';

const output = path.resolve(process.argv[2] ?? '../public/og/default.png');

const svg = ogTemplateSvg();
fs.mkdirSync(path.dirname(output), { recursive: true });
const png = await sharp(Buffer.from(svg)).png().toBuffer();
fs.writeFileSync(output, png);
console.log(`[og] ✓ ${path.basename(output)} — ${Buffer.byteLength(png)} bajtova`);
