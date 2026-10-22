#!/usr/bin/env node
/**
 * Local environment sanity check. Does not print secret values.
 * Usage: node scripts/check-env.mjs [server/.env]
 */
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.argv[2] ?? 'server/.env');
const issues = [];

if (!fs.existsSync(envPath)) {
  console.error(`Missing ${path.relative(process.cwd(), envPath)}.`);
  console.error('Copy server/.env.example to server/.env and replace the placeholders.');
  process.exit(1);
}

const values = {};
for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i < 1) continue;
  values[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}

const jwt = values.JWT_SECRET;
if (!jwt) issues.push('JWT_SECRET is missing.');
else if (jwt.length < 32) issues.push('JWT_SECRET must be at least 32 characters.');
else if (/replace|change-this|your-super-secret/i.test(jwt)) issues.push('JWT_SECRET still contains a placeholder.');

const url = values.SUPABASE_URL;
const serviceKey = values.SUPABASE_SERVICE_KEY;
if (!url || /<project-ref>|your-project/i.test(url)) issues.push('SUPABASE_URL is missing or still a placeholder.');
if (!serviceKey || /<service_role-key>|your-service-key/i.test(serviceKey)) {
  issues.push('SUPABASE_SERVICE_KEY is missing or still a placeholder.');
}
if (serviceKey && serviceKey.startsWith('sb_publishable_')) {
  issues.push('SUPABASE_SERVICE_KEY must be the server-only service_role secret, not a publishable key.');
}

if (issues.length) {
  console.error(`Environment check failed for ${path.relative(process.cwd(), envPath)}:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log(`Environment check passed for ${path.relative(process.cwd(), envPath)} (secret values hidden).`);
