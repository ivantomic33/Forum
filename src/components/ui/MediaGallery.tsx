import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, ImageOff, Search, Trash2, ZoomIn } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { EmptyState, ErrorState, Skeleton } from '../ui/Feedback';
import { Button } from '../ui/Button';
import { ImageLightbox, type LightboxImage } from '../ui/ImageLightbox';

/**
 * 2.6.3 — medijska galerija (admin).
 * Lista sve slike iz Supabase Storage bucketa (avatar / cover / proof / article),
 * omogućava kopiranje URL-a i brisanje. `onPick` pretvara galeriju u birač
 * slike za `ImageUpload` (dugme „Iz galerije“).
 */
export function MediaGallery({ onPick, compact = false }: { onPick?: (url: string) => void; compact?: boolean }) {
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<'all' | 'avatar' | 'cover' | 'proof' | 'article'>('all');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const mediaQuery = useQuery({
    queryKey: ['admin', 'media-items'],
    queryFn: () => api.admin.mediaItems(120),
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: (path: string) => api.admin.deleteMedia(path),
    onSuccess: () => {
      toast.success('Fajl je obrisan.');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'media-items'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Brisanje nije uspelo.'),
  });

  const items = useMemo(() => {
    const all = mediaQuery.data?.items ?? [];
    const needle = filter.trim().toLowerCase();
    return all.filter(
      (item) =>
        (kind === 'all' || item.kind === kind) &&
        (!needle || item.name.toLowerCase().includes(needle) || (item.ownerId ?? '').includes(needle)),
    );
  }, [mediaQuery.data, filter, kind]);

  if (mediaQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="aspect-[4/3] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (mediaQuery.isError) {
    return <ErrorState message="Galerija nije mogla da se učita." onRetry={() => void mediaQuery.refetch()} />;
  }

  if (!mediaQuery.data?.configured) {
    return (
      <EmptyState
        title="Storage nije podešen"
        message="Podesi SUPABASE_URL i SUPABASE_SERVICE_KEY i pokreni server/schema-ALL.sql (bucket `media`)."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Traži po imenu ili autoru…"
            className="ui-input w-full pl-9"
            aria-label="Pretraga galerije"
          />
        </div>
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="ui-input" aria-label="Tip slike">
          <option value="all">Sve slike</option>
          <option value="article">Članci</option>
          <option value="avatar">Avatari</option>
          <option value="cover">Korice</option>
          <option value="proof">Dokazi</option>
        </select>
        <Button variant="secondary" size="sm" onClick={() => void mediaQuery.refetch()}>
          Osveži
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<ImageOff size={18} />} title="Nema slika" message="Otpremi avatar, koricu ili sliku članka — pojaviće se ovde." />
      ) : (
        <div className={`grid gap-3 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'}`}>
          {items.map((item, index) => (
            <figure key={item.path} className="group overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
              <button
                type="button"
                onClick={() => {
                  // F-LB — bez `onPick` je pregledač: klik otvara Lightbox sa svim
                  // filtriranim slikama (navigacija ←/→); sa `onPick` ostaje birač.
                  if (onPick) {
                    onPick(item.url);
                    toast.success('Slika je izabrana.');
                    return;
                  }
                  setLightboxIndex(index);
                }}
                className="group/img relative block aspect-[4/3] w-full overflow-hidden"
                title={onPick ? 'Izaberi ovu sliku' : 'Uvećaj sliku'}
              >
                <img src={item.url} alt={item.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                {!onPick && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover/img:bg-black/40 group-hover/img:opacity-100">
                    <ZoomIn size={26} className="text-white" aria-hidden="true" />
                  </span>
                )}
              </button>
              <figcaption className="space-y-1 p-2">
                <p className="truncate font-mono text-[10px] text-[var(--color-text-muted)]" title={item.path}>
                  {item.name}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(item.url).then(() => toast.success('URL kopiran.'))}
                    className="rounded p-1 text-white/40 hover:text-white"
                    title="Kopiraj URL"
                    aria-label="Kopiraj URL"
                  >
                    <Copy size={13} />
                  </button>
                  <a href={item.url} target="_blank" rel="noreferrer" className="rounded p-1 text-white/40 hover:text-white" title="Otvori" aria-label="Otvori">
                    <ExternalLink size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Obrisati ${item.name}?`)) remove.mutate(item.path);
                    }}
                    className="ml-auto rounded p-1 text-white/40 hover:text-rose-400"
                    title="Obriši"
                    aria-label="Obriši"
                    disabled={remove.isPending}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {/* F-LB — Lightbox za pregled (kada galerija nije u režimu birača). */}
      {!onPick && lightboxIndex !== null && items.length > 0 && (
        <ImageLightbox
          images={items.map((item): LightboxImage => ({ src: item.url, alt: item.name }))}
          index={Math.min(lightboxIndex, items.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  );
}
