import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Search, User, Menu, X, LogOut, Shield, Flag } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useT, localeTag, getLocale } from '../lib/i18n';
import { Badge, Button, OnlineAvatar } from './ui';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';

/**
 * Navigacija koristi POSTOJEĆE stranice — ranije su „PlayStation“ i „Recenzije“
 * vodili na pogrešne forume (`/forum/consoles`, `/forum/hardware`).
 * 2.8.1 — i18n: labeli su ključevi (`nav.*`), datumi kroz `Intl` sa aktivnim jezikom.
 */
const NAV_ITEMS = [
  { labelKey: 'nav.home', path: '/', accent: 'var(--color-primary)' },
  { labelKey: 'nav.forum', path: '/forum', accent: 'var(--color-secondary)' },
  // 2.6.0 — Deals / Popusti
  { labelKey: 'nav.deals', path: '/deals', accent: 'var(--color-deal)' },
  { labelKey: 'nav.pcGaming', path: '/forum/pc-gaming', accent: 'var(--color-secondary)' },
  { labelKey: 'nav.consoles', path: '/forum/consoles', accent: 'var(--color-tertiary)' },
  { labelKey: 'nav.esports', path: '/forum/esports', accent: 'var(--color-deal)' },
  { labelKey: 'nav.hardware', path: '/forum/hardware', accent: 'var(--color-secondary)' },
  { labelKey: 'nav.leaderboard', path: '/leaderboard', accent: 'var(--color-tertiary)' },
] as const;

/** Stranice koje postoje na portalu (`/category/:name`). */
const CATEGORY_LINKS = [
  { labelKey: 'nav.home', path: '/category/vesti' },
  { labelKey: 'nav.sections', path: '/category/recenzije' },
  { labelKey: 'nav.hardware', path: '/category/hardver' },
  { labelKey: 'nav.consoles', path: '/category/najave' },
  { labelKey: 'nav.leaderboard', path: '/category/liste' },
] as const;

