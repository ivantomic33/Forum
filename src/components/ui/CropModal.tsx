import { useCallback, useEffect, useRef, useState } from 'react';
import { Crop, Loader2, RotateCcw, ZoomIn } from 'lucide-react';
import { Modal } from './Modal';
import { useT } from '../../lib/i18n';

/**
 * CROP MODAL — sečenje slike pre uploada (bez novih zavisnosti)
 * -------------------------------------------------------------
 * Galerija (2.6.3) je dozvolila biranje slike, ali ne i njeno kadriranje; server
 * samo automatski smanjuje. Ovde seče `<canvas>`-om, pa server i dalje dobija
 * običan fajl (isti `/api/uploads/<kind>`, isti WebP re-encode, bez EXIF-a).
 *
 * Namerno ručno, a ne biblioteka (react-easy-crop): jedan modal, jedna
 * površina za prevlačenje i zoom — 30 kB biblioteke ne bi se isplatilo.
 *
 * Izlaz je maksimalno `MAX_OUTPUT` px po dužoj strani (server svejedno smanjuje,
 * ali 4K slika u `fetch`-u troši memoriju telefona).
 */

export const CROP_MAX_OUTPUT = 1600;

export interface CropResult {
  blob: Blob;
  fileName: string;
}

interface CropModalProps {
  file: File;
  /** Odnos širina/visina okvira; `null` = slobodno sečenje. */
  aspect: number | null;
  onCancel: () => void;
  onConfirm: (result: CropResult) => void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pozicija slike u okviru (CSS px) pri datom zoom-u i pomeraju. */
function imageRect(viewport: { width: number; height: number }, image: { width: number; height: number }, t: Transform) {
  const base = Math.max(viewport.width / image.width, viewport.height / image.height);
  const scale = base * t.scale;
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: (viewport.width - width) / 2 + t.x,
    y: (viewport.height - height) / 2 + t.y,
    width,
    height,
  };
}

/** Pomeraj se ograničava tako da okvir nikad ne pređe u prazno. */
function clampTransform(
  viewport: { width: number; height: number },
  image: { width: number; height: number },
  t: Transform,
): Transform {
  const rect = imageRect(viewport, image, t);
  const maxX = Math.max(0, (rect.width - viewport.width) / 2);
  const maxY = Math.max(0, (rect.height - viewport.height) / 2);
  return { scale: t.scale, x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) };
}

export function CropModal({ file, aspect, onCancel, onConfirm }: CropModalProps) {
  const t = useT();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origin: Transform } | null>(null);

  // Blob URL se čuva u stanju (a ne u lokalnoj promenljivoj efekta): React StrictMode
  // u razvoju pokreće efekat dvaput, pa je `URL.revokeObjectURL` u cleanup-u stizao
  // PRE nego što se slika učita — `blob:` je tad padao sa ERR_FILE_NOT_FOUND i okvir je
  // ostajao prazan. Zato: revoke samo pri unmount-u, kroz zaseban efekat nad stanjem.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setTransform({ scale: 1, x: 0, y: 0 });
    };
    img.onerror = () => setError('Ova slika ne može da se otvori. Izaberi drugi fajl.');
    img.src = url;
  }, [file]);

  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const update = useCallback(
    (next: Transform) => {
      if (!image || !viewport.width) return;
      setTransform(clampTransform(viewport, image, next));
    },
    [image, viewport],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: transform };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    update({
      scale: drag.origin.scale,
      x: drag.origin.x + (event.clientX - drag.startX),
      y: drag.origin.y + (event.clientY - drag.startY),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const save = async () => {
    if (!image || !viewport.width) return;
    setBusy(true);
    setError(null);
    try {
      const rect = imageRect(viewport, image, transform);
      // Izvor na originalu: isti pravougaonik, srazmerno uvećan.
      const sx = (0 - rect.x) * (image.width / rect.width);
      const sy = (0 - rect.y) * (image.height / rect.height);
      const sw = viewport.width * (image.width / rect.width);
      const sh = viewport.height * (image.height / rect.height);

      const outWidth = Math.min(viewport.width * 2, CROP_MAX_OUTPUT);
      const outHeight = Math.min(viewport.height * 2, CROP_MAX_OUTPUT);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(outWidth);
      canvas.height = Math.round(outHeight);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas nije dostupan.');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) throw new Error('Sečenje slike nije uspelo.');
      const baseName = (file.name || 'slika').replace(/\.[^.]+$/, '');
      onConfirm({ blob, fileName: `${baseName}.webp` });
    } catch (err: any) {
      setError(err?.message || 'Sečenje slike nije uspelo.');
    } finally {
      setBusy(false);
    }
  };

  const aspectStyle = aspect ? { aspectRatio: String(aspect) } : { height: 'min(60vh, 420px)' as const };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onCancel}
      title={t('crop.title')}
      description={t('crop.hint', { max: CROP_MAX_OUTPUT })}
      size="lg"
      footer={
        <>
          <button type="button" className="ui-btn br-ghost ui-btn-sm" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ui-btn br-primary ui-btn-sm" onClick={save} disabled={busy || !image}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Crop size={14} />}
            {busy ? t('crop.progress') : t('crop.confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          ref={frameRef}
          role="application"
          aria-label="Površina za sečenje slike"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative w-full touch-none overflow-hidden rounded-lg bg-black/60 ring-1 ring-white/10"
          style={aspectStyle}
        >
          {image && viewport.width > 0 && (
            <img
              alt=""
              draggable={false}
              src={imageUrl ?? image.src}
              className="pointer-events-none absolute select-none"
              style={{
                left: imageRect(viewport, image, transform).x,
                top: imageRect(viewport, image, transform).y,
                width: imageRect(viewport, image, transform).width,
                height: imageRect(viewport, image, transform).height,
              }}
            />
          )}
          {/* Mreža „trećina“ — vizuelno poravnanje kadra */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/15" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/15" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/15" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/15" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ZoomIn size={16} className="shrink-0 text-white/50" aria-hidden="true" />
          <label className="sr-only" htmlFor="crop-zoom">
            {t('crop.zoom')}
          </label>
          <input
            id="crop-zoom"
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={transform.scale}
            onChange={(event) => update({ ...transform, scale: Number(event.target.value) })}
            className="w-full accent-[var(--color-primary)]"
          />
          <button
            type="button"
            className="ui-btn br-ghost ui-btn-sm"
            onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}
            title={t('crop.reset')}
            aria-label={t('crop.reset')}
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
