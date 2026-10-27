/**
 * Jednokratni script: gasi maintenance mode u Supabase `site_meta`.
 * Pokrenuti sa:  node server/scripts/disable-maintenance.mjs
 * (čitaje env iz server/.env sam, ne zahteva env promenljive u shellu)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const m = t.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Nedostaje SUPABASE_URL ili SUPABASE_SERVICE_KEY u server/.env');
  process.exit(1);
}

const client = createClient(url, key);
const { error } = await client
  .from('site_meta')
  .upsert(
    {
      key: 'site_settings',
      value: {
        announcement: { active: false, message: '', tone: 'info', link: '' },
        registrationOpen: true,
        maintenanceMode: false,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

if (error) {
  console.error('GREŠKA:', error.message);
  process.exit(1);
}
console.log('OK — maintenanceMode=false upisano u site_meta (site_settings).');
