import { logger } from './logger.js';

/**
 * EMAIL SERVIS (Resend / Brevo) — 2.4.4
 * --------------------------------------
 * Bez `RESEND_API_KEY` ili `BREVO_API_KEY` mejl se ne šalje; u razvoju se
 * događaj loguje (link samo uz `DEV_EXPOSE_TOKENS=1`), a u produkciji se prijavi
 * jasna greška — server u produkciji bez provajdera uopšte ne startuje
 * (vidi `assertProductionConfig` u index.ts). Ovo je namerno: nema tihog pada.
 *
 * Dozvoljeni sadržaj: SAMO verifikacija adrese i reset lozinke (vidi
 * `TransactionalEmailKind`). Sve ostale notifikacije ostaju u aplikaciji.
 *
 * Env:
 *   RESEND_API_KEY, EMAIL_FROM   (npr. "NEXUS <noreply@nexus.rs>")
 *   BREVO_API_KEY (alternativa Resend-u)
 *   CLIENT_URL — bazni URL za linkove u mejlu
 */

interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Vrsta mejla. Samo `verification` i `password_reset` se šalju — svaki drugi
   * poziv se odbija (`email_blocked_non_transactional`). Bez polja = odbijeno.
   */
  kind?: TransactionalEmailKind;
}

const from = () => process.env.EMAIL_FROM || 'NEXUS <onboarding@resend.dev>';

/**
 * Bazni URL za linkove u mejlovima (F-15).
 *
 * `CLIENT_URL` može biti lista domena (`https://nexus.rs,https://www.nexus.rs`)
 * — ranije je ceo string išao u link (`https://a,https://b/verify?...`).
 * Zato: `PUBLIC_APP_URL` ima prioritet, a inače se koristi PRVI element liste.
 */
export const appUrl = (): string => {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  const first = (explicit || process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')[0]
    .trim();
  return first.replace(/\/$/, '');
};
const clientUrl = appUrl;

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);

/**
 * Dev pomoć: link se ispiše samo ako su uključeni i razvoj i eksplicitni
 * `DEV_EXPOSE_TOKENS=1` — isti uslov po kome se token vraća u API odgovoru (F-02).
 */
const devLinksInLog = () => process.env.NODE_ENV === 'development' && process.env.DEV_EXPOSE_TOKENS === '1';

/**
 * Jedini mejlovi koji smeju da napuste server: verifikacija adrese i reset
 * lozinke. Notifikacije (bedž, uloga, odgovor, pad cene, newsletter, digest…)
 * žive u aplikaciji, pa je ovo posledna barijera — ako neki poziv slučajno
 * ostane u kodu, mejl se ne šalje i u log odlazi razlog.
 */
export type TransactionalEmailKind = 'verification' | 'password_reset';
const ALLOWED_KINDS: ReadonlySet<TransactionalEmailKind> = new Set(['verification', 'password_reset']);

export async function sendEmail(input: MailInput): Promise<boolean> {
  const text = input.text ?? input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  if (!input.kind || !ALLOWED_KINDS.has(input.kind)) {
    // Nema provajdera, nema poziva — samo trag u logu (bez primalaca, bez sadržaja).
    logger.warn({ subject: input.subject, kind: input.kind ?? null }, 'email_blocked_non_transactional');
    return false;
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: from(), to: [input.to], subject: input.subject, html: input.html, text }),
      });
      if (!res.ok) {
        logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'resend_send_failed');
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, 'resend_send_error');
      return false;
    }
  }

  if (process.env.BREVO_API_KEY) {
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: from().replace(/.*<|>.*/g, ''), name: 'NEXUS' },
          to: [{ email: input.to }],
          subject: input.subject,
          htmlContent: input.html,
          textContent: text,
        }),
      });
      if (!res.ok) {
        logger.error({ status: res.status, body: await res.text().catch(() => '') }, 'brevo_send_failed');
        return false;
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, 'brevo_send_error');
      return false;
    }
  }

  // Nema provajdera: u razvoju se link ispisuje u log samo uz `DEV_EXPOSE_TOKENS=1`
  // (ista politika kao za tokene u API odgovoru, F-02).
  if (process.env.NODE_ENV !== 'production') {
    if (devLinksInLog()) {
      logger.info({ to: input.to, subject: input.subject }, 'email_skipped_no_provider');
      logger.debug({ text }, 'email_dev_link');
    } else {
      logger.info({ to: input.to, subject: input.subject, linkLogged: false }, 'email_skipped_no_provider');
    }
    return false;
  }

  logger.error({ to: input.to, subject: input.subject }, 'email_provider_missing_in_production');
  return false;
}

