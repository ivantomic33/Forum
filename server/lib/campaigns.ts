/**
 * A/B TEST + ZAKAZIVANJE NEWSLETTERA
 * -----------------------------------
 * 2.6.2 je imala samo trenutno slanje (`POST /admin/broadcast`). Ovde su dve
 * stvari koje „nedostaju“ u Â§7.1:
 *
 *  1. **Zakazivanje** — kampanja se upisuje u `site_meta` (jedan zapis liste) i
 *     šalje je ista vrsta tajmera kao za digest (`setInterval` 60 s, `unref`),
 *     pa preživi restart servera. Prošli rok (do 10 min) se šalje odmah —
 *     restart u toku zakazanog minuta ne gubi kampanju; stariji od 6 h se
 *     označava `missed` (bolje nego poslati nedelju dana staru vest).
 *  2. **A/B test naslova** — segment se deli deterministički po adresi (hash),
 *     polovina dobija `subject`, polovina `subjectB`. Nema „pobednika“ (otvaranja
 *     se ne prate), pa je test namerno samo za merenje u spoljnom alatu: cilj je
 *     da polovina liste vidi drugi naslov, ne automatsko slanje pobednika.
 *
 * NAPOMENA: SLANJE JE UGAŠENO — mejl se šalje samo za verifikaciju adrese i
 * reset lozinke. `deliverCampaign` zato ništa ne šalje (vraća nule), a red
 * zakazanih kampanja ostaje u `site_meta` samo radi pregleda/otkazivanja.
 */

import { createHash } from 'node:crypto';
import { logger } from './logger.js';
import { getSharedValue, setSharedValue } from './sharedStore.js';
import { appUrl } from './email.js';
import { sanitizeSubject } from './newsletter.js';

const QUEUE_KEY = 'newsletter.scheduled';
const MAX_QUEUE = 25;
/** Koliko dugo posle roka još šaljemo (restart/ispad intervala), a posle â†’ `missed`. */
const GRACE_MS = 6 * 60 * 60 * 1000;
const MIN_LEAD_MS = 60 * 1000;

export type CampaignSegment = 'active' | 'pending' | 'all';

