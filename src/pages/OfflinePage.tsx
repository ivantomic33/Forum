import { Link } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { EmptyState } from '../components/ui';

/**
 * F-7 — `/offline` — „skela“ koju service worker servira kada nema mreže.
 *
 * Stranica je u `SHELL_CACHE` (vidi `public/sw.js`) i namerno nema podatke sa
 * servera: samo poruka, dugme za ponovni pokušaj i linkovi ka keširanim delovima.
 */
export default function OfflinePage() {
  return (
    <div className="section">
      <div className="container max-w-xl">
        <EmptyState
          icon={<WifiOff size={22} />}
          title="Nema internet veze"
          message="NEXUS je trenutno dostupan u offline režimu. Stranica će se ponovo učitati kada se veza vrati."
          action={
            <div className="flex-flex-wrap gap-2">
              <button type="button" className="ui-btn br-primary ui-btn-md" onClick={() => window.location.reload()}>
                Pokušaj ponovo
              </button>
              <Link to="/" className="ui-btn br-ghost ui-btn-md">
                Početna
              </Link>
            </div>
          }
        />
      </div>
    </div>
  );
}
