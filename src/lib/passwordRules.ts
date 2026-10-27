/**
 * Pravila lozinke — JEDNA politika za UI i za lokalnu proveru (F-14).
 *
 * Ranije su se razlikovala: front je zahtevao 6 znakova + veliko slovo (uz
 * pokvaren regex `[A-ZČĆŠŽĐ]`), a server 8 znakova + slovo + broj + listu
 * čestih lozinki. Posledica: forma je prikazivala „ispravna“, a server odbija.
 *
 * Sada je politika identična `server/lib/validation.ts`.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt ignoriše bajtove posle 72

export interface PasswordCheck {
  rule: 'length' | 'letter' | 'number' | 'common';
  label: string;
  ok: boolean;
}

/** Ista lista kao na serveru — odbija očigledne lozinke pre slanja zahteva. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'admin123', 'administrator', 'welcome',
  'welcome1', 'letmein123', 'abc12345', 'football', 'baseball', 'sunshine',
  'princess', 'dragon123', 'monkey123', 'master123', 'shadow123', 'superman',
  'trustno1', 'starwars', 'freedom1', 'whatever', 'zaq12wsx', 'gaming123',
  'fortnite', 'minecraft', 'playstation', 'xbox12345', 'nintendo', 'league123',
  'nexus123', 'nexusadmin', 'gaming2026', 'sifra123', 'lozinka1', 'lozinka123',
  'dobrodosli', 'beograd1', 'srbija123', 'stadion1', 'partizan1', 'zvezda123',
]);

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    {
      rule: 'length',
      label: `Najmanje ${PASSWORD_MIN_LENGTH} karaktera`,
      ok: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    },
    // Latinica + naša dijakritika (čćžšđ), bez pokvarenih UTF-8 sekvenci.
    { rule: 'letter', label: 'Bar jedno slovo', ok: /[a-zA-ZčćžšđČĆŽŠĐ]/.test(password) },
    { rule: 'number', label: 'Bar jedan broj', ok: /\d/.test(password) },
    { rule: 'common', label: 'Nije među čestim lozinkama', ok: !isCommonPassword(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return getPasswordChecks(password).every((c) => c.ok);
}

/** Prvi neispunjeni uslov — ista poruka kao backend. */
export function passwordError(password: string): string | null {
  const failed = getPasswordChecks(password).find((c) => !c.ok);
  return failed ? failed.label : null;
}