export interface ScheduledCampaign {
  id: string;
  subject: string;
  subjectB: string | null;
  content: string;
  segment: CampaignSegment;
  scheduledAt: string;
  createdAt: string;
  createdBy: string;
  status: 'scheduled' | 'sent' | 'failed' | 'missed';
  sentAt?: string;
  sentCount?: number;
  failed?: number;
  error?: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest();

/**
 * A/B podela: ista adresa uvek ide u ISTU grupu (stabilno pri ponovnom slanju i
 * bez nasumičnosti koja bi dva testa pomešala). Polovina A / polovina B Â±1 red.
 */
export function abBucket(email: string): 'a' | 'b' {
  return hash(email.trim().toLowerCase())[0] % 2 === 0 ? 'a' : 'b';
}

export async function listScheduled(): Promise<ScheduledCampaign[]> {
  const queue = await getSharedValue<ScheduledCampaign[]>(QUEUE_KEY);
  if (!Array.isArray(queue)) return [];
  return queue
    .filter((campaign) => campaign && typeof campaign.id === 'string')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

async function writeQueue(queue: ScheduledCampaign[]): Promise<void> {
  // Red ne sme da raste u nedogled: zadržavamo poslednjih MAX_QUEUE zapisa.
  await setSharedValue(QUEUE_KEY, queue.slice(-MAX_QUEUE));
}

/**
 * Slanje kampanje segmentu — UGAŠENO.
 *
 * Mejl se šalje SAMO za verifikaciju adrese i reset lozinke, pa newsletter
 * kampanje i digest više ne izlaze. Funkcija ostaje (isti ugovor) i vraća
 * nule, da zakazane kampanje u redu ne bi padale i da admin UI dobije
 * iskren odgovor „poslato 0“.
 */
export async function deliverCampaign(_input: {
  subject: string;
  subjectB?: string | null;
  content: string;
  segment: CampaignSegment;
}): Promise<{ sentCount: number; failed: number; subjectB: number; disabled?: true }> {
  logger.info('newsletter_campaign_disabled');
  return { sentCount: 0, failed: 0, subjectB: 0, disabled: true };
}

/** Upisuje kampanju u red. Rok mora biti u budućnosti (min. 1 min). */
export async function scheduleCampaign(input: {
  subject: string;
  subjectB?: string | null;
  content: string;
  segment?: CampaignSegment;
  scheduledAt: string;
  createdBy: string;
}): Promise<ScheduledCampaign> {
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error('Datum zakazivanja nije ispravan.');
  if (when.getTime() < Date.now() + MIN_LEAD_MS) {
    throw new Error('Zakazivanje mora biti najmanje minut u budućnosti.');
  }

  const queue = await listScheduled();
  if (queue.filter((campaign) => campaign.status === 'scheduled').length >= MAX_QUEUE) {
    throw new Error(`Najviše ${MAX_QUEUE} zakazanih kampanja istovremeno.`);
  }

  const campaign: ScheduledCampaign = {
    id: `nsc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    subject: sanitizeSubject(input.subject),
    subjectB: input.subjectB ? sanitizeSubject(input.subjectB) : null,
    content: input.content,
    segment: input.segment ?? 'active',
    scheduledAt: when.toISOString(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    status: 'scheduled',
  };
  queue.push(campaign);
  await writeQueue(queue);
  return campaign;
}

export async function cancelScheduled(id: string): Promise<boolean> {
  const queue = await listScheduled();
  const campaign = queue.find((item) => item.id === id);
  if (!campaign || campaign.status !== 'scheduled') return false;
  campaign.status = 'missed';
  campaign.error = 'Otkazano pre slanja.';
  await writeQueue(queue);
  return true;
}

/**
 * Jedan prolaz reda. Vraća broj poslatih; baca samo ako upis reda padne
 * (greška provajdera je upisana u `failed`, ne obara tajmer).
 */
export async function runDueCampaigns(now = Date.now()): Promise<{ sent: number }> {
  const queue = await listScheduled();
  const due = queue.filter((campaign) => campaign.status === 'scheduled' && new Date(campaign.scheduledAt).getTime() <= now);
  if (!due.length) return { sent: 0 };

  let sent = 0;
  for (const campaign of due) {
    if (now - new Date(campaign.scheduledAt).getTime() > GRACE_MS) {
      campaign.status = 'missed';
      campaign.error = 'Rok je prošao dok server nije radio (preko 6 h).';
      continue;
    }
    try {
      const result = await deliverCampaign({
        subject: campaign.subject,
        subjectB: campaign.subjectB,
        content: campaign.content,
        segment: campaign.segment,
      });
      campaign.status = result.failed > 0 && result.sentCount === 0 ? 'failed' : 'sent';
      campaign.sentAt = new Date().toISOString();
      campaign.sentCount = result.sentCount;
      campaign.failed = result.failed;
      sent += 1;
      logger.info(
        { campaignId: campaign.id, sentCount: result.sentCount, failed: result.failed, abB: result.subjectB },
        'scheduled_campaign_sent',
      );
    } catch (error) {
      campaign.status = 'failed';
      campaign.error = error instanceof Error ? error.message : String(error);
      logger.warn({ err: error, campaignId: campaign.id }, 'scheduled_campaign_failed');
    }
  }
  await writeQueue(queue);
  return { sent };
}

/** Tajmer: provera svakih 60 s (jeftino — jedan `site_meta` upit). */
export function startNewsletterScheduler(): NodeJS.Timeout | null {
  if (process.env.NEWSLETTER_SCHEDULER === '0') {
    logger.info('newsletter_scheduler_disabled');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueCampaigns();
    } catch (error) {
      logger.warn({ err: error }, 'newsletter_scheduler_failed');
    } finally {
      running = false;
    }
  };
  // Prvi prolaz odmah po startu (restart u toku zakazanog minuta).
  void tick();
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  return timer;
}

/** Za admin UI: javni URL koji se koristi u mejlovima (bez otkrivanja tajni). */
export const campaignPublicUrl = () => appUrl();
