import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../../lib/i18n';

/**
 * IMAGE LIGHTBOX — fullscreen pregled slike (bez novih zavisnosti)
 * ---------------------------------------------------------------
 * Zamena za „otvori u novom tabu“: klik na sliku (galerija, članak, tema) otvara
 * Lightbox sa zoom/pan. Zoom/pan obrazac je preuzet iz `CropModal` (Pointer
 * Events + clamp), pa su ponašanja konzistentna.
 *
 * Pristupačnost: `role="dialog"`/`aria-modal`, fokus na kontejner, Escape/←/→,
 * klik na pozadinu zatvara, scroll lock na `document.body` (sa vraćanjem
 * prethodne vrednosti), kontrole imaju aria-labels.
 */

export interface LightboxImage {
  src: string;
  alt?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pomeraj se ograničava tako da slika (uvećana) ne može da „odleti“ van ekrana. */
function clampOffset(offset: { x: number; y: number }, scale: number, viewport: { w: number; h: number }) {
  const maxX = Math.max(0, ((scale - 1) * viewport.w) / 2);
  const maxY = Math.max(0, ((scale - 1) * viewport.h) / 2);
  return { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) };
}

export function ImageLightbox({ images, index, onClose, onIndexChange }: ImageLightboxProps) {
  const t = useT();
  const current = images[index];
  const total = images.length;

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Zoom/pan reset pri promeni slike.
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setLoaded(false);
    setFailed(false);
  }, [index]);

  // Scroll lock (isti obrazac kao Modal) + fokus na stage + tastatura.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    stageRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && total > 1) {
        event.preventDefault();
        onIndexChange?.((index + 1) % total);
      } else if (event.key === 'ArrowLeft' && total > 1) {
        event.preventDefault();
        onIndexChange?.((index - 1 + total) % total);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [index, total, onClose, onIndexChange]);

  const zoomTo = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
      setScale((previous) => {
        if (clamped === previous) return previous;
        // Zoom ka tački kursora: proporcionalno pomeri offset.
        const factor = clamped / previous;
        setOffset((old) => {
          if (cx === undefined || cy === undefined) return { x: 0, y: 0 };
          const rect = stageRef.current?.getBoundingClientRect();
          const localX = cx - (rect?.left ?? 0) - (rect?.width ?? 0) / 2;
          const localY = cy - (rect?.top ?? 0) - (rect?.height ?? 0) / 2;
          return clampOffset({ x: localX - (localX - old.x) * factor, y: localY - (localY - old.y) * factor }, clamped, {
            w: rect?.width ?? window.innerWidth,
            h: rect?.height ?? window.innerHeight,
          });
        });
        return clamped;
      });
    },
    [],
  );

  const onWheel = (event: React.WheelEvent) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    zoomTo(scale * (event.deltaY < 0 ? 1.2 : 1 / 1.2), event.clientX, event.clientY);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (scale <= 1) return; // pan samo kad je uvećano
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = stageRef.current?.getBoundingClientRect();
    setOffset(
      clampOffset(
        { x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) },
        scale,
        { w: rect?.width ?? window.innerWidth, h: rect?.height ?? window.innerHeight },
      ),
    );
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  if (!current) return null;

  return createPortal(
    <div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || t('lightbox.open')}
      tabIndex={-1}
      className="fixed inset-0 z-[110] flex flex-col bg-black/95 backdrop-blur-sm outline-none"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Gornja traka: brojač + akcije */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
          {total > 1 ? `${index + 1} / ${total}` : ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomTo(scale === 1 ? 2 : 1)}
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            title={scale === 1 ? t('lightbox.zoomHint') : t('lightbox.zoomOut')}
            aria-label={scale === 1 ? t('lightbox.zoomIn') : t('lightbox.zoomOut')}
          >
            {scale === 1 ? <ZoomIn size={18} /> : <ZoomOut size={18} />}
          </button>
          <a
            href={current.src}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            title={t('lightbox.openOriginal')}
            aria-label={t('lightbox.openOriginal')}
          >
            <ExternalLink size={18} />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            title={t('common.close') + ' (Esc)'}
            aria-label={t('lightbox.close')}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Scena sa slikom */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => zoomTo(scale === 1 ? 2 : 1, event.clientX, event.clientY)}
        style={{ touchAction: 'none', cursor: scale > 1 ? 'grab' : 'zoom-in' }}
      >
        {!loaded && !failed && (
          <Loader2 size={30} className="absolute animate-spin text-white/50" aria-label={t('common.loading')} />
        )}
        {failed ? (
          <div className="flex flex-col items-center gap-2 text-white/60">
            <ImageOff size={34} aria-hidden="true" />
            <p className="text-sm">{t('lightbox.unavailable')}</p>
          </div>
        ) : (
          <img
            src={current.src}
            alt={current.alt ?? ''}
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className="max-h-full max-w-full select-none object-contain transition-transform duration-100"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        )}

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => onIndexChange?.((index - 1 + total) % total)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/80 transition hover:bg-black/70 hover:text-white sm:left-4"
              aria-label={t('lightbox.prev')}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={() => onIndexChange?.((index + 1) % total)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2.5 text-white/80 transition hover:bg-black/70 hover:text-white sm:right-4"
              aria-label={t('lightbox.next')}
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      {/* Caption ispod slike (alt opis) */}
      {current.alt ? (
        <p className="mx-auto max-w-3xl px-6 pb-4 text-center text-xs text-white/50">{current.alt}</p>
      ) : (
        <div className="pb-3" />
      )}
    </div>,
    document.body,
  );
}

/**
 * RICH CONTENT SA LIGHTBOXOM — wrapper oko `.article-rich-content` divova.
 * Delegirani klik na `<img>` (sanitizovani HTML ne može da nosi `onclick`, pa se
 * klik presreće na kontejneru) otvara Lightbox sa alt opisom kao caption-om.
 */
export function RichContentWithLightbox({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  return (
    <>
      <div
        className={className}
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.tagName !== 'IMG') return;
          const img = target as HTMLImageElement;
          const src = img.currentSrc || img.src;
          if (!src) return;
          const container = event.currentTarget;
          const images = Array.from(container.querySelectorAll('img'))
            .map((el) => ({ src: el.currentSrc || el.src, alt: el.alt }))
            .filter((item) => item.src);
          const index = Math.max(0, images.findIndex((item) => item.src === src));
          setLightbox({ images: images.length ? images : [{ src, alt: img.alt }], index });
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndexChange={(next) => setLightbox((previous) => (previous ? { ...previous, index: next } : previous))}
        />
      )}
    </>
  );
}
