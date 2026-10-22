/**
 * B-03 — VERIFIKACIJA POVEZANIH GAMING NALOGA
 * -------------------------------------------
 * Ranije je `POST /api/users/accounts/connect` dodelio +25 XP čim se tekst
 * upiše — bez ikakve provere da nalog postoji. Sada:
 *
 *  - **Steam** se proverava stvarno preko `ResolveVanityURL` (ako je podešen
 *    `STEAM_API_KEY`); prihvata vanity ime ili 17-cifreni SteamID64, pa vraća
 *    kanonski SteamID64. XP ide tek posle uspešne provere.
 *  - **Discord** i **Google** nalog se verifikuje OAuth „link“ tokom
 *    (`scope=verify`), jer samo provajder može da garantuje identitet.
 *  - **YouTube / Twitch / Epic / Riot** nemaju javnu proveru bez ključa —
 *    nalog se čuva, ali je označen kao `unverified` i XP **ne** dodeljuje.
 *
 * Rezultat se pamti na korisniku (`verifiedPlatforms`) da UI može da prikaže
 * značku „Verifikovano“ pored naloga.
 */

export type AccountPlatform = 'steam' | 'discord' | 'youtube' | 'twitch' | 'epic' | 'riot';

/** Provajderi koji se ne proveravaju ovim putem (verifikuju se OAuth link-om). */
export const OAUTH_VERIFIABLE: ReadonlySet<AccountPlatform> = new Set<AccountPlatform>(['discord']);

export type VerificationResult =
  | { status: 'verified'; value: string }
  | { status: 'not_configured' }
  | { status: 'not_found'; reason: string }
  | { status: 'error'; reason: string };

export const STEAM_ID64_RE = /^\d{17}$/;

const steamConfigured = (): boolean => Boolean((process.env.STEAM_API_KEY ?? '').trim());

/**
 * Provera Steam naloga.
 *  - 17 cifara → SteamID64 se prihvata bez mrežnog poziva (format je jednoznačan).
 *  - vanity ime → `ResolveVanityURL`; `success` 1 = ok, 42 = nema pogotka
 *    (vidi https://wiki.teamfortress.com/wiki/WebAPI/ResolveVanityURL).
 */
export async function verifySteamAccount(
  raw: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<VerificationResult> {
  const value = raw.trim();
  if (!value) return { status: 'not_found', reason: 'Prazan nadimak.' };
  if (STEAM_ID64_RE.test(value)) return { status: 'verified', value };

  if (!steamConfigured()) return { status: 'not_configured' };

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);

  try {
    const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
    url.searchParams.set('key', process.env.STEAM_API_KEY!.trim());
    url.searchParams.set('vanityurl', value);

    const res = await doFetch(url.toString(), { signal: controller.signal });
    if (!res.ok) return { status: 'error', reason: `Steam API ${res.status}` };

    const body = (await res.json()) as { response?: { success?: number; steamid?: string; message?: string } };
    const response = body.response;
    if (response?.success === 1 && response.steamid && STEAM_ID64_RE.test(response.steamid)) {
      return { status: 'verified', value: response.steamid };
    }
    if (response?.success === 42) {
      return { status: 'not_found', reason: response.message ?? 'Steam profil sa tim imenom ne postoji.' };
    }
    return { status: 'not_found', reason: response?.message ?? 'Steam nije vratio profil.' };
  } catch (error: any) {
    return { status: 'error', reason: error?.name === 'AbortError' ? 'Steam API nije odgovorio na vreme.' : 'Steam provera nije uspela.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provera po platformi. Vraća `verified` samo kada je identitet pouzdano
 * potvrđen; ostalo je „sačuvano, ali neverifikovano“.
 */
export async function verifyAccount(
  platform: AccountPlatform,
  raw: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<VerificationResult> {
  if (platform === 'steam') return verifySteamAccount(raw, opts);
  return { status: 'not_configured' };
}

/** XP za povezivanje naloga se dodeljuje isključivo verifikovanom nalogu. */
export const XP_FOR_VERIFIED_ACCOUNT = 25;

/** Poruka za korisnika kada nalog nije moguće verifikovati. */
export function unverifiedMessage(platform: AccountPlatform): string {
  if (platform === 'steam') {
    return 'Steam provera nije dostupna (STEAM_API_KEY nije podešen) — nalog je sačuvan, ali bez XP-a do verifikacije.';
  }
  return `${platform} nalog je sačuvan, ali nije verifikovan — XP se dodeljuje tek posle verifikacije.`;
}
