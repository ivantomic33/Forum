/**
 * Pomoćna provera stemminga za schema-2.6.2-search-lang.sql.
 *
 * Štampa lekseme za `to_tsvector('simple', …)` i za kandidat konfiguracije
 * (`unaccent_srpski`). Server poredi izlaz sa `foldSrpski()` u
 * `server/lib/search.ts` — JS i Postgres moraju davati ISTE lekseme, inače
 * tsquery ne pogađa indeks.
 *
 * Pokretanje:  SUPABASE_DB_URL='postgres://…' node scripts/stem-probe.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_DB_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url && !(process.env.SUPABASE_URL && key)) {
  console.error('Postavi SUPABASE_DB_URL (preporučeno) ili SUPABASE_URL + SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const client = createClient(process.env.SUPABASE_URL ?? url, key, { auth: { persistSession: false } });

const samples = [
  'igra', 'igre', 'igrama', 'igranje', 'igrao', 'igrati',
  'popusti', 'popusta', 'popustima',
  'članci', 'članka', 'člancima',
  'lozinka', 'lozinke', 'lozinkom',
];

async function lekseme(config) {
  const { data, error } = await client.rpc('debug_lekseme', { config, reci: samples });
  if (error) return { error: error.message };
  return { data };
}

const simple = await lekseme('simple');
const srpski = await lekseme('unaccent_srpski');
console.log('simple      :', JSON.stringify(simple));
console.log('unaccent_srpski:', JSON.stringify(srpski));
