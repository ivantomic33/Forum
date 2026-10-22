import { Link, useLocation } from 'react-router-dom';
import { Home, MessageSquare, Plus, Tag, Trophy, User } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

/**
 * Mobilna donja navigacija (ispod lg) + plutajući CTA "Nova tema".
 * Rešava skrivenu top-bar navigaciju na malim ekranima (testirano na 360px).
 */
export default function MobileTabBar({ onNewTopic }: { onNewTopic?: () => void }) {
  const location = useLocation();
  const { user, isAuthenticated } = useAuthStore();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <>
      <nav className="mobile-tabbar lg:hidden" aria-label="Mobilna navigacija">
        <Link to="/" className={isActive('/') ? 'is-active' : ''} aria-current={isActive('/') ? 'page' : undefined}>
          <Home size={20} />
          <span>Vesti</span>
        </Link>
        <Link to="/forum" className={isActive('/forum') ? 'is-active' : ''} aria-current={isActive('/forum') ? 'page' : undefined}>
          <MessageSquare size={20} />
          <span>Forum</span>
        </Link>
        <Link to="/deals" className={isActive('/deals') ? 'is-active' : ''} aria-current={isActive('/deals') ? 'page' : undefined}>
          <Tag size={20} />
          <span>Popusti</span>
        </Link>
        <Link
          to="/leaderboard"
          className={isActive('/leaderboard') ? 'is-active' : ''}
          aria-current={isActive('/leaderboard') ? 'page' : undefined}
        >
          <Trophy size={20} />
          <span>Rang</span>
        </Link>
        <Link
          to={isAuthenticated && user ? `/profile/${user.username}` : '/login'}
          className={location.pathname.startsWith('/profile') ? 'is-active' : ''}
        >
          <User size={20} />
          <span>Profil</span>
        </Link>
      </nav>

      {onNewTopic && (
        // FAB "Nova tema" — amber, uvek vidljiv iznad tab bara

        <button type="button" onClick={onNewTopic} className="mobile-fab lg:hidden" aria-label="Nova tema na forumu">
          <Plus size={22} />
        </button>
      )}
    </>
  );
}
