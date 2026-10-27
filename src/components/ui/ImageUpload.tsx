import { useRef, useState, type ComponentType } from 'react';
import { ImagePlus, Images, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Modal } from './Modal';
import { MediaGallery } from './MediaGallery';
import { CropModal, type CropResult } from './CropModal';
import { cn } from './cn';

/**
 * IMAGE UPLOAD (2.6.2 — Supabase Storage)
 * ---------------------------------------
 * Mali, samostalan picker koji odmah šalje sliku na `POST /api/uploads/<kind>`
 * i vraća javni URL. Koristi ga profil (avatar), admin (cover igre) i forma
 * deal-a (dokaz). Namerno nema `<input>` za URL — URL polja su ostala tamo gde
 * su postojala, ali upload je sada podrazumevani put.
 *
 * Ograničenja (server ih ponavlja): JPG/PNG/WebP/GIF, do 5 MB. Slika se na
 * serveru ponovo kodira u WebP, pa EXIF/lokacija nikad ne stiže do korisnika.
 */
const MAX_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export interface ImageUploadProps {
  kind: 'avatar' | 'cover' | 'proof';
  onUploaded: (url: string) => void;
  /** Prikaz naslova i pomoći; `false` za kompaktnu varijantu (ikonica). */
  label?: string;
  hint?: string;
  /** `compact` = samo dugme, bez opisa (koristi se pored polja za URL). */
  compact?: boolean;
  disabled?: boolean;
  /** 2.6.3 — dozvoli biranje već otpremljene slike iz medijske galerije. */
  allowGallery?: boolean;
  /**
   * Odnos širina/visina za sečenje pre uploada. `undefined` = koristi
   * podrazumevani za `kind` (avatar 1:1, cover 16:9), `null` = slobodno sečenje.
   */
  aspect?: number | null;
  /** `false` isključuje sečenje (npr. dokaz kupovine treba u celini). */
  allowCrop?: boolean;
  /** Ikona u dugmetu (podrazumevano `ImagePlus`); `null` = bez ikone. */
  icon?: ComponentType<{ size?: number | string; className?: string; 'aria-hidden'?: boolean }> | null;
  /** Tekst dugmeta — menja podrazumevani „Otpremi sliku“ (label i dalje ide iznad). */
  actionLabel?: string;
  className?: string;
}

const DEFAULT_ASPECT: Record<ImageUploadProps['kind'], number> = { avatar: 1, cover: 16 / 9, proof: 16 / 9 };

/** Sitna ikonica u pomoći (bez dodatne biblioteke ikona u bundlu). */
const CropHint = () => (
  <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[2px] border-dashed border-white/40" />
);

export function ImageUpload({
  kind,
  onUploaded,
  label,
  hint,
  compact = false,
  disabled = false,
  allowGallery = false,
  aspect,
  allowCrop = true,
  icon,
  actionLabel,
  className,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** Fajl koji čeka sečenje (modal); `null` = nema modala. */
  const [pendingCrop, setPendingCrop] = useState<File | null>(null);

  const upload = async (file: File | Blob, fileName: string) => {
    setBusy(true);
    try {
      const result = await api.uploads.image(kind, file, fileName);
      onUploaded(result.url);
      toast.success('Slika je otpremljena.');
    } catch (err: any) {
      // 503 = Storage nije podešen na serveru → i dalje radio URL polje.
      toast.error(err?.message || 'Upload nije uspeo. Pokušaj ponovo.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Izaberi sliku (JPG, PNG, WebP ili GIF).');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast.error(`Slika je prevelika (max ${MAX_MB} MB).`);
      return;
    }

    // Sečenje pre otpremanja: korisnik bira kadar, server i dalje dobija WebP.
    // GIF ostaje netaknut (animacija bi se izgubila u canvas-u).
    if (allowCrop && file.type !== 'image/gif') {
      setPendingCrop(file);
      // `accept` se sklanja dok je modal otvoren: `setInputFiles`/programski izbor
      // bi inače mogao da „prođe“ dvaput. Prazna vrednost je važna da bi korisnik
      // mogao ponovo da izabere ISTI fajl posle „Otkaži“.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    await upload(file, file.name);
  };

  const confirmCrop = async (result: CropResult) => {
    setPendingCrop(null);
    await upload(result.blob, result.fileName);
  };

  const Icon = icon === undefined ? ImagePlus : icon;
  const button = (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => inputRef.current?.click()}
      className={cn(compact ? 'ui-btn br-secondary ui-btn-sm' : 'ui-btn br-secondary ui-btn-sm gap-2', className)}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} aria-hidden={true} /> : null}
      {busy ? 'Otpremam…' : compact ? 'Otpremi' : (actionLabel ?? label ?? 'Otpremi sliku')}
    </button>
  );

  return (
    <div className={compact ? 'inline-flex' : 'space-y-1.5'}>
      {!compact && label && <span className="block text-sm font-bold text-white/85">{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        {button}
        {allowCrop && !compact && (
          <span className="inline-flex items-center gap-1 text-[11px] text-white/40">
            <CropHint /> kadriranje pre otpremanja
          </span>
        )}
        {allowGallery && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => setGalleryOpen(true)}
            className={compact ? 'ui-btn br-secondary ui-btn-sm' : 'ui-btn br-secondary ui-btn-sm gap-2'}
          >
            <Images size={14} /> Galerija
          </button>
        )}
        {!compact && (
          <span className="text-[11px] text-white/45">{hint ?? `JPG, PNG, WebP ili GIF · do ${MAX_MB} MB`}</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {pendingCrop && (
        <CropModal
          file={pendingCrop}
          aspect={aspect === undefined ? DEFAULT_ASPECT[kind] : aspect}
          onCancel={() => {
            setPendingCrop(null);
            if (inputRef.current) inputRef.current.value = '';
          }}
          onConfirm={(result) => void confirmCrop(result)}
        />
      )}
      {allowGallery && galleryOpen && (
        <Modal open onClose={() => setGalleryOpen(false)} title="Medijska galerija" size="lg">
          <MediaGallery
            compact
            onPick={(url) => {
              onUploaded(url);
              setGalleryOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
