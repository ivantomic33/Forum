import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, MessageSquare, Plus, Tag, Trophy, User } from 'lucide-react';
import { useAuthStore } from '../store/authStore';

/**
 * Mobilna donja navigacija (ispod lg) + centralno dugme „Nova tema“.
 *
 * U-05 — ranije su tab bar (5 stavki) i FAB bili DVA odvojena sistema: FAB je
 * lebdeo u desnom uglu, a tab bar je imao `grid-template-columns: repeat(4)`
 * za 5 linkova (poslednji je padao u drugi red). Sada je „Nova tema“ sredina
 * trake — fizički deo navigacije, ne plutajući dodatak — i tu je na svakoj
 * stranici (početna, popusti, profil…), jer je poziva iz Layout-a.
 */
export default function MobileTabBar({ onNewTopic }: { onNewTopic?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  // Fallback ako roditelj ne pošalje handler: gost → prijava, član → kompozitor.
  const openNewTopic = () => {
    if (onNewTopic) {
      onNewTopic();
      return;
    }
    navigate(isAuthenticated ? '/forum?compose=1' : '/login?next=/forum%3Fcompose%3D1');
  };

  return (
    <>
      <nav className="mobile-tabbar lg:hidden" aria-label="Mobilna navigacija">
        <Link to="/" className={isActive('/') ? 'is-active' : ''} aria-current={isActive('/') ? 'page' : undefined}>
          <Home size={20} aria-hidden="true" />
          <span>Vesti</span>
        </Link>
        <Link to="/forum" className={isActive('/forum') ? 'is-active' : ''} aria-current={isActive('/forum') ? 'page' : undefined}>
          <MessageSquare size={20} aria-hidden="true" />
          <span>Forum</span>
        </Link>

        {/* U-05 — centralno „Nova tema“: u istoj traci, ne FAB uglu */}
        <button type="button" onClick={openNewTopic} className="mobile-tab-create" aria-label="Nova tema na forumu">
          <span className="mobile-tab-create-icon">
            <Plus size={20} aria-hidden="true" />
          </span>
          <span>Nova</span>
        </button>

        <Link to="/deals" className={isActive('/deals') ? 'is-active' : ''} aria-current={isActive('/deals') ? 'page' : undefined}>
          <Tag size={20} aria-hidden="true" />
          <span>Popusti</span>
        </Link>
        <Link
          to={isAuthenticated && user ? `/profile/${user.username}` : '/login'}
          className={location.pathname.startsWith('/profile') ? 'is-active' : ''}
        >
          <User size={20} aria-hidden="true" />
          <span>Profil</span>
        </Link>
      </nav>
    </>
  );
}
