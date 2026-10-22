/**
 * NEXUS auth validation helpers
 * - Password policy (min 8, >=1 slovo, >=1 broj, lista čestih lozinki, bcrypt cost 12)
 * - Username / email rules
 * - Disposable (temporary) email provider blocklist
 * All messages are in Serbian to match the rest of the UI.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // bcrypt ignoriše bajtove posle 72
export const BCRYPT_COST = 12;

export interface PasswordCheck {
  rule: 'length' | 'letter' | 'number' | 'common';
  label: string;
  ok: boolean;
}

/**
 * Najčešće lozinke (donji deo globalnih listi + lokalno relevantne).
 * Poređenje je case-insensitive i koristi se pri registraciji i resetu.
 */
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
    { rule: 'letter', label: 'Bar jedno slovo', ok: /[a-zA-ZčćžšđČĆŽŠĐ]/.test(password) },
    { rule: 'number', label: 'Bar jedan broj', ok: /\d/.test(password) },
    { rule: 'common', label: 'Nije među čestim lozinkama', ok: !isCommonPassword(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return getPasswordChecks(password).every((c) => c.ok);
}

/** Poruka za klijenta — prvi neispunjeni uslov. */
export function passwordError(password: string): string | null {
  const failed = getPasswordChecks(password).find((c) => !c.ok);
  return failed ? failed.label : null;
}

export function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 25) {
    return 'Korisničko ime mora imati između 3 i 25 karaktera.';
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return 'Korisničko ime može sadržati samo slova, brojeve, tačku, crtu i donju crtu.';
  }
  return null;
}

export function validateEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Unesite ispravnu email adresu.';
  }
  return null;
}

/**
 * Common disposable / temporary email providers.
 * Checked on the full domain AND the domain with subdomains (foo.mailinator.com).
 */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', '10minutemail.com', '10minutemail.net', 'guerrillamail.com',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'sharklasers.com',
  'grr.la', 'guerrillamailblock.com', 'trashmail.com', 'trashmail.de', 'trash-mail.com',
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmailo.com',
  'tempr.email', 'tmpmail.org', 'tmpmail.net', 'throwawaymail.com', 'getnada.com',
  'nada.email', 'dispostable.com', 'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'cool.fr.nf', 'jetable.org', 'jetable.fr.nf', 'nospam.ze.tc', 'mailnesia.com',
  'maildrop.cc', 'mintemail.com', 'mohmal.com', 'mytemp.email', 'spam4.me',
  'fakeinbox.com', 'fake-mail.net', 'mailcatch.com', 'mailsac.com', 'inboxbear.com',
  'spamgourmet.com', 'spambog.com', 'my10minutemail.com', 'discard.email',
  'burnermail.io', '33mail.com', 'anonaddy.com', 'anonaddy.me', 'mail-temp.com',
  'emailondeck.com', 'moakt.com', 'tmail.ws', 'tmailinator.com', 'onetimemail.org',
  'instantemailaddress.com', 'tempmailaddress.com', 'mail7.io', 'muellmail.com',
  'spambox.us', 'luxusmail.org', '1secmail.com', '1secmail.org', '1secmail.net',
  'esiix.com', 'wwjmp.com', 'xojxe.com', 'yoggm.com', 'vjuum.com', 'laafd.com',
  'txcct.com', 'kzccv.com', 'qiuea.com', 'psnator.com', 'many.email', 'dropmail.me',
  'minutemail.com', 'minuteinbox.com', 'email-fake.com', 'fakemailgenerator.com',
  'tempinbox.com', 'tempmail.plus', 'etempmail.com', 'tempmail.plus.com',
]);

const DISPOSABLE_KEYWORDS = ['tempmail', 'temp-mail', '10minute', 'throwaway', 'trashmail', 'guerrilla', 'yopmail', 'sharklasers', 'fakeinbox', 'spamgourmet'];

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return false;

  // Exact domain or subdomain match (mailinator.com / sub.mailinator.com)
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DISPOSABLE_DOMAINS.has(candidate)) return true;
  }
  // Keyword heuristic for unknown throwaway providers
  if (DISPOSABLE_KEYWORDS.some((k) => domain.includes(k))) return true;
  return false;
}
