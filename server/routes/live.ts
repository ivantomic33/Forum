/**
 * F-6 — TWITCH „UŽIVO“ STATUS
 * --------------------------
 * `GET /api/live/twitch?channel=<login>` vraća da li kanal trenutno emituje.
 *
 * Kredencijali (`TWITCH_CLIENT_ID`/`TWITCH_CLIENT_SECRET`) žive samo na serveru,
 * a app access token se kešira do isteka (`expires_in`) — inače bi svaki posetilac
 * profila pravio novi token i brzo udario u rate limit. Bez ključeva ruta vraća
 * `{ configured: false }` i UI ne prikazuje traku (nema greške za korisnika).
 */

import { Router } from 'express';
import { logger } from '../lib/logger.js';

const router = Router();

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';

let cached: { token: string; expiresAt: number } | null = null;

function configured(): boolean {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function appToken(): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID!,
    client_secret: process.env.TWITCH_CLIENT_SECRET!,
    grant_type: 'client_credentials',
  });
  const response = await fetch(`${TOKEN_URL}?${params.toString()}`, { method: 'POST' });
  if (!response.ok) {
    logger.warn({ status: response.status }, 'twitch_token_failed');
    return null;
  }
  const body: any = await response.json();
  if (!body?.access_token) return null;
  // 60 s rezerve da token ne istekne usred narednog poziva.
  cached = { token: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** Twitch login: samo `[a-z0-9_]`, 4–25 znakova (sprečava SSRF/injection u query). */
const validLogin = (value: string) => /^[a-zA-Z0-9_]{2,25}$/.test(value);

router.get('/twitch', async (req, res, next) => {
  try {
    const channel = String(req.query.channel ?? '').trim();
    if (!configured()) return res.json({ live: false, configured: false });
    if (!validLogin(channel)) return res.status(400).json({ error: 'Neispravan naziv Twitch kanala.' });

    const token = await appToken();
    if (!token) return res.json({ live: false, configured: true });

    const response = await fetch(`${STREAMS_URL}?user_login=${encodeURIComponent(channel)}`, {
      headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      // Rate limit / mreža: traka se ne prikazuje, ali profil ostaje ceo.
      return res.json({ live: false, configured: true });
    }
    const body: any = await response.json();
    const stream = Array.isArray(body?.data) ? body.data[0] : null;
    if (!stream) return res.json({ live: false, configured: true });

    res.json({
      live: true,
      configured: true,
      title: String(stream.title ?? '').slice(0, 200),
      viewers: Number(stream.viewer_count ?? 0),
      gameName: String(stream.game_name ?? '').slice(0, 100),
      startedAt: stream.started_at ?? null,
      thumbnail: typeof stream.thumbnail_url === 'string' ? stream.thumbnail_url : null,
      url: `https://www.twitch.tv/${channel}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
