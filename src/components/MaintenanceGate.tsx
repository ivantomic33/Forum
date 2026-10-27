/**
 * MAINTENANCE GATE
 * ----------------
 * Kada je admin uključio „Režim održavanja“ (server: `site_meta` →
 * `GET /api/admin/settings/public` → `maintenanceMode: true`), ceo sajt se
 * zamenjuje ekranom za održavanje — OSIM:
 *  - `/login` i `/register` (admin se prijavljuje ovde kad ga sesija istekne),
 *  - `/admin/*` (admin panel mora da radi da bi se režim i isključio),
 *  - `/terms`, `/privacy`, `/rules` (pravne strane ostaju dostupne),
 *  - posetiocima sa `role` admin/moderator (vidi ceo sajt i dok traje rad).
 *
 * Podešavanja se pitaju na 60 s (isto kao `AnnouncementBanner`), pa isključenje
 * režima na serveru postaje vidljivo bez restarta i bez reload-a.
 */
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';

const MAINTENANCE_BYPASS_PREFIXES = ['/login', '/register', '/admin', '/terms', '/privacy', '/rules'];

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => api.admin.getPublicSettings(),
    refetchInterval: 60_000,
    // Prvo pitanje ne sme da blokira ceo sajt dok ne stigne odgovor —
    // dok se ne zna stanje, sajt se renderuje normalno (fail-open).
    staleTime: 30_000,
  });

  const maintenance = data?.settings?.maintenanceMode === true;
  const staff = user?.role === 'admin' || user?.role === 'moderator';
  const bypassed = MAINTENANCE_BYPASS_PREFIXES.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  );

  if (isLoading || !maintenance || staff || bypassed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="max-w-md w-full text-center rounded-2xl border border-white/10 bg-surface-2 p-10 animate-fade-in">
        <div className="mx-auto w-16 h-16 rounded-full bg-surface-1 flex items-center justify-center mb-5">
          <Wrench size={30} className="text-[var(--color-warning)]" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Režim održavanja</h1>
        <p className="text-white/60 text-sm leading-relaxed">
          Sajt je trenutno u režimu održavanja radi poboljšanja korisničkog iskustva.
          Vratite se uskoro — bićemo online u što kraćem roku.
        </p>
        <p className="text-white/30 text-xs mt-6">Hvala na strpljenju. — NEXUS tim</p>
      </div>
    </div>
  );
}