export default function Navbar() {
  const t = useT();
  const locale = getLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [userDropdown, setUserDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLFormElement>(null);
  const { isAuthenticated, user, logout } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setMenuOpen(false);
    setUserDropdown(false);
    setSearchOpen(false);
  }, [location.pathname]);

  // Zatvaranje dropdown-a / pretrage klikom van njih (ranije se dropdown
  // zatvarao samo ponovnim klikom na avatar ili promenom rute).
  useEffect(() => {
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (userDropdown && dropdownRef.current && !dropdownRef.current.contains(target)) {
        setUserDropdown(false);
      }
      if (searchOpen && searchRef.current && !searchRef.current.contains(target)) {
        setSearchOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserDropdown(false);
        setSearchOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userDropdown, searchOpen]);

  const handleLogout = async () => {
    await logout();
    setUserDropdown(false);
    navigate('/');
  };

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = searchTerm.trim();
    // 2.6.2 — pretraga pokriva članke, forum i popuste; "samo forum" je tab.
    if (term.length < 2) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
    setSearchOpen(false);
    setSearchTerm('');
  };

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <>
      {/* Top micro bar UKLONJEN (5.7) — datum, „NEXUS Portal“ i „3 nova popusta“
          linkovi su bili redundantni u odnosu na glavnu navigaciju ispod.
          Traženi linkovi (Deals / Zajednica / Top članovi) postoje u main nav-u. */}

      {/* Main Navbar */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-[var(--glass-bg)] backdrop-blur-xl">
        <div className="container">
          <div className="flex h-16 min-w-0 items-center justify-between gap-2">
            {/* Logo — Cyber Pulse mark */}
            <Link to="/" className="group flex items-center gap-2.5" aria-label="NEXUS — početna">
              <div className="nexus-logo-mark flex h-9 w-9 items-center justify-center rounded-[10px] font-display text-lg font-extrabold tracking-wider text-[var(--color-on-solid)] transition-transform duration-150 group-active:scale-95">
                N
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-lg font-semibold tracking-[0.08em] text-white transition group-hover:text-violet-300">
                  NEXUS
                </span>
                <Badge tone="secondary" className="!text-[10px]">
                  GG
                </Badge>
              </div>
            </Link>

            {/* Desktop navigation */}
            <div className="hidden min-w-0 items-center gap-0.5 lg:flex">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.labelKey}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    style={{ ['--nav-accent' as string]: item.accent }}
                    className={`group relative rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-200 ${active
                        ? 'text-[var(--color-text-primary)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
                      }`}
                  >
                    {t(item.labelKey)}
                    <span className="nav-tick" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>

            {/* Right actions */}
            <div className="navbar-actions flex shrink-0 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setSearchOpen(!searchOpen)}
                className="ui-icon-btn"
                aria-label="Pretraga"
                aria-expanded={searchOpen}
                aria-controls="navbar-search"
              >
                <Search size={16} />
              </button>

              <NotificationBell />

              {/* 2.8.1 — izbor jezika (sr/en); compact jer je prostor u navbaru mali. */}
              <LanguageSwitcher compact />

              {isAuthenticated && user ? (
                <div className="relative" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setUserDropdown(!userDropdown)}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-3 transition hover:border-cyan-400/40 hover:bg-cyan-500/[0.06] hover:shadow-[0_0_16px_-6px_rgba(6,182,212,0.8)]"
                    aria-expanded={userDropdown}
                    aria-haspopup="menu"
                    aria-controls="user-menu"
                  >
                    {/* 2.6.1 — zeleni prsten dok je sesija aktivna (heartbeat) */}
                    <OnlineAvatar
                      src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.username)}`}
                      userId={user.id}
                      isOnline={user.isOnline}
                      status={user.status}
                      size="sm"
                      alt=""
                      className="border-[var(--color-border-default)]"
                    />
                    <span className="hidden items-center gap-1 text-sm font-semibold text-[var(--color-text-primary)] sm:inline-flex">
                      {user.username}
                      <VerifiedBadge isVerified={user.isVerified} size="xs" />
                    </span>
                  </button>

                  {userDropdown && (
                    <div
                      id="user-menu"
                      role="menu"
                      className="ui-card-elevated absolute right-0 z-50 mt-2 w-60 overflow-hidden !rounded-lg !p-2"
                    >
                      <div className="mb-1 border-b border-[var(--color-border-subtle)] px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
                          <span className="truncate">{user.username}</span>
                          <VerifiedBadge isVerified={user.isVerified} size="sm" />
                        </div>
                        <div className="truncate text-xs text-[var(--color-text-tertiary)]">{user.email}</div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Badge tone="neutral">{roleLabel(user.role, locale)}</Badge>
                          <Badge tone="primary" className="!normal-case">LVL {user.level || 1}</Badge>
                        </div>
                      </div>

                      <Link
                        to={`/profile/${encodeURIComponent(user.username)}`}
                        role="menuitem"
                        onClick={() => setUserDropdown(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                      >
                        <User size={16} />
                        {t('nav.myProfile')}
                      </Link>

                      <Link
                        to={`/profile/${encodeURIComponent(user.username)}?tab=quests`}
                        role="menuitem"
                        onClick={() => setUserDropdown(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                      >
                        <LayoutGrid size={16} />
                        {t('nav.quests')}
                      </Link>

                      {(user.role === 'admin' || user.role === 'moderator') && (
                        <Link
                          to="/admin/reports"
                          role="menuitem"
                          onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-warning)] transition hover:bg-[var(--color-surface-2)]"
                        >
                          <Flag size={16} />
                          {t('nav.moderation')}
                        </Link>
                      )}

                      {user.role === 'admin' && (
                        <Link
                          to="/admin"
                          role="menuitem"
                          onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-primary-fg)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-primary-fg-light)]"
                        >
                          <Shield size={16} />
                          {t('nav.adminPanel')}
                        </Link>
                      )}

                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--color-tertiary-fg)] transition hover:bg-[var(--color-error-glow)] hover:text-[var(--color-tertiary-fg-soft)]"
                      >
                        <LogOut size={16} />
                        {t('nav.logout')}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link to="/login" className="ui-btn br-primary ui-btn-sm navbar-login">
                  <User size={14} />
                  <span className="hidden sm:inline">{t('nav.login')}</span>
                </Link>
              )}

              {/* Mobile menu toggle */}
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="ui-icon-btn lg:hidden"
                aria-label={menuOpen ? t('nav.menuClose') : t('nav.menuOpen')}
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          {/* Search drawer (prava pretraga foruma) */}
          {searchOpen && (
            <form
              id="navbar-search"
              ref={searchRef}
              onSubmit={submitSearch}
              className="border-t border-white/[0.06] py-3"
              role="search"
            >
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/50" size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t('nav.searchPlaceholder')}
                  aria-label={t('nav.searchLabel')}
                  className="ui-field !py-2.5 !pl-10"
                  autoFocus
                />
              </div>
            </form>
          )}

          {/* Mobile menu */}
          {menuOpen && (
            <div id="mobile-menu" className="space-y-1 border-t border-[var(--color-border-subtle)] py-3 lg:hidden">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.labelKey}
                  to={item.path}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  className="block rounded-md px-3 py-2.5 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                >
                  {t(item.labelKey)}
                </Link>
              ))}

              <div className="mt-2 border-t border-[var(--color-border-subtle)] pt-2">
                <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">{t('nav.sections')}</span>
                {CATEGORY_LINKS.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]"
                  >
                    {t(item.labelKey)}
                  </Link>
                ))}
              </div>

              {!isAuthenticated && (
                <Button block className="mt-2" onClick={() => navigate('/register')}>
                  {t('nav.register')}
                </Button>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}

function roleLabel(role: string | undefined, locale: string) {
  // Role skraćenice su deo brenda i iste u oba jezika, osim „ČLAN“.
  if (role === 'admin') return 'ADMIN';
  if (role === 'dev') return 'DEV';
  if (role === 'moderator') return 'MOD';
  return locale === 'sr' ? 'ČLAN' : 'MEMBER';
}

