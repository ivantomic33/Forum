import { afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.JWT_SECRET ||= 'test-secret-for-campaign-tests-0123456789abc';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

// `db`/`campaigns` dolaze POSLE env-a: `routes/newsletter.ts` (uvoz kroz
// `campaigns`) čita `JWT_SECRET` u modulu, pa statički import bi pao.
const { db } = await import('../lib/store.js');
const { clearSharedValues } = await import('../lib/sharedStore.js');
const { abBucket, cancelScheduled, deliverCampaign, listScheduled, runDueCampaigns, scheduleCampaign } =
  await import('../lib/campaigns.js');

/**
 * Zakazivanje newsletter kampanja + A/B test naslova.
 *
 * Mreža se presreće: Resend pozivi se hvataju, pa se proverava KOJI naslov ide
 * KOJOJ adresi, koliko ih je i da se odjavljeni nikad ne kontaktiraju.
 */

process.env.JWT_SECRET ||= 'test-secret-for-campaign-tests-0123456789abc';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'memory';

const subscribe = async (email: string, status: 'confirmed' | 'pending' | 'unsubscribed') => {
  // Kroz repo: `subscribe` uvek pravi "pending"; `confirm`/`unsubscribe` daju ostala stanja.
  await db.newsletter.subscribe(email);
  if (status === 'confirmed') await db.newsletter.confirm(email);
  if (status === 'unsubscribed') await db.newsletter.unsubscribe(email);
};

describe.skipIf(db.kind !== 'memory')('newsletter kampanje — zakazivanje i A/B', () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalScheduler = process.env.NEWSLETTER_SCHEDULER;
  let sent: Array<{ to: string[]; subject: string }> = [];
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    clearSharedValues();
    sent = [];
    process.env.RESEND_API_KEY = 'test-key';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('api.resend.com')) {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = realFetch;
    };

    await subscribe('a1@example.com', 'confirmed');
    await subscribe('a2@example.com', 'confirmed');
    await subscribe('b1@example.com', 'confirmed');
    await subscribe('b2@example.com', 'confirmed');
    await subscribe('wait@example.com', 'pending');
    await subscribe('gone@example.com', 'unsubscribed');
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalScheduler === undefined) delete process.env.NEWSLETTER_SCHEDULER;
    else process.env.NEWSLETTER_SCHEDULER = originalScheduler;
  });

  it('A/B: polovina dobija naslov A, polovina B — ista adresa uvek isti bucket', () => {
    expect(abBucket('a1@example.com')).toBe(abBucket('A1@Example.com'));
    const buckets = ['a1', 'a2', 'b1', 'b2'].map((name) => abBucket(`${name}@example.com`));
    expect(buckets.filter((b) => b === 'a').length + buckets.filter((b) => b === 'b').length).toBe(4);
  });

  it('deliverCampaign ništa ne šalje — mejl je ugašen (samo verifikacija i reset)', async () => {
    const result = await deliverCampaign({
      subject: 'Naslov A',
      subjectB: 'Naslov B',
      content: '<p>Zdravo</p>',
      segment: 'active',
    });

    expect(result).toMatchObject({ sentCount: 0, failed: 0, subjectB: 0, disabled: true });
    expect(sent).toHaveLength(0);
  });

  it('zakazivanje: rok u prošlosti se odbija, budući ulazi u red', async () => {
    await expect(
      scheduleCampaign({
        subject: 'Previše rano',
        content: '<p>x</p>',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        createdBy: 'admin',
      }),
    ).rejects.toThrow(/najmanje minut/);

    const planned = new Date(Date.now() + 30 * 60_000);
    const campaign = await scheduleCampaign({
      subject: '  Test naslov  ',
      subjectB: ' Test B ',
      content: '<p>sadržaj</p>',
      scheduledAt: planned.toISOString(),
      createdBy: 'admin',
    });
    expect(campaign.status).toBe('scheduled');
    expect(campaign.subject).toBe('Test naslov');

    const queue = await listScheduled();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(campaign.id);
  });

  it('runDueCampaigns: pre roka ništa; u roku prođe bez ijednog mejla', async () => {
    const campaign = await scheduleCampaign({
      subject: 'Zakazano',
      content: '<p>x</p>',
      scheduledAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      createdBy: 'admin',
    });

    // „Sada“ = pre roka → nema slanja.
    expect((await runDueCampaigns(Date.now())).sent).toBe(0);
    expect(sent).toHaveLength(0);

    // Posle roka → prolaz obrađuje kampanju, ali mejl ne odlazi.
    expect((await runDueCampaigns(Date.now() + 3 * 60_000)).sent).toBe(1);
    expect(sent).toHaveLength(0);

    const queue = await listScheduled();
    const done = queue.find((item) => item.id === campaign.id);
    expect(done?.status).toBe('sent');
    expect(done?.sentCount).toBe(0);
    expect(done?.sentAt).toBeTruthy();

    // Idempotentno: drugi prolaz ne obrađuje istu kampanju ponovo.
    expect((await runDueCampaigns(Date.now() + 5 * 60_000)).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('propušten rok (preko 6 h) se označi `missed` i ne šalje se', async () => {
    const campaign = await scheduleCampaign({
      subject: 'Staro',
      content: '<p>x</p>',
      // Rok je 40 min u prošlosti u odnosu na „sada“ prolaza → preko 6 h propušteno.
      scheduledAt: new Date(Date.now() + 40 * 60_000).toISOString(),
      createdBy: 'admin',
    });
    await runDueCampaigns(Date.now() + 7 * 3_600_000);
    expect(sent).toHaveLength(0);
    expect((await listScheduled()).find((item) => item.id === campaign.id)?.status).toBe('missed');
});

it('otkazivanje: `scheduled` → otkazano, već poslata kampanja se ne otkazuje', async () => {
  const campaign = await scheduleCampaign({
    subject: 'Otkazati',
    content: '<p>x</p>',
    scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdBy: 'admin',
  });
  expect(await cancelScheduled(campaign.id)).toBe(true);
  expect((await listScheduled()).find((item) => item.id === campaign.id)?.status).toBe('missed');
  expect(await cancelScheduled(campaign.id)).toBe(false);
  expect(await cancelScheduled('nepostojeca')).toBe(false);
});
});
