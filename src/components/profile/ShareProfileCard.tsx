import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui';

/**
 * F-12 — „Podeli karticu“ na profilu.
 *
 * Slika se generiše na serveru (`GET /api/users/:username/card.png`, 1200×630):
 * nivo, XP traka, karma, bedževi i top igre. Na uređajima sa Web Share API
 * šalje se kao fajl (Discord/X/Instagram), inače se otvara u novom tabu za
 * preuzimanje (desni klik → „Sačuvaj sliku“).
 */
export function ShareProfileCard({ username }: { username: string }) {
  const url = `/api/users/${encodeURIComponent(username)}/card.png`;

  const share = async () => {
    try {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const file = new File([blob], `nexus-${username}.png`, { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `${username} — NEXUS gaming kartica`,
          text: 'Moja gaming kartica sa NEXUS-a.',
        });
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `nexus-${username}.png`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      toast.success('Kartica je preuzeta.');
    } catch {
      toast.error('Kartica nije mogla da se generiše.');
    }
  };

  return (
    <Button size="sm" variant="ghost" leftIcon={<Share2 size={14} />} onClick={() => void share()}>
      Podeli karticu
    </Button>
  );
}
