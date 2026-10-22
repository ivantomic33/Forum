import { Link } from 'react-router-dom';
import { Compass, Home, MessageSquare } from 'lucide-react';

/** 404 ruta — bez "mrtvih" linkova i bez prikazivanja nepostojeceg sadržaja. */
export default function NotFoundPage() {
  return (
    <div className="section">
      <div className="container max-w-xl">
        <section className="ui-card-static text-center">
          <p className="font-mono text-5xl font-bold text-[var(--color-primary-fg)]" aria-hidden="true">
            404
          </p>
          <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-white">Stranica ne postoji</h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/55">
            Adresa je možda promenjena ili obrisana. Vrati se na pocetnu ili potraži sadržaj na forumu.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/" className="ui-btn br-primary ui-btn-md">
              <Home size={16} />
              Pocetna
            </Link>
            <Link to="/forum" className="ui-btn br-secondary ui-btn-md">
              <MessageSquare size={16} />
              Forum
            </Link>
            <Link to="/leaderboard" className="ui-btn br-ghost ui-btn-md">
              <Compass size={16} />
              Rang lista
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
