/**
 * NEXUS — snimci ekrana u 1920x1080 (za dizajn audit / PDF)
 * ---------------------------------------------------------
 * Podiže Vite dev server na 5199 sa API proxy-jem na E2E API (4177) i pravi
 * snimke ključnih strana tačno na 1920x1080 (deviceScaleFactor 1 → 1920x1080 px).
 *
 *   npm run shot:design
 *
 * Izlaz je `docs/dizajn-3.0/posle/` (stanje POSLE primene dizajna). Stari snimci
 * (analiza stanja 3.0.0) žive u `docs/dizajn-3.0/pre/` i ne diraju se ovom
 * skriptom — inače bi dokument analize pokazivao nove ekrane uz stari opis.
 *
 * API mora da radi:
 *   cd server; $env:E2E_API_PORT="4177"; npx tsx e2e/server.ts
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs', 'dizajn-3.0', 'posle');
const WEB_PORT = 5199;
const API_PORT = 4177;
const BASE = `http://localhost:${WEB_PORT}`;

const PAGES = [
  { id: '01-pocetna', path: '/', note: 'Početna — hero, top priče, popusti, forum' },
  { id: '02-forum', path: '/forum', note: 'Forum — kategorije i teme' },
  { id: '03-popusti', path: '/deals', note: 'Popusti — amber zona' },
  { id: '04-rang-lista', path: '/leaderboard', note: 'Rang lista — prestige' },
  { id: '05-clanak', path: '/article/gta-6-odlozeno-na-jesen-2026', note: 'Članak — editorial' },
  { id: '06-prijava', path: '/login', note: 'Prijava — auth shell' },
];

const apiUp = async () => {
  try {
    const res = await fetch(`http://localhost:${API_PORT}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
};

const waitFor = async (url, ms = 150_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return true;
    } catch {
      /* još se diže */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
};

if (!(await apiUp())) {
  console.error(`[shot] API na :${API_PORT} ne radi. Pokreni: cd server; npx tsx e2e/server.ts`);
  process.exit(1);
}

const vite = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(WEB_PORT), '--strictPort'],
  {
    cwd: ROOT,
    env: { ...process.env, VITE_DEV_PROXY_TARGET: `http://localhost:${API_PORT}` },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  },
);

const cleanup = () => {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      vite.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
};

try {
  if (!(await waitFor(BASE))) throw new Error('Vite nije podigao server');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  const report = [];
  for (const item of PAGES) {
    const errors = [];
    const failed = [];
    const onConsole = (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
    };
    const onFailed = (req) => failed.push(`${req.method()} ${new URL(req.url()).pathname}`);
    page.on('console', onConsole);
    page.on('requestfailed', onFailed);

    await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => { });
    // Fontovi + slike (Unsplash/Dicebear) moraju biti učitani pre snimka.
    await page.evaluate(async () => {
      await document.fonts?.ready;
      const imgs = [...document.images];
      await Promise.all(imgs.map((img) => (img.complete ? null : img.decode().catch(() => null))));
    });
    await page.waitForTimeout(1200);

    const file = path.join(OUT, `${item.id}-1920x1080.png`);
    await page.screenshot({ path: file, type: 'png', animations: 'disabled', caret: 'hide' });

    const info = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim().slice(0, 120) ?? null,
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      scrollH: document.documentElement.scrollHeight,
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).filter((v, i, a) => a.indexOf(v) === i),
    }));
    page.off('console', onConsole);
    page.off('requestfailed', onFailed);

    report.push({ ...item, file: path.relative(ROOT, file), ...info, errors, failed: [...new Set(failed)] });
    console.log(`✓ ${item.id} → ${path.relative(ROOT, file)}`);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'snimci.json'), JSON.stringify(report, null, 2));
  const errs = report.filter((r) => r.errors.length || r.failed.length);
  console.log(`\nGotovo: ${report.length} snimka u ${path.relative(ROOT, OUT)}. Strane sa greškama: ${errs.length}.`);
} finally {
  cleanup();
}
