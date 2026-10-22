/**
 * Smoke test za 2.6.2 — Sentry (inertan) i Storage rute, kroz pravi HTTP.
 * Pokreće server u `memory` režimu sa privremenim env-om i gasi ga na kraju.
 * Namerno NEMA DSN ni Supabase ključeve: proverava fallback ponašanje.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PORT = 4799;
const BASE = `http://127.0.0.1:${PORT}/api`;
const envFile = 'server/_smoke-262.env';

// `SMOKE_STORAGE=1` — isti tok, ali sa (lažnim) Supabase ključevima: Storage je
// „podešen“, pa se proverava validacija slike pre mrežnog uploada. Pravi upload
// je pokriven u `tests/storage.test.ts` (sharp + magic bytes).
const withStorage = process.env.SMOKE_STORAGE === '1';
// `server/.env` postoji (dotenv ga učitava) i definiše SUPABASE_URL — u
// `--env-file` fajlu prazna vrednost je zabranjena, pa se ključ koji se
// „briše“ postavlja na `memory` (auth modul to prepoznaje kao „memory režim“).
const supabaseUrl = withStorage ? 'https://smoke.supabase.co' : 'memory';
const supabaseKey = withStorage ? 'smoke-local-only' : 'memory';

writeFileSync(
  envFile,
  [
    // `server/.env` postoji i dotenv ga učitava posle ovog fajla — vrednosti
    // iz ličnog `.env`-a moraju da se pregaze (ovaj fajl ide prvi).
    'NODE_ENV=development',
    'DEV_EXPOSE_TOKENS=1',
    'RESEND_API_KEY=smoke-disabled',
    'BREVO_API_KEY=smoke-disabled',
    `JWT_SECRET=${randomBytes(24).toString('hex')}`,
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_KEY=${supabaseKey}`,
    'SUPABASE_STORAGE_BUCKET=media',
    'SEED_ADMIN_PASSWORD=SmokeTest!2026',
    'LOG_FORMAT=json',
    `PORT=${PORT}`,
  ].join('\n'),
  'utf8',
);

const child = spawn(process.execPath, ['--env-file', `../${envFile}`, '--import', 'tsx', 'index.ts'], {
  cwd: 'server',
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

function cookieJar() {
  let cookies = '';
  return {
    capture(res) {
      const set = res.headers.getSetCookie?.() ?? [];
      for (const c of set) {
        const [pair] = c.split(';');
        const [name, value] = pair.split('=');
        const rest = cookies.split('; ').filter((p) => p && !p.startsWith(`${name}=`));
        cookies = [...rest, `${name}=${value}`].join('; ');
      }
    },
    get(name) {
      const found = cookies.split('; ').find((p) => p.startsWith(`${name}=`));
      return found ? found.slice(name.length + 1) : '';
    },
    header() {
      return cookies;
    },
  };
}

async function call(jar, path, { method = 'GET', body, form, csrf = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (jar?.header()) headers.Cookie = jar.header();
  if (csrf) {
    const token = jar?.get('nx_csrf');
    if (token) headers['X-CSRF-Token'] = token;
  }
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  jar?.capture(res);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) break;
    } catch {
      /* još se diže */
    }
    await sleep(250);
  }

  const health = await call(null, '/health');
  check('GET /api/health', health.status === 200);
  check('Sentry bez DSN-a ne ruši start', !/sentry.*initialized/i.test(serverLog) && /disabled \(SENTRY_DSN not set\)/.test(serverLog));

  // Registracija + verifikacija (dev token) → čist CSRF/cookie tok.
  const jar = cookieJar();
  const email = `smoke${Date.now()}@example.com`;
  const register = await call(jar, '/auth/register', {
    method: 'POST',
    body: { username: `smoke${Date.now() % 100000}`, email, password: 'SmokeTest!2026', acceptedTerms: true, ageConfirmed: true },
  });
  check('POST /auth/register', register.status === 201 || register.status === 200, `status ${register.status} ${register.data?.error ?? ''} ${JSON.stringify(register.data?.details ?? '')}`);
  const token = register.data?.verificationToken;
  if (token) await call(jar, '/auth/verify-email', { method: 'POST', body: { token } });
  const login = await call(jar, '/auth/login', { method: 'POST', body: { email, password: 'SmokeTest!2026' } });
  check('POST /auth/login (cookie + CSRF)', login.status === 200 && Boolean(jar.get('nx_csrf')), `status ${login.status}`);

  const noFile = new FormData();
  noFile.append('file', new Blob(['nije slika'], { type: 'image/png' }), 'x.png');
  const bad = await call(jar, '/uploads/avatar', { method: 'POST', form: noFile });
  if (withStorage) {
    check(
      'POST /uploads/avatar sa Storage-om: ne-slika → 400 pre mreže',
      bad.status === 400 && /samo JPG, PNG, WebP i GIF/.test(bad.data?.error ?? ''),
      `status ${bad.status} ${bad.data?.error ?? ''}`,
    );
  } else {
    check(
      'POST /uploads/avatar bez Storage-a → 503 sa uputstvom',
      bad.status === 503 && /Upload još nije podešen/.test(bad.data?.error ?? ''),
      `status ${bad.status} ${bad.data?.error ?? ''}`,
    );
  }

  const admin = await call(jar, '/admin/media');
  check('GET /admin/media → member dobija 403', admin.status === 403, `status ${admin.status}`);

  // Admin vidi stanje Storage-a (bez ključeva u odgovoru).
  const adminJar = cookieJar();
  const adminLogin = await call(adminJar, '/auth/login', {
    method: 'POST',
    body: { email: 'admin@nexusgaming.com', password: 'SmokeTest!2026' },
  });
  if (adminLogin.status === 200) {
    const media = await call(adminJar, '/admin/media');
    check(
      'GET /admin/media (admin) → configured bez tajni',
      media.status === 200 && media.data?.configured === withStorage && !JSON.stringify(media.data).includes('SERVICE_KEY'),
      JSON.stringify(media.data),
    );
  } else {
    check('admin login za /admin/media', false, `status ${adminLogin.status}`);
  }

  const presence = await call(jar, '/presence');
  check('GET /presence vraća { online, statuses }', presence.status === 200 && Array.isArray(presence.data?.online) && typeof presence.data?.statuses === 'object');

  const hbAway = await call(jar, '/auth/heartbeat', { method: 'POST', body: { status: 'away' } });
  check('POST /auth/heartbeat { status: away }', hbAway.status === 200 && hbAway.data?.status === 'away', JSON.stringify(hbAway.data));

  // --- 2.6.2 — pretraga ---
  const shortQuery = await call(jar, '/search?q=a');
  check('GET /search?q=a → 400 (minimum 2 znaka)', shortQuery.status === 400 && shortQuery.data?.code === 'QUERY_TOO_SHORT', `status ${shortQuery.status}`);

  const search = await call(jar, '/search?q=hogwarts');
  check(
    'GET /search?q=… → { hits, total } (fallback bez migracije)',
    search.status === 200 && Array.isArray(search.data?.hits) && typeof search.data?.total === 'number',
    `status ${search.status}`,
  );
  const badType = await call(jar, '/search?q=hogwarts&type=evil');
  check('GET /search sa nepoznatim type → tretira se kao „all“', badType.status === 200 && badType.data?.type === 'all');

  // --- 2.6.2 — newsletter segmenti (403 za member) ---
  const subscriberList = await call(jar, '/newsletter/subscribers?segment=active');
  check('GET /newsletter/subscribers kao member → 403', subscriberList.status === 403, `status ${subscriberList.status}`);

  // --- 2.6.2 — deal preview zahteva prijavu ---
  const anonPreview = await call(null, '/deals/preview?url=https://store.steampowered.com/app/1/');
  check('GET /deals/preview anonimno → 401', anonPreview.status === 401, `status ${anonPreview.status}`);
  const blockedPreview = await call(jar, '/deals/preview?url=https://127.0.0.1/admin');
  check(
    'GET /deals/preview ka lokalnoj adresi → error u telu (bez fetch-a)',
    blockedPreview.status === 200 && Boolean(blockedPreview.data?.error),
    JSON.stringify(blockedPreview.data),
  );
} catch (err) {
  check('smoke skripta', false, String(err));
} finally {
  child.kill();
  await sleep(300);
  const failed = results.filter((r) => !r.ok).length;
  if (failed) {
    console.log('\n--- server log (tail) ---\n' + serverLog.split('\n').slice(-25).join('\n'));
  }
  console.log(`\n${results.length - failed}/${results.length} provera prolazi`);
  process.exitCode = failed ? 1 : 0;
}
