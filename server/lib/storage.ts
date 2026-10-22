/**
 * SUPABASE STORAGE — UPLOAD SLIKA (2.6.2)
 * ---------------------------------------
 * Do sada su avatar, cover igre i `proofUrl` deal-a bili samo URL polja (ili
 * `data:image` base64 u telu zahteva, ograničen `BODY_LIMIT`-om od 100 KB).
 * Ovaj modul daje jedan upload put: server prima sliku, proverava joj **magic
 * bytes** (ne veruje `Content-Type`-u) i `sharp`-om je ponovo kodira u WebP,
 * a zatim je upisuje u **javni** Supabase bucket preko `service_role` ključa.
 *
 * Bezbednost:
 *  - ponovno kodiranje uklanja EXIF (GPS), skripte u „slikama“ i polyglot fajlove;
 *  - veličina je ograničena PRE dekodiranja (`MAX_UPLOAD_BYTES`, 5 MB);
 *  - ključ u bucket-u uvek počinje `userId/` — korisnik ne može da pregazi
 *    tuđi fajl, a javni URL ne sadrži ništa o identitetu osim nasumičnog imena;
 *  - `data:image` se više ne prihvata kao vrednost slike (samo http(s) URL).
 *
 * Bez `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` upload vraća `503` sa jasnom
 * porukom (URL polja i dalje rade) — aplikacija nikad ne pada zbog storage-a.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { logger } from './logger.js';
import { AppError } from './http.js';

export const STORAGE_BUCKET = (process.env.SUPABASE_STORAGE_BUCKET || 'media').trim();
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type MediaKind = 'avatar' | 'cover' | 'proof' | 'article';

/**
 * Najveće dimenzije po nameni. `fit: 'inside'` je namerno za sve osim avatara
 * — slika se smanjuje proporcionalno i **nikad** ne seče (ranije je "cover"
 * namena za cover igre bila `cover` fit, pa je 16:9 screenshot izlazio isečen).
 */
const VARIANTS: Record<MediaKind, { maxWidth: number; maxHeight: number; quality: number; fit: 'cover' | 'inside' }> = {
  avatar: { maxWidth: 256, maxHeight: 256, quality: 82, fit: 'cover' },
  cover: { maxWidth: 600, maxHeight: 800, quality: 82, fit: 'inside' },
  proof: { maxWidth: 1600, maxHeight: 1600, quality: 80, fit: 'inside' },
  /** Slike u članku (Tiptap) — širina članka je ~760 px; 2× za retina. */
  article: { maxWidth: 1520, maxHeight: 2000, quality: 78, fit: 'inside' },
};

/** Namene koje klijent sme da traži (i da ih mapira na rute). */
export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VARIANTS, value);
}

let client: SupabaseClient | null = null;

/**
 * Da li je Storage podešen. URL i ključ se proveravaju eksplicitno (ne kao
 * `Boolean(process.env.A && process.env.B)`) i URL mora biti `http(s)` — tako
 * „memory“ režim nikad ne izgleda kao podešen Storage.
 */
export function storageConfigured(): boolean {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const key = (process.env.SUPABASE_SERVICE_KEY ?? '').trim();
  return url.length > 0 && key.length > 0 && (url.startsWith('http://') || url.startsWith('https://'));
}

function storageClient(): SupabaseClient {
  if (!storageConfigured()) {
    throw new AppError(
      503,
      'Upload još nije podešen na serveru. Za sada nalepi URL slike ili pokreni`server/schema-ALL.sql`.',
    );
  }
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
      auth: { persistSession: false },
    });
  }
  return client;
}

