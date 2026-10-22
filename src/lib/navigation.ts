/**
 * B-06 — bezbedan `next` za preusmeravanje posle prijave.
 *
 * Prihvata samo INTERNU putanju: `?next=/admin`, `?next=/deals?x=1` ili
 * `state.from` iz guard-a. Sve što je apsolutni URL, protokol-relative
 * (`//evil.com`) ili ne-putanja ignorise se i vraća se na početnu.
 */
export function safeNextPath(candidate: unknown, fallback = '/'): string {
  if (typeof candidate !== 'string') return fallback;
  const value = candidate.trim();

  // Mora da počne jednim `/`, ali ne `//` (protocol-relative) ni `/\` (browser ga tretira kao `//`).
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Preventivno: bez kontrolnih karaktera i bez pokušaja da se „pređe“ izvan domena.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  // Auth stranice kao cilj bi napravile petlju (npr. istekao reset link).
  if (/^\/(login|register|auth)(\/|\?|$)/i.test(value)) return fallback;

  return value;
}
