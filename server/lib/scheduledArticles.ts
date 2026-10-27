/**
 * 2.10.0 — AUTOMATSKO OBJAVLJIVANJE ZAKAZANIH ČLANAKA
 * ---------------------------------------------------
 * Isti obrazac kao newsletter scheduler (`lib/campaigns.ts`):
 * `setInterval` 60 s + `unref`, guard protiv preklapanja tikova, `try/catch`
 * oko svakog tika (greška ne ubija tajmer), prvi prolaz odmah po startu
 * (restart u toku zakazanog minuta ne gubi objavu).
 *
 * Podaci: članak sa `status = 'scheduled'` ima u `published_at` ZAKAZANI
 * trenutak objave. Job svaki tik zove `db.articles.publishDue()` koji
 * atomski prebacuje dospelu `scheduled` → `published` (uslov se proverava
 * u SQL-u / jednom prolazu, pa nema race-a). `published_at` se NE dira —
 * datum objave ostaje tačno zakazano vreme.
 *
 * Kill-switch: `SCHEDULED_ARTICLES_ENABLED=0`.
 */

import { db } from './store.js';
import { logger } from './logger.js';
import { captureError } from './sentry.js';

/** Interval provere (ms) — identičan newsletter scheduleru (60 s). */
const INTERVAL_MS = 60_000;

/**
 * Jedan tik joba: aktivira sve dospele zakazane članke i loguje ih.
 * Izdvojeno kao export radi testiranja bez tajmera.
 */
export async function publishScheduledArticlesJob(now: Date = new Date()): Promise<number> {
  const published = await db.articles.publishDue(now);
  if (published.length > 0) {
    logger.info(
      {
        count: published.length,
        articles: published.map((a) => ({ id: a.id, title: a.title, publishedAt: a.publishedAt })),
      },
      'scheduled_articles_published',
    );
    // Push notifikacije su best-effort: neka greška u push-u ne vraća job u prošlost.
    void notifyAuthorPublished(published);
  }
  return published.length;
}

/**
 * Best-effort push AUTORU svakog novopečenog članka (ruta `push.ts` je no-op
 * bez konfiguracije, pa ovde ne može da se desi ništa opasno). Sistemskog
 * broadcast-a pretplatnicima nema, pa se ne izmišlja novi mehanizam.
 */
async function notifyAuthorPublished(
  published: { authorId: string; title: string; slug: string }[],
): Promise<void> {
  try {
    const { sendPushToUser } = await import('../routes/push.js');
    for (const article of published) {
      if (!article.authorId) continue;
      await sendPushToUser(article.authorId, {
        title: 'Članak je objavljen',
        body: article.title,
        url: `/article/${article.slug}`,
      });
    }
  } catch (err) {
    logger.debug({ err }, 'scheduled_articles_push_skipped');
  }
}

/** Tajmer po šablonu `startNewsletterScheduler`. */
export function startScheduledArticlePublisher(): NodeJS.Timeout | null {
  if (process.env.SCHEDULED_ARTICLES_ENABLED === '0') {
    logger.info('scheduled_articles_scheduler_disabled');
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await publishScheduledArticlesJob();
    } catch (error) {
      logger.warn({ err: error }, 'scheduled_articles_scheduler_failed');
      captureError(error, { source: 'scheduledArticles' });
    } finally {
      running = false;
    }
  };
  // Prvi prolaz odmah po startu (restart u toku zakazanog minuta).
  void tick();
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  return timer;
}