/** Magic bytes — jedini pouzdan znak šta je fajl, `Content-Type` je pod kontrolom klijenta. */
export function sniffImageType(buf: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (buf.length >= 6 && buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'gif';
  return null;
}

export interface StoredImage {
  url: string;
  path: string;
  width: number;
  height: number;
  size: number;
  mime: string;
}

/**
 * Provera i konverzija slike (bez mreže) — izdvojeno da testovi pokriju
 * odbijanje ne-slike i da se EXIF stvarno skine.
 */
export async function prepareImage(buffer: Buffer, kind: MediaKind): Promise<{ data: Buffer; width: number; height: number }> {
  if (!buffer?.length) throw new AppError(400, 'Fajl je prazan.');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(413, `Slika je prevelika (maksimalno ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }
  if (!sniffImageType(buffer)) {
    throw new AppError(400, 'Podržane su samo JPG, PNG, WebP i GIF slike.');
  }

  const { maxWidth, maxHeight, quality, fit } = VARIANTS[kind];
  try {
    // `rotate()` primenjuje EXIF orijentaciju pre nego što se EXIF odbaci.
    const out = await sharp(buffer, { limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: maxWidth, height: maxHeight, fit, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer({ resolveWithObject: true });
    return { data: out.data, width: out.info.width, height: out.info.height };
  } catch {
    // Sharp odbija fajl koji tvrdi da je slika, a to nije (ili je oštećen).
    throw new AppError(400, 'Slika ne može da se obradi — pokušaj drugi fajl.');
  }
}

/**
 * Nasumično ime — URL ne odaje korisničko ime ni vreme uploada. Slike
 * članaka idu u `<userId>/articles/…`, pa su i one pod vlasničkim prefiksom.
 */
function objectName(kind: MediaKind): string {
  const random = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return kind === 'article' ? `articles/article-${random}.webp` : `${kind}-${random}.webp`;
}

/**
 * Upload slike. `userId` je autorizovan iz sesije (nikad iz tela zahteva), pa
 * je prefiks putanje ujedno i granica vlasništva.
 *
 * Slike članaka idu u `<userId>/articles/…` — vlasnički prefiks
 * `(storage.foldername(name))[1]` ostaje `userId`, pa RLS obrazac važi za sve.
 */
export async function uploadImage(userId: string, kind: MediaKind, buffer: Buffer): Promise<StoredImage> {
  const prepared = await prepareImage(buffer, kind);
  const supabase = storageClient();
  const path = `${userId}/${objectName(kind)}`;

  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, prepared.data, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    logger.warn({ err: error, userId, kind }, 'storage_upload_failed');
    throw new AppError(502, 'Slika nije mogla da se sačuva. Pokušaj ponovo.');
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return {
    url: data.publicUrl,
    path,
    width: prepared.width,
    height: prepared.height,
    size: prepared.data.length,
    mime: 'image/webp',
  };
}

/** Zamena avatara — briše prethodni fajl istog korisnika (samo `avatar-*.webp`). */
export async function removePreviousAvatar(userId: string): Promise<void> {
  if (!storageConfigured()) return;
  try {
    const supabase = storageClient();
    const { data } = await supabase.storage.from(STORAGE_BUCKET).list(userId, { search: 'avatar-' });
    const paths = (data ?? []).map((f) => `${userId}/${f.name}`);
    if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  } catch (err) {
    // Neuspeh čišćenja ne sme da obori upload.
    logger.debug({ err, userId }, 'storage_cleanup_failed');
  }
}

/** Da li je URL naš javni storage objekat (za brisanje starog avatara pri promeni). */
export function isOwnStorageUrl(url: string): boolean {
  if (!url || !process.env.SUPABASE_URL) return false;
  return url.startsWith(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${STORAGE_BUCKET}/`);
}

/** Jedan objekat u galeriji (medijska biblioteka admina). */
export interface MediaItem {
  path: string;
  name: string;
  url: string;
  size: number | null;
  createdAt: string | null;
  kind: string | null;
  ownerId: string | null;
}

/**
 * Galerija (2.6.3) — lista fajlova bucketa za admin panel.
 * Bucket ima prefiks po korisniku (`<userId>/…`), pa `list()` po prefiksu i
 * flatten-uje jedan nivo ispod (umetnikove slike članka su u `<userId>/articles/`).
 * Nikad ne vraća privatne kolone osim javnog URL-a — bucket je public.
 */
export async function listMedia(limit = 60): Promise<MediaItem[]> {
  const supabase = storageClient();
  const { data: folders, error } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 500 });
  if (error) throw new AppError(502, 'Galerija nije mogla da se učita.');

  const items: MediaItem[] = [];
  const toItem = (folder: string, file: any): MediaItem => {
    const path = `${folder}/${file.name}`;
    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    return {
      path,
      name: file.name,
      url: data.publicUrl,
      size: typeof file.metadata?.size === 'number' ? file.metadata.size : null,
      createdAt: file.created_at ?? null,
      kind: path.match(/(avatar|cover|proof|article)-/)?.[1] ?? null,
      ownerId: folder || null,
    };
  };

  for (const folder of folders ?? []) {
    // `id === null` označava prefiks (folder), ne fajl.
    if (folder.id === null || folder.metadata === null) {
      const { data: files } = await supabase.storage.from(STORAGE_BUCKET).list(folder.name, { limit });
      for (const file of files ?? []) {
        if (file.id === null) continue;
        if (file.name.startsWith('articles')) {
          // `<userId>/articles/<name>` — slike iz Tiptap editora
          const { data: nested } = await supabase.storage.from(STORAGE_BUCKET).list(`${folder.name}/articles`, { limit });
          for (const inner of nested ?? []) items.push(toItem(`${folder.name}/articles`, inner));
          continue;
        }
        items.push(toItem(folder.name, file));
      }
      continue;
    }
    items.push(toItem('', folder));
  }

  return items
    .filter((item) => /\.webp$/i.test(item.name))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, limit);
}

/**
 * Brisanje objekta iz galerije. Dozvoljeni su samo putanje UNUTAR bucketa
 * (`<userId>/…`); `..`, apsolutne putanje i URL-ovi se odbijaju.
 */
export async function deleteMedia(path: string): Promise<void> {
  const clean = (path ?? '').trim();
  if (!clean || clean.includes('..') || clean.startsWith('/') || clean.includes('://')) {
    throw new AppError(400, 'Neispravna putanja fajla.');
  }
  const supabase = storageClient();
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([clean]);
  if (error) throw new AppError(502, 'Fajl nije mogao da se obriše.');
}
