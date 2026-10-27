import { describe, expect, it } from 'vitest';

/**
 * N-09 — audit log je deljeno stanje.
 *
 * Sa 2+ instance svaka je ranije imala **svoj** niz od 1000 zapisa, pa je
 * `/api/admin/audit-log` vraćao samo deo istorije.
 *
 * `routes/users.ts` uvozi `middleware/auth.ts`, a taj modul baca grešku pri
 * uvozu bez `JWT_SECRET`-a — zato se env postavlja PRE dinamičkog `import()`-a
 * (isti obrazac kao `e2e/support/server.mjs`).
 */
describe('N-09 — audit log', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-at-least-32-characters-long!!';
  const { recordAudit, getAuditLog } = await import('../routes/users.js');
  it('zapis se vidi u listi, najnoviji prvi, u obliku koji UI očekuje', async () => {
    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await recordAudit({
      actorId: 'usr_n09_actor',
      actorUsername: `actor_${marker}`,
      targetId: 'usr_n09_target',
      targetUsername: `target_${marker}`,
      action: 'role_change',
      from: 'member',
      to: 'moderator',
    });

    const entries = await getAuditLog(50);
    const entry = entries.find((row) => row.to === 'moderator' && row.targetUsername === `target_${marker}`);

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      actorId: 'usr_n09_actor',
      targetId: 'usr_n09_target',
      action: 'role_change',
      from: 'member',
      to: 'moderator',
    });
    expect(typeof entry!.id).toBe('string');
    expect(typeof entry!.at).toBe('string');
    expect(Number.isNaN(Date.parse(entry!.at))).toBe(false);
  });

  it('limit je gornja granica rezultata (bez `slice` nad celim logom)', async () => {
    const entries = await getAuditLog(3);
    expect(entries.length).toBeLessThanOrEqual(3);
    // Najnoviji prvi — ISO datumi moraju da opadaju.
    const times = entries.map((row) => Date.parse(row.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
