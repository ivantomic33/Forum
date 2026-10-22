import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';

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
}

export function ImageUpload({ kind, onUploaded, label, hint, compact = false, disabled = false }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

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

    setBusy(true);
    try {
      const result = await api.uploads.image(kind, file);
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

  const button = (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => inputRef.current?.click()}
      className={compact ? 'ui-btn br-secondary ui-btn-sm' : 'ui-btn br-secondary ui-btn-sm gap-2'}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
      {busy ? 'Otpremam…' : compact ? 'Otpremi' : (label ?? 'Otpremi sliku')}
    </button>
  );

  return (
    <div className={compact ? 'inline-flex' : 'space-y-1.5'}>
      {!compact && label && <span className="block text-sm font-bold text-white/85">{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        {button}
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
    </div>
  );
}
