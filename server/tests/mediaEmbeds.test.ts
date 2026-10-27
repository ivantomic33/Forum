import { describe, expect, it } from 'vitest';
import { autolinkHtml, isStandaloneUrl, parseMediaUrl } from '../../src/lib/mediaEmbeds';

describe('parseMediaUrl — whitelist', () => {
  // YouTube
  it('parsira standardni YouTube watch link', () => {
    const m = parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(m).toEqual({ provider: 'youtube', kind: 'video', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  });
  it('parsira youtu.be short link', () => {
    expect(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
  });
  it('parsira YouTube Shorts', () => {
    const m = parseMediaUrl('https://www.youtube.com/shorts/abcdefghijk');
    expect(m?.kind).toBe('shorts');
    expect(m?.id).toBe('abcdefghijk');
  });
  it('odbacuje watch link sa nevalidnim v parametrom', () => {
    expect(parseMediaUrl('https://www.youtube.com/watch?v=<script>')).toBeNull();
    expect(parseMediaUrl('https://www.youtube.com/watch')).toBeNull();
  });
  it('odbacuje lažni youtube domen (substring attack)', () => {
    expect(parseMediaUrl('https://evil-youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseMediaUrl('https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseMediaUrl('https://notyoutube.com/watch?v=x')).toBeNull();
  });

  // Spotify
  it('parsira Spotify track, album, playlist i episode', () => {
    for (const kind of ['track', 'album', 'playlist', 'episode']) {
      const m = parseMediaUrl(`https://open.spotify.com/${kind}/4uLU6hMCjMI75M1A2tKUQC`);
      expect(m?.kind).toBe(kind);
      expect(m?.provider).toBe('spotify');
    }
  });
  it('parsira Spotify intl prefiks', () => {
    expect(parseMediaUrl('https://open.spotify.com/intl-sr/track/4uLU6hMCjMI75M1A2tKUQC')?.kind).toBe('track');
  });
  it('odbacuje nepoznat Spotify tip i kratki ID', () => {
    expect(parseMediaUrl('https://open.spotify.com/user/4uLU6hMCjMI75M1A2tKUQC')).toBeNull();
    expect(parseMediaUrl('https://open.spotify.com/track/short')).toBeNull();
  });

  // Twitch
  it('parsira Twitch kanal i clip', () => {
    expect(parseMediaUrl('https://www.twitch.tv/nexuslive')).toMatchObject({ provider: 'twitch', kind: 'channel', id: 'nexuslive' });
    expect(parseMediaUrl('https://clips.twitch.tv/CrazyEncouragingFishKappa')).toMatchObject({ kind: 'clip' });
    expect(parseMediaUrl('https://www.twitch.tv/nexuslive/clip/CrazyFish-abc123')).toMatchObject({ kind: 'clip', id: 'CrazyFish-abc123' });
  });
  it('odbacuje nevalidan Twitch kanal', () => {
    expect(parseMediaUrl('https://www.twitch.tv/a')).toBeNull();
    expect(parseMediaUrl('https://www.twitch.tv/kanal/extra/putanja')).toBeNull();
  });
});

describe('parseMediaUrl — bezbednosni edge case-ovi', () => {
  it('odbacuje ne-http šeme i SSRF pokušaje', () => {
    expect(parseMediaUrl('javascript:alert(1)')).toBeNull();
    expect(parseMediaUrl('data:text/html,<script>')).toBeNull();
    expect(parseMediaUrl('file:///etc/passwd')).toBeNull();
    expect(parseMediaUrl('http://localhost/watch?v=x')).toBeNull();
    expect(parseMediaUrl('http://127.0.0.1/watch?v=x')).toBeNull();
  });
  it('odbacuje nevalidan URL', () => {
    expect(parseMediaUrl('nije-url')).toBeNull();
    expect(parseMediaUrl('')).toBeNull();
  });
});

describe('isStandaloneUrl / autolinkHtml', () => {
  it('standalone = ceo red je URL', () => {
    expect(isStandaloneUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isStandaloneUrl('  https://youtu.be/dQw4w9WgXcQ  ')).toBe(true);
  });
  it('link unuta teksta NIJE standalone', () => {
    expect(isStandaloneUrl('Pogledajte https://youtu.be/x ovo')).toBe(false);
  });
  it('autolink pravi <a> od URL-a u tekstu', () => {
    const html = autolinkHtml('Vidi https://example.com/foo. kraj.');
    expect(html).toContain('<a href="https://example.com/foo"');
    expect(html.endsWith('kraj.')).toBe(true);
  });
  it('autolink ne dira već postojeće <a> href unutar tagova (bez < u tekstu)', () => {
    const html = autolinkHtml('samo tekst https://example.com');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
