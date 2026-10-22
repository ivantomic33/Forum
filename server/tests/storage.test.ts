import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../lib/http.js';
import {
  MAX_UPLOAD_BYTES,
  isOwnStorageUrl,
  prepareImage,
  sniffImageType,
  storageConfigured,
  uploadImage,
} from '../lib/storage.js';

/**
 * SUPABASE STORAGE (2.6.2)
 * ------------------------
 * Testovi pokrivaju deo koji ne dodiruje mrežu: prepoznavanje formata po
 * magic bytes, odbijanje ne-slike/prevelikog fajla i ponovno kodiranje u WebP
 * (čime EXIF/lokacija nestaje). Upload u bucket je pokriven kroz 503 granu.
 */

/** 1×1 PNG (validan fajl, ~70 bajtova). */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Minimalni JPEG header — dovoljno za `sniffImageType`, ne za dekodiranje. */
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('storage — magic bytes', () => {
  it('prepoznaje PNG/JPEG/WebP/GIF, a odbija ostalo', () => {
    expect(sniffImageType(PNG_1PX)).toBe('png');
    expect(sniffImageType(JPEG_HEADER)).toBe('jpeg');
    expect(sniffImageType(Buffer.from('RIFF....WEBPVP8 ', 'ascii'))).toBe('webp');
    expect(sniffImageType(Buffer.from('GIF89a', 'ascii'))).toBe('gif');
    expect(sniffImageType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    // SVG nije rasterska slika — ne sme da prođe (može sadržati skriptu).
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('storage — prepareImage', () => {
  it('pretvara PNG u manji WebP i vraća dimenzije', async () => {
    const out = await prepareImage(PNG_1PX, 'avatar');
    expect(sniffImageType(out.data)).toBe('webp');
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
  });

  it('odbija fajl koji nije slika (400), iako klijent tvrdi da jeste', async () => {
    await expect(prepareImage(Buffer.from('nije slika'), 'proof')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('odbija fajl veći od limita pre dekodiranja (413)', async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0);
    await expect(prepareImage(big, 'proof')).rejects.toBeInstanceOf(AppError);
  });

  it('odbija prazan fajl', async () => {
    await expect(prepareImage(Buffer.alloc(0), 'avatar')).rejects.toMatchObject({ status: 400 });
  });
});

describe('storage — konfiguracija', () => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_KEY;

  beforeEach(() => {
    process.env.SUPABASE_URL = savedUrl;
    process.env.SUPABASE_SERVICE_KEY = savedKey;
  });

  it('bez Supabase ključeva upload vraća 503 sa uputstvom (URL polja rade)', async () => {
    // „memory“ je oznaka test/demo režima (vidi `lib/env.ts`), ne pravi URL.
    process.env.SUPABASE_URL = 'memory';
    process.env.SUPABASE_SERVICE_KEY = 'memory';
    expect(storageConfigured()).toBe(false);
    await expect(uploadImage('usr_1', 'avatar', PNG_1PX)).rejects.toMatchObject({ status: 503 });

    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    expect(storageConfigured()).toBe(false);
  });

  it('isOwnStorageUrl prihvata samo naš javni bucket', () => {
    process.env.SUPABASE_URL = 'https://demo.supabase.co';
    expect(isOwnStorageUrl('https://demo.supabase.co/storage/v1/object/public/media/u/avatar-1.webp')).toBe(true);
    expect(isOwnStorageUrl('https://demo.supabase.co/storage/v1/object/public/other/x.webp')).toBe(false);
    expect(isOwnStorageUrl('https://evil.example/storage/v1/object/public/media/x.webp')).toBe(false);
    expect(isOwnStorageUrl('')).toBe(false);
  });
});
