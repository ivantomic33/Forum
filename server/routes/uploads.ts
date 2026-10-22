/**
 * UPLOAD — `/api/uploads` (2.6.2)
 * -------------------------------
 *  POST /api/uploads/avatar        multipart polje `file` → novi avatar
 *  POST /api/uploads/cover         multipart polje `file` → cover igre (staff)
 *  POST /api/uploads/proof         multipart polje `file` → dokaz deal-a
 *  POST /api/uploads/article       multipart polje `file` → slika u članku (Tiptap, staff)
 *
 * Sve rute tražaju prijavu. Obrada (magic bytes + WebP) i čuvanje su u
 * `lib/storage.ts`; ovde je samo HTTP: multer u MEMORIJU (nema tmp fajlova),
 * limit 5 MB, jedna slika po zahtevu.
 *
 * Zašto posebna ruta a ne base64 u `PUT /users/profile`: JSON telo je
 * ograničeno na `BODY_LIMIT` (100 KB), pa je svaka „prava“ slika padala sa 413.
 */
import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../lib/http.js';
import {
  MAX_UPLOAD_BYTES,
  isOwnStorageUrl,
  removePreviousAvatar,
  storageConfigured,
  uploadImage,
} from '../lib/storage.js';
import { db } from '../lib/store.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
});

/** Multer greške (`LIMIT_FILE_SIZE`) pretvaramo u AppError, umesto 500. */
function single(field = 'file') {
  const middleware = upload.single(field);
  return (req: AuthRequest, res: any, next: any) =>
    middleware(req, res, (err: any) => {
      if (!err) return next();
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(413, `Slika je prevelika (maksimalno ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`));
      }
      if (err?.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new AppError(400, 'Očekivano je polje `file` sa jednom slikom.'));
      }
      return next(new AppError(400, 'Fajl nije mogao da se pročita.'));
    });
}

/** Bez storage-a ruta vraća 503 sa uputstvom — pre nego što primi telo. */
function requireStorage(_req: AuthRequest, _res: any, next: any) {
  if (!storageConfigured()) {
    return next(new AppError(503, 'Upload još nije podešen na serveru — koristi URL slike ili postavi Supabase Storage.'));
  }
  next();
}

function fileBuffer(req: AuthRequest): Buffer {
  const file = (req as any).file as { buffer?: Buffer } | undefined;
  if (!file?.buffer?.length) throw new AppError(400, 'Izaberi sliku za upload.');
  return file.buffer;
}

// POST /api/uploads/avatar — korisnik menja svoj avatar
//
// Redosled je bitan: `requireStorage` ide PRE `single()` — bez Storage-a ruta
// vraća 503 sa uputstvom i ne troši vreme na multipart telo.
router.post('/avatar', authenticate, requireStorage, single(), async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const user = await db.users.findById(userId);
    if (!user) return res.status(404).json({ error: 'Korisnik nije pronađen.' });

    const image = await uploadImage(userId, 'avatar', fileBuffer(req));

    // Stari avatar u našem bucket-u se briše (DiceBear/eksterni URL ostaje).
    if (user.avatar && isOwnStorageUrl(user.avatar)) await removePreviousAvatar(userId);

    const updated = await db.users.update(userId, { avatar: image.url });
    req.log?.info({ userId, size: image.size }, 'avatar_uploaded');
    res.status(201).json({ url: image.url, avatar: image.url, width: image.width, height: image.height, user: updated ? { id: updated.id } : undefined });
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/cover — cover igre (katalog); samo staff
router.post('/cover', authenticate, authorize('admin', 'moderator'), requireStorage, single(), async (req: AuthRequest, res, next) => {
  try {
    const image = await uploadImage(req.user!.id, 'cover', fileBuffer(req));
    req.log?.info({ userId: req.user!.id, size: image.size }, 'cover_uploaded');
    res.status(201).json({ url: image.url, width: image.width, height: image.height });
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/proof — screenshot dokaza za deal (autor deal-a)
router.post('/proof', authenticate, requireStorage, single(), async (req: AuthRequest, res, next) => {
  try {
    const image = await uploadImage(req.user!.id, 'proof', fileBuffer(req));
    req.log?.info({ userId: req.user!.id, size: image.size }, 'proof_uploaded');
    res.status(201).json({ url: image.url, width: image.width, height: image.height });
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/article — slika u članku (Tiptap `Image`)
//
// Ista obrada kao i za ostale namene (WebP, do 1520 px širine), ali je ruta
// namenjena CMS-u: SAMO staff može da piše članke, pa niko drugi ne treba
// ni da puni Storage sadržajem koji se prikazuje pod imenom portala.
router.post('/article', authenticate, authorize('admin', 'moderator'), requireStorage, single(), async (req: AuthRequest, res, next) => {
  try {
    const image = await uploadImage(req.user!.id, 'article', fileBuffer(req));
    req.log?.info({ userId: req.user!.id, size: image.size }, 'article_image_uploaded');
    res.status(201).json({ url: image.url, width: image.width, height: image.height });
  } catch (err) {
    next(err);
  }
});

export default router;
