/**
 * IP BAN LISTA — 2.13.0
 *
 * Lista banovanih IP adresa za admin panel. In-process keš sa istekom 60 sekundi
 * — middleware (koji puka često) ne čita JSON fajl na svaki zahtev, a promene
 * sa admin rute vidljive su najkasnije za minut.
 *
 * Fajl `ip-bans.json` u DATA_DIR-u;Supabase mod nije potreban — ban IP adresa
 * je retka operacija, a lista je mala.
 *
 * Ugovor:
 *  - `normalizeIp(ip)` — trim, lowercase; `::ffff:1.2.3.4` → `1.2.3.4`
 *  - `isValidIp(ip)` — IPv4 ili IPv6 (bez portova)
 *  - `loadIpBans()` — lista (keš 60 s)
 *  - `addIpBan(ip, reason, by)` — upis + istek ban-a (opciono)
 *  - `removeIpBan(ip)` — brisanje
 *  - `isIpBanned(ip)` — middleware provera (keš)
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), '.data');

const FILE = path.join(DATA_DIR, 'ip-bans.json');
const CACHE_TTL_MS = 60_000;

export interface IpBanRecord {
  ip: string;
  reason: string;
  bannedBy: string;
  expiresAt: string | null;
  createdAt: string;
}

let cache: IpBanRecord[] | null = null;
let cacheAt = 0;

/** Trim + lowercase; IPv4-mapped IPv6 (`::ffff:1.2.3.4`) → čist IPv4. */
export function normalizeIp(raw: string): string {
  let ip = String(raw ?? '').trim().toLowerCase();
  if (ip.startsWith('::ffff:') && ip.includes('.')) ip = ip.slice(7);
  return ip;
}

/** IPv4 (0-255 oktet) ili IPv6 (grube grupe); bez portova i prefiksa. */
export function isValidIp(ip: string): boolean {
  const value = normalizeIp(ip);
  if (!value) return false;

  // IPv4: 4 okteta 0-255.
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return ipv4.slice(1).every((octet) => {
      const n = Number(octet);
      return Number.isInteger(n) && n >= 0 && n <= 255;
    });
  }

  // IPv6: gruba provera (hex grupe, dvostruka dvotačka dozvoljena jednom).
  if (value.includes(':')) {
    if ((value.match(/::/g) ?? []).length > 1) return false;
    const groups = value.split(/::?/).filter(Boolean);
    return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g));
  }

  return false;
}

const load = (): IpBanRecord[] => {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) => isValidIp(b?.ip))
      .map((b) => ({
        ip: normalizeIp(b.ip),
        reason: String(b.reason ?? '').slice(0, 200),
        bannedBy: String(b.bannedBy ?? '').slice(0, 60),
        expiresAt: b.expiresAt ? String(b.expiresAt) : null,
        createdAt: String(b.createdAt ?? new Date().toISOString()),
      }));
  } catch {
    return [];
  }
};

const save = (bans: IpBanRecord[]): boolean => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(bans, null, 2));
    return true;
  } catch (error) {
    logger.error({ err: error, file: FILE }, 'ip_bans_write_failed');
    return false;
  }
};

const loadFresh = (): IpBanRecord[] => {
  const now = Date.now();
  if (!cache || now - cacheAt > CACHE_TTL_MS) {
    cache = load();
    cacheAt = now;
  }
  return cache;
};

/** Za testove — briše in-process keš (fajl se ne dira). */
export function resetIpBanCache(): void {
  cache = null;
  cacheAt = 0;
}

/**
 * Refresher nije potreban — keš sam ističe 60 s posle upisa, pa middleware
 * automatski učita promenu. Export zadržavamo radi kompatibilnosti pozivalaca.
 */
export function startIpBansRefresher(): void {}

/** Lista banovanih IP adresa (bez isteklih). */
export function loadIpBans(): IpBanRecord[] {
  const now = new Date().toISOString();
  return loadFresh().filter((b) => !b.expiresAt || b.expiresAt > now);
}

/** Da li je IP banovan (prva provera — za middleware). */
export function isIpBanned(ip: string): boolean {
  const value = normalizeIp(ip);
  if (!value) return false;
  const now = new Date().toISOString();
  return loadFresh().some((b) => b.ip === value && (!b.expiresAt || b.expiresAt > now));
}

/** Upis IP bana; vraća zapis ili `null` ako je IP nevažeći. */
export function addIpBan(ip: string, reason: string, bannedBy: string, expiresAt?: string | null): IpBanRecord | null {
  const value = normalizeIp(ip);
  if (!isValidIp(value)) return null;

  const bans = loadFresh().filter((b) => b.ip !== value);
  const record: IpBanRecord = {
    ip: value,
    reason: reason.slice(0, 200),
    bannedBy: bannedBy.slice(0, 60),
    expiresAt: expiresAt ?? null,
    createdAt: new Date().toISOString(),
  };
  bans.push(record);
  if (!save(bans)) return null;
  cache = bans;
  cacheAt = Date.now();
  return record;
}

/** Brisanje IP bana; vraća `true` ako je postojao. */
export function removeIpBan(ip: string): boolean {
  const value = normalizeIp(ip);
  const bans = loadFresh();
  const filtered = bans.filter((b) => b.ip !== value);
  if (filtered.length === bans.length) return false;
  if (!save(filtered)) return false;
  cache = filtered;
  cacheAt = Date.now();
  return true;
}
