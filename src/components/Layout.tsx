import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import MobileTabBar from './MobileTabBar';
import AnnouncementBanner from './AnnouncementBanner';
// 5.2 — trajni banner „potvrdi email“ (registracija izdaje sesiju pre verifikacije).
import { EmailVerificationBanner } from './auth/EmailVerificationBanner';
import AmbientBackdrop from './AmbientBackdrop';
// F-13 — globalna pretraga sa tastaturom (⌘K / Ctrl+K) u overlay-u.
import { CommandPalette, useCommandPaletteShortcut } from './CommandPalette';
import { useAuthStore } from '../store/authStore';
import { startPresence, stopPresence } from '../store/presenceStore';
import { queryClient } from '../App';

export default function Layout() {
  const initSession = useAuthStore((s) => s.initSession);
  const location = useLocation();
  // F-13 — palette stanje (⌘K / Ctrl+K preko globalnog prečica hook-a).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  useCommandPaletteShortcut(openPalette, closePalette);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // 2.6.1 — „Online sada“: Realtime kanal + heartbeat za sopstvenu sesiju.
  useEffect(() => {
    startPresence(queryClient);
    return () => stopPresence();
  }, []);

  // Fokus ide na sadržaj pri promeni rute (tastaturna navigacija / screen reader)
  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  return (
    <div className="has-mobile-tabbar flex min-h-screen flex-col">
      {/* Statično filmsko zrno preko cele pozadine — taktilna dubina, ne tekstura sadržaja */}
      <div className="forge-grain" aria-hidden="true" />
      {/* 3.0 — čestice i sken linija crne baze (samo ispod sadržaja, bez teksta) */}
      <AmbientBackdrop />
      <AnnouncementBanner />
      <EmailVerificationBanner />
      <Navbar />
      {/* Jedini <main> u aplikaciji — stranice ga ne ugnježđuju ponovo. */}
      <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </div>
      <Footer />
      <MobileTabBar />
      {/* F-13 — globalna pretraga (Ctrl+K) nad istim API-jem kao `/search`. */}
      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
