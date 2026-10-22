import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';
import MobileTabBar from './MobileTabBar';
import AnnouncementBanner from './AnnouncementBanner';
import { useAuthStore } from '../store/authStore';
import { startPresence, stopPresence } from '../store/presenceStore';
import { queryClient } from '../App';

export default function Layout() {
  const initSession = useAuthStore((s) => s.initSession);
  const location = useLocation();

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
      <AnnouncementBanner />
      <Navbar />
      {/* Jedini <main> u aplikaciji — stranice ga ne ugnježđuju ponovo. */}
      <div id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </div>
      <Footer />
      <MobileTabBar />
    </div>
  );
}
