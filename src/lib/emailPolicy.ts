/**
 * F-27 — Odluka o enumeraciji email adresa.
 *
 * `GET /auth/check-email` i 409 na registraciji namerno otkrivaju da li je
 * adresa registrovana. To je UX kompromis (korisnik odmah vidi da nalog
 * postoji umesto da popuni celu formu i dobije generičku grešku):
 *
 *  - odgovor je ograničen na `available` + `reason` (`taken` | `disposable`),
 *    nikad ne otkriva ime naloga ni druge podatke;
 *  - `forgot-password` ostaje bez enumeracije (uvek isti odgovor);
 *  - limit je po IP-u 60/min (`RATE_LIMIT_LOOKUP_MAX`) i po `Origin`/domenu
 *    frontenda; za javni API dodatno se preporučuje edge/WAF limit.
 *
 * Preporuka: ako se enumeracija oceni kao neprihvatljiva, `check-email` treba
 * ukinuti i zameniti proverom tek na submit-u (jednokratno), uz CAPTCHA.
 */

export type EmailCheckReason = 'taken' | 'disposable' | null;

/**
 * Normalizacija email-a za poređenje: mala slova + trim.
 * Bez lokalnog dela posle `+` (iako se razlikuje po RFC-u, sajt ga tretira isto).
 */
export function normalizeEmailForLookup(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split('@');
  if (!domain) return email.trim().toLowerCase();
  return `${local.split('+')[0]}@${domain}`;
}

/**
 * Poruke: različite za „zauzeto“ i „privremena adresa“ — to je svrhovito
 * (pomaže korisniku), ali se ne otkriva ništa o nalogu osim postojanja adrese.
 */
export function emailAvailabilityMessage(reason: EmailCheckReason): string | null {
  if (reason === 'taken') return 'Email adresa je već registrovana.';
  if (reason === 'disposable') return 'Privremene (temp) email adrese nisu dozvoljene.';
  return null;
}
