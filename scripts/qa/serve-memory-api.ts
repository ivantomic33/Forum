/**
 * QA — pokreće API u `preview` režimu sa IN-MEMORY bazom.
 *
 * `.env` u `server/` ima pravi Supabase; ovde ga namerno gasimo da se tokom
 * provere UI-ja ne piše u produkcionu bazu. Nije deo `verify`/CI-ja.
 *
 *   cd server && npx tsx ../scripts/qa/serve-memory-api.ts
 */
process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = 'memory';
process.env.SUPABASE_SERVICE_KEY = '';
process.env.JWT_SECRET = 'qa-only-secret-0123456789abcdef0123456789';
delete process.env.RESEND_API_KEY;

export {};

const { createApp } = await import('../../server/index.ts');
const { db } = await import('../../server/lib/store.ts');
const { seedInitialData } = await import('../../server/lib/seed.ts');
await seedInitialData(db);

const app = createApp();
app.listen(4000, () => console.log('QA API on :4000 (memory)'));
