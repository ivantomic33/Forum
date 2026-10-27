/**
 * Generiše PDF analizu web aplikacije iz HTML-a (Playwright/Chromium).
 *   node scripts/design/build-analysis-pdf.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SRC = path.join(ROOT, 'docs', 'analiza-web-aplikacije.html');
const OUT = path.join(ROOT, 'docs', 'NEXUS-analiza-sta-dodati.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + SRC.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
await page.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
await browser.close();
console.log('PDF napravljen:', OUT);
