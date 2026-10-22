/**
 * Parsiranje `TRUST_PROXY` / `RATE_LIMIT_*` environment vrednosti.
 *
 * F-05: ranije je `Number(process.env.TRUST_PROXY ?? 1)` pretvaralo `true`/`false`
 * u `NaN` i podrazumevalo `1` — pa je X-Forwarded-For bio prihvaćen i kada ispred
 * servera NEMA proxy-ja, što je omogućavalo zaobilaženje rate limita.
 *
 * Prihvaćene vrednosti `TRUST_PROXY`:
 *   (prazno)        → false  (bez proxy-ja; podrazumevano)
 *   false | 0       → false
 *   true            → true   (veruj svim hopovima — samo za pouzdanu mrežu)
 *   2               → 2      (broj hopova: Render/Railway/Heroku)
 *   10.0.0.1,a:b::c → lista IP/CIDR adresa proxy-ja
 *
 * B-02 — u lokalnom razvoju sa `DEV_EXPOSE_TOKENS=1` tokeni se vraćaju **uvek**,
 * bez obzira da li je mejl zaista poslat: ranije je uslov `!mailSent` značio da
 * podešen `RESEND_API_KEY` u dev `.env`-u pravi ćorsokak (mejl odlazi na
 * nepostojeću adresu, a token se nigde ne vidi).
 */

export type TrustProxyValue = boolean | number | string[];

/**
 * Tokeni (verifikacija/reset/newsletter) se vraćaju u HTTP odgovoru samo kada su
 * ISPUNJENA oba uslova: `NODE_ENV === 'development'` **i** `DEV_EXPOSE_TOKENS=1`
 * (F-02). Ranije je bio dovoljan samo `NODE_ENV !== 'production'`, pa je
 * staging ili zaboravljena promenljiva značila preuzimanje bilo kog naloga.
 */
export function devTokensExposed(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEV_EXPOSE_TOKENS === '1';
}

export function parseTrustProxy(raw: string | undefined): TrustProxyValue {
  const value = (raw ?? '').trim();
  if (!value) return false;

  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') return false;
  if (lower === 'true' || lower === 'on' || lower === 'yes') return true;

  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  // Lista IP adresa / CIDR opsega (razdvojena zapetom ili razmakom).
  const list = value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
  return list.length ? list : false;
}

/** Broj >= 1 iz env-a; neispravna ili nedostajuća vrednost pada na `fallback`. */
export function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Vrednost env promenljive „kao da nije postavljena“.
 * `.env` fajl i `dotenv` ne prepisuju već postojeće promenljive, pa prazan
 * string (`SUPABASE_URL=`) ne isključuje Supabase — za test/dev režim se
 * koristi eksplicitna oznaka `memory`.
 */
export const isUnsetValue = (value: string | undefined): boolean => {
  const trimmed = (value ?? '').trim().toLowerCase();
  return !trimmed || trimmed === 'memory' || trimmed === 'none' || trimmed === 'disabled';
};
