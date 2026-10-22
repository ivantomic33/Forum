import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * FALLBACK SKLADIŠTE ZA OPCIONE KOLONE
 * -------------------------------------
 * Supabase šema iz `server/schema-ALL.sql` ima `badges` i
 * `connected_accounts` kolone. Dok se šema ne primeni, ove
 * vrednosti se čuvaju ovde (JSON fajl u `server/.data/`), da bi XP, bedževi i
 * povezani nalozi radili bez gubitka podataka.
 *
 * Kada kolone postoje, ovaj fajl se ignoriše.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(__dirname, '..', '.data');
const FILE = path.join(DATA_DIR, 'user-extras.json');

type UserExtras = Record<string, { badges?: string[]; connectedAccounts?: Record<string, string> }>;

const load = (): UserExtras => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
};

let cache: UserExtras | null = null;

const ensureDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const save = () => {
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache ?? {}, null, 2), 'utf8');
  } catch (error) {
    console.error('[userExtras] write failed:', (error as Error).message);
  }
};

export function getExtras(userId: string, fresh = false) {
  if (!cache || fresh) cache = load();
  return cache[userId] ?? {};
}

export function patchExtras(userId: string, patch: { badges?: string[]; connectedAccounts?: Record<string, string> }) {
  if (!cache) cache = load();
  cache[userId] = { ...cache[userId], ...patch };
  save();
  return cache[userId];
}