const layout = (title: string, body: string, cta?: { href: string; label: string }) => `
<div style="font-family:Inter,Arial,sans-serif;background:#06070b;color:#e5e7eb;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#0a0c13;border:1px solid #222940;border-radius:16px;padding:28px">
    <h1 style="font-size:20px;margin:0 0 16px;color:#fff">${title}</h1>
    <p style="line-height:1.6;color:#c7c9d3;margin:0 0 20px">${body}</p>
    ${cta ? `<a href="${cta.href}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${cta.label}</a>` : ''}
    <p style="font-size:12px;color:#6b7280;margin:24px 0 0">Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.</p>
  </div>
</div>`;

export async function sendVerificationEmail(to: string, username: string, token: string): Promise<boolean> {
  const href = `${clientUrl()}/verify?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Potvrdite svoju NEXUS email adresu',
    html: layout(
      `Dobrodošao/la, ${username}!`,
      'Potvrdite email adresu kako biste aktivirali nalog. Link važi 24 sata.',
      { href, label: 'Potvrdi email adresu' },
    ),
    text: `Potvrdite svoju NEXUS email adresu: ${href}`,
    kind: 'verification',
  });
}

export async function sendPasswordResetEmail(to: string, username: string, token: string): Promise<boolean> {
  const href = `${clientUrl()}/reset?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'NEXUS — reset lozinke',
    html: layout(
      `Reset lozinke za ${username}`,
      'Zatražili ste promenu lozinke. Link važi 30 minuta i može se koristiti samo jednom.',
      { href, label: 'Postavi novu lozinku' },
    ),
    text: `Reset lozinke (važi 30 min): ${href}`,
    kind: 'password_reset',
  });
}

/**
 * 5.2 — NOVA PRIJAVA / SUMNJIVA AKTIVNOST.
 *
 * Transakcioni mejl: korisnik treba da zna da je neko koristio njegov nalog
 * (nova IP adresa, drugi uređaj, zaključana 2FA). Nema odjave — nije newsletter.
 * Ne sadrži nikakve tokene ni linkove za promenu lozinke (phishing bi kopirao mejl).
 */
export async function sendLoginAlertEmail(
  to: string,
  input: {
    username: string;
    reason: 'new_device' | 'new_ip' | 'suspicious' | 'passkey_added' | 'passkey_removed';
    ip?: string | null;
    userAgent?: string | null;
    at?: Date;
  },
): Promise<boolean> {
  const titles: Record<typeof input.reason, string> = {
    new_device: 'Nova prijava na NEXUS',
    new_ip: 'Prijava sa nove IP adrese',
    suspicious: 'Sumnjiva aktivnost na vašem nalogu',
    passkey_added: 'Novi passkey je dodat',
    passkey_removed: 'Passkey je uklonjen',
  };
  const details = [
    input.userAgent ? `Uređaj: ${input.userAgent}` : null,
    input.ip ? `IP adresa: ${input.ip}` : null,
    `Vreme: ${(input.at ?? new Date()).toLocaleString('sr-RS')}`,
  ]
    .filter(Boolean)
    .join('<br>');

  return sendEmail({
    to,
    subject: `NEXUS — ${titles[input.reason]}`,
    html: layout(
      `Zdravo, ${input.username}`,
      `${titles[input.reason]}.<br><br>${details}<br><br>` +
        'Ako ste to bili vi, ništa ne treba da radite. Ako niste, odmah promenite lozinku i ' +
        'odjavite sve uređaje u profilu → Bezbednost.',
      { href: `${clientUrl()}/forgot-password`, label: 'Promeni lozinku' },
    ),
    text: `${titles[input.reason]}. ${details.replace(/<br>/g, '\n')} Promeni lozinku: ${clientUrl()}/forgot-password`,
  });
}

/**
 * UGAŠENO — potvrda newsletter pretplate (double opt-in).
 *
 * Mejl se šalje SAMO za verifikaciju adrese i reset lozinke, pa se newsletter
 * potvrda više ne šalje. Funkcija ostaje (isti potpis) i vraća `false` —
 * pozivaoci već tretiraju `false` kao „mejl nije poslat“.
 */
export async function sendNewsletterConfirmation(_to: string, _token: string): Promise<boolean> {
  return false;
}

/**
 * F-4 — PRICE ALERT: „igra koju pratite je sada ispod vaše cene“.
 *
 * Transakcioni mejl (korisnik ga je eksplicitno tražio pritiskom na „Prati“),
 * pa NEMA newsletter odjavu — skidanje praćenja je u profilu (link u mejlu).
 */
export async function sendPriceAlertEmail(
  to: string,
  input: {
    username: string;
    gameTitle: string;
    targetPrice: number;
    deal: { title: string; price: number; originalPrice: number; discountPct: number; currency: string; store: string; id: string };
    watchUrl: string;
  },
): Promise<boolean> {
  const money = (value: number) =>
    new Intl.NumberFormat('sr-Latn-RS', { style: 'currency', currency: input.deal.currency || 'EUR' }).format(value);
  const href = `${clientUrl()}/deals/${encodeURIComponent(input.deal.id)}`;
  return sendEmail({
    to,
    subject: `${input.gameTitle} — ${money(input.deal.price)} (${input.deal.discountPct}% popusta, ${input.deal.store})`,
    html: layout(
      `Cena za „${input.gameTitle}“ je pala`,
      `Tražili ste obaveštenje ispod <strong>${money(input.targetPrice)}</strong>. ` +
        `Sada je <strong>${money(input.deal.price)}</strong> (bilo ${money(input.deal.originalPrice)}) u prodavnici ${input.deal.store}.`,
      { href, label: 'Pogledaj ponudu' },
    ).replace(
      'Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.',
      `<a href="${input.watchUrl}" style="color:#a78bfa">Prekini praćenje cene</a> · Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.`,
    ),
    text: `${input.gameTitle} je sada ${money(input.deal.price)} (cilj ${money(input.targetPrice)}): ${href}`,
  });
}

/**
 * F-7.1 #8 — „PRATI TEMU MEJLOM“: novi odgovor u praćenoj temi.
 *
 * Transakcioni mejl (korisnik ga je tražio štikliranjem), pa nema newsletter
 * odjave — `unfollowUrl` gasi mejl za TU temu jednim klikom (`/thread/:id` sa
 * `?unfollow=1`, klijent tada zove `DELETE /follow`). `link` vodi na konkretan
 * odgovor (`#post-<id>`), ne na vrh teme.
 *
 * Sadržaj odgovora je HTML iz editora: `excerpt` stiže kao ČIST TEKST (server ga
 * skraćuje pre poziva) i ovde se escape-uje — nikad se ne ubacuje tuđi HTML.
 */
const escapeThreadHtml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * 2.11.0 — GENERIČKI MEJL ZA NOTIFIKACIJU.
 *
 * Inbox (`notifications`) je izvor istine; ovaj mejl je samo kanal „obavesti me“
 * za događaje koje je korisnik eksplicitno uključio (`notify_email_prefs` u
 * `site_meta`). Naslov i tekst su VEĆ očišćeni (`sanitizeText`) pre dolaska
 * ovamo, a ovde se ipak escape-uju — nikad se ne ubacuje tuđi HTML.
 */
export async function sendNotificationEmail(
  to: string,
  input: { title: string; message: string; path: string; settingsUrl?: string },
): Promise<boolean> {
  const href = `${appUrl()}${input.path}`;
  const settingsUrl = input.settingsUrl ?? `${appUrl()}/settings#notifications`;
  const title = input.title.length > 120 ? `${input.title.slice(0, 120)}…` : input.title;
  const message = input.message.length > 400 ? `${input.message.slice(0, 400)}…` : input.message;

  return sendEmail({
    to,
    subject: title,
    html: layout(
      escapeThreadHtml(title),
      `${escapeThreadHtml(message)}`,
      { href, label: 'Pogledaj na NEXUS-u' },
    ).replace(
      'Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.',
      `<a href="${escapeThreadHtml(settingsUrl)}" style="color:#a78bfa">Promeni koje notifikacije dobijaš mejlom</a> · Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.`,
    ),
    text: `${title}\n\n${message}\n\n${href}\n\nPodešavanja: ${settingsUrl}`,
  });
}

export async function sendThreadReplyEmail(
  to: string,
  input: {
    username: string;
    threadTitle: string;
    authorUsername: string;
    excerpt: string;
    threadPath: string;
    unfollowUrl: string;
  },
): Promise<boolean> {
  const href = `${clientUrl()}${input.threadPath}`;
  const title = input.threadTitle.length > 90 ? `${input.threadTitle.slice(0, 90)}…` : input.threadTitle;
  return sendEmail({
    to,
    subject: `Novi odgovor u „${title}“`,
    html: layout(
      'Novi odgovor u temi koju pratite',
      `${escapeThreadHtml(input.authorUsername)} je odgovorio u <strong>${escapeThreadHtml(title)}</strong>:`,
      { href, label: 'Otvori odgovor' },
    ).replace(
      'Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.',
      `<blockquote style="border-left:3px solid #4c1d95;margin:0 0 20px;padding:4px 0 4px 12px;color:#9ca3af;font-size:14px">${escapeThreadHtml(input.excerpt)}</blockquote>
      <a href="${escapeThreadHtml(input.unfollowUrl)}" style="color:#a78bfa">Ne šalji više mejlove za ovu temu</a> · Ako niste vi pokrenuli ovu radnju, ignorišite ovaj mejl.`,
    ),
    text: `${input.authorUsername} je odgovorio u „${title}“: ${input.excerpt}\n\n${href}\n\nBez mejlova za ovu temu: ${input.unfollowUrl}`,
  });
}

/**
 * 2.6.2 — newsletter kampanja (admin). Svaki mejl nosi vlastiti potpisani
 * link za odjavu, pa se kampanja ne šalje pretplatnicima koji su se odjavili
 * posle njenog zakazivanja. Isti layout kao transakcioni mejlovi.
 */
export async function sendNewsletterCampaign(
  to: string,
  input: { subject: string; html: string; unsubscribeUrl: string },
): Promise<boolean> {
  return sendEmail({
    to,
    subject: input.subject,
    html: `${input.html}
<p style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#6b7280;margin:24px 0 0">
  Dobijate ovaj mejl jer ste potvrdili NEXUS newsletter.
  <a href="${input.unsubscribeUrl}" style="color:#a78bfa">Odjavi se jednim klikom</a>.
</p>`,
  });
}

/**
 * F-8 — NEDELJNI DIGEST „Najbolje iz NEXUS-a“.
 *
 * Zašto nije kampanja: kampanja je ručni admin mejl jednom, a digest ide sam
 * svake nedelje SVIM potvrđenim pretplatnicima. Zato ima svoj šablon (3 stavke
 * + 2 popusta), svoj potpisani link za odjavu (isti `newsletter_unsubscribe`
 * token kao kampanja) i isti `sendEmail` provajder.
 *
 * `html` se sklapa iz podataka, ne iz admin HTML-a — nema načina da se u mejl
 * ubaci tuđi HTML, pa nema ni sanitizacije na ovom mestu.
 */
export interface DigestItem {
  title: string;
  href: string;
  excerpt?: string | null;
}

export interface DigestDeal {
  title: string;
  href: string;
  price: string;
  store: string;
  discountPct: number;
}

/** Digest ima svoju kopiju (fajl je dug; ime se razlikuje da ne zaseni gornju). */
const escapeHtmlDigest = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderDigest(input: {
  items: DigestItem[];
  deals: DigestDeal[];
  unsubscribeUrl: string;
  weekLabel: string;
}): { subject: string; html: string; text: string } {
  const base = clientUrl();
  const itemHtml = input.items
    .map(
      (item) => `<li style="margin:0 0 14px">
        <a href="${escapeHtmlDigest(base + item.href)}" style="color:#c4b5fd;font-weight:600;text-decoration:none">${escapeHtmlDigest(item.title)}</a>
        ${item.excerpt ? `<div style="font-size:13px;color:#9ca3af;margin-top:4px">${escapeHtmlDigest(item.excerpt)}</div>` : ''}
      </li>`,
    )
    .join('');

  const dealHtml = input.deals
    .map(
      (deal) => `<li style="margin:0 0 10px">
        <a href="${escapeHtmlDigest(base + deal.href)}" style="color:#e5e7eb;text-decoration:none">${escapeHtmlDigest(deal.title)}</a>
        — <span style="color:#34d399;font-weight:600">${escapeHtmlDigest(deal.price)}</span>
        <span style="color:#6b7280;font-size:12px">(-${deal.discountPct}%, ${escapeHtmlDigest(deal.store)})</span>
      </li>`,
    )
    .join('');

  const subject = `Najbolje iz NEXUS-a — ${input.weekLabel}`;
  const html = `
<div style="font-family:Inter,Arial,sans-serif;background:#06070b;color:#e5e7eb;padding:32px">
  <div style="max-width:560px;margin:0 auto;background:#0a0c13;border:1px solid #222940;border-radius:16px;padding:28px">
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7c3aed;margin-bottom:8px">NEXUS · ${escapeHtmlDigest(input.weekLabel)}</div>
    <h1 style="font-size:20px;margin:0 0 18px;color:#fff">Najbolje iz NEXUS-a</h1>
    ${input.items.length ? `<h2 style="font-size:14px;color:#9ca3af;margin:0 0 10px">Pročitali ste?</h2><ul style="padding-left:18px;margin:0 0 22px">${itemHtml}</ul>` : ''}
    ${input.deals.length ? `<h2 style="font-size:14px;color:#9ca3af;margin:0 0 10px">Popusti koji ističu</h2><ul style="padding-left:18px;margin:0 0 22px">${dealHtml}</ul>` : ''}
    <a href="${escapeHtmlDigest(base + '/')}" style="display:inline-block;background:#8b5cf6;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Otvori NEXUS</a>
    <p style="font-family:Inter,Arial,sans-serif;font-size:12px;color:#6b7280;margin:24px 0 0">
      Dobijate ovaj sažetak jer ste potvrdili NEXUS newsletter.
      <a href="${escapeHtmlDigest(input.unsubscribeUrl)}" style="color:#a78bfa">Odjavi se jednim klikom</a>.
    </p>
  </div>
</div>`;

  const text = [
    `Najbolje iz NEXUS-a — ${input.weekLabel}`,
    ...input.items.map((item) => `• ${item.title}: ${base}${item.href}`),
    ...input.deals.map((deal) => `• ${deal.title} — ${deal.price} (-${deal.discountPct}%, ${deal.store}): ${base}${deal.href}`),
    `Odjava: ${input.unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text };
}

export async function sendWeeklyDigest(
  to: string,
  input: Parameters<typeof renderDigest>[0],
): Promise<boolean> {
  const { subject, html, text } = renderDigest(input);
  return sendEmail({ to, subject, html, text });
}
