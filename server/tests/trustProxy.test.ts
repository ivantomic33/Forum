import { describe, expect, it } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { parseTrustProxy } from '../lib/env.js';

/**
 * F-05: ponašanje `trust proxy` na stvarnom Express app-u.
 * Podrazumevano (`false`) lažni X-Forwarded-For se ignorisao — limiter broji
 * po TCP adresi. Sa `TRUST_PROXY=1` proxy-jeva adresa se prihvata (očekivano
 * kada je proxy stvarno ispred servera).
 */
async function requestIps(trust: Parameters<ReturnType<typeof express>['set']>[1]) {
  const app = express();
  app.set('trust proxy', trust);
  const seen: string[] = [];
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      seen.push(String(req.ip));
      return String(req.ip);
    },
  });
  app.get('/probe', limiter, (_req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };

  try {
    for (const forwarded of ['203.0.113.10', '198.51.100.20']) {
      await fetch(`http://127.0.0.1:${port}/probe`, { headers: { 'X-Forwarded-For': forwarded } });
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return seen;
}

describe('trust proxy (F-05)', () => {
  it('podrazumevano false: X-Forwarded-For se ignoriše', async () => {
    const ips = await requestIps(parseTrustProxy(undefined));
    expect(ips).toHaveLength(2);
    expect(new Set(ips).size).toBe(1);
    expect(ips[0]).not.toBe('203.0.113.10');
    expect(ips[1]).not.toBe('198.51.100.20');
  });

  it('TRUST_PROXY=1: klijent iz XFF zaglavlja postaje req.ip', async () => {
    const ips = await requestIps(parseTrustProxy('1'));
    expect(ips).toEqual(['203.0.113.10', '198.51.100.20']);
  });
});
