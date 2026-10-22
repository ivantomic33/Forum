import { logger } from './logger.js';

/**
 * EMAIL SERVIS (Resend / Brevo) — 2.4.4
 * --------------------------------------
 * Bez `RESEND_API_KEY` ili `BREVO_API_KEY` mejl se ne šalje; u razvoju se
 * događaj loguje (link samo uz `DEV_EXPOSE_TOKENS=1`), a u produkciji se prijavi
 * jasna greška — server u produkciji bez provajdera uopšte ne startuje
 * (vidi `assertProductionConfig` u index.ts). Ovo je namerno: nema tihog pada.
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

export async function sendEmail(input: MailInput): Promise<boolean> {
  const text = input.text ?? input.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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
  });
}

export async function sendNewsletterConfirmation(to: string, token: string): Promise<boolean> {
  const href = `${clientUrl()}/newsletter/confirm?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Potvrdite NEXUS newsletter pretplatu',
    html: layout('Još jedan korak', 'Kliknite da potvrdite pretplatu na NEXUS newsletter. Link važi 48 sati.', {
      href,
      label: 'Potvrdi pretplatu',
    }),
    text: `Potvrdite newsletter pretplatu: ${href}`,
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
