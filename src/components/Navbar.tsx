import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Search, User, Menu, X, LogOut, Shield, Flag } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { Badge, Button, OnlineAvatar } from './ui';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { NotificationBell } from './NotificationBell';

/**
 * Navigacija koristi POSTOJEĆE stranice — ranije su „PlayStation“ i „Recenzije“
 * vodili na pogrešne forume (`/forum/consoles`, `/forum/hardware`).
 */
const NAV_ITEMS = [
  { label: 'Sve vesti', path: '/' },
  { label: 'Forum', path: '/forum' },
  // 2.6.0 — Deals / Popusti
  { label: 'Popusti', path: '/deals' },
  { label: 'PC Gaming', path: '/forum/pc-gaming' },
  { label: 'Konzole', path: '/forum/consoles' },
  { label: 'Esports', path: '/forum/esports' },
  { label: 'Hardver', path: '/forum/hardware' },
  { label: 'Rang lista', path: '/leaderboard' },
];

/** Stranice koje postoje na portalu (`/category/:name`). */
const CATEGORY_LINKS = [
  { label: 'Vesti', path: '/category/vesti' },
  { label: 'Recenzije', path: '/category/recenzije' },
  { label: 'Hardver', path: '/category/hardver' },
  { label: 'Najave', path: '/category/najave' },
  { label: 'Liste', path: '/category/liste' },
];

export default function Navbar() {
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
      {/* Top micro bar: datum + status portala (bez lažnog „LIVE“ indikatora) */}
      <div className="hidden border-b border-white/[0.05] bg-[#06070E]/90 px-4 py-1.5 text-xs text-slate-500 backdrop-blur-md sm:block">
        <div className="container flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="capitalize">
              {new Date().toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span className="text-white/15" aria-hidden="true">/</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-cyan-400">NEXUS Portal</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/deals" className="transition hover:text-cyan-300">
              Popusti
            </Link>
            <Link to="/forum" className="transition hover:text-cyan-300">
              Zajednica
            </Link>
            <Link to="/leaderboard" className="transition hover:text-cyan-300">
              Top članovi
            </Link>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <nav className="sticky top-0 z-50 border-b border-white/[0.08] bg-[#06070E]/80 backdrop-blur-xl">
        <div className="container">
          <div className="flex h-16 items-center justify-between gap-2">
            {/* Logo — Cyber Pulse mark */}
            <Link to="/" className="group flex items-center gap-2.5" aria-label="NEXUS — početna">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-violet-500 to-cyan-400 font-display text-lg font-extrabold tracking-wider text-white shadow-[0_0_15px_rgba(124,58,237,0.5)] transition-transform duration-150 group-hover:shadow-[0_0_22px_rgba(6,182,212,0.7)] group-active:scale-95">
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
            <div className="hidden items-center gap-0.5 lg:flex">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.label}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={`group relative rounded-md px-3 py-2 text-[13px] font-medium transition-all duration-200 ${active
                        ? 'text-white'
                        : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                      }`}
                  >
                    {item.label}
                    {active ? (
                      <span
                        className="absolute inset-x-3 -bottom-[9px] h-[2px] rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 shadow-[0_0_10px_rgba(124,58,237,0.7)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="absolute inset-x-3 -bottom-[9px] h-[2px] origin-center scale-x-0 rounded-full bg-gradient-to-r from-violet-500/70 to-cyan-400/70 transition-transform duration-300 ease-out group-hover:scale-x-100"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-2">
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
                      className="border border-violet-500/50"
                    />
                    <span className="hidden items-center gap-1 text-sm font-semibold text-white/90 sm:inline-flex">
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
                      <div className="mb-1 border-b border-white/10 px-3 py-2.5">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                          <span className="truncate">{user.username}</span>
                          <VerifiedBadge isVerified={user.isVerified} size="sm" />
                        </div>
                        <div className="truncate text-xs text-white/50">{user.email}</div>
                        <div className="mt-2 flex items-center gap-1.5">
                          <Badge tone="neutral">{roleLabel(user.role)}</Badge>
                          <Badge tone="primary" className="!normal-case">LVL {user.level || 1}</Badge>
                        </div>
                      </div>

                      <Link
                        to={`/profile/${encodeURIComponent(user.username)}`}
                        role="menuitem"
                        onClick={() => setUserDropdown(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.05] hover:text-white"
                      >
                        <User size={16} />
                        Moj profil
                      </Link>

                      <Link
                        to={`/profile/${encodeURIComponent(user.username)}?tab=quests`}
                        role="menuitem"
                        onClick={() => setUserDropdown(false)}
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.05] hover:text-white"
                      >
                        <LayoutGrid size={16} />
                        Kvestovi i bedževi
                      </Link>

                      {(user.role === 'admin' || user.role === 'moderator') && (
                        <Link
                          to="/admin/reports"
                          role="menuitem"
                          onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-amber-300 transition hover:bg-amber-500/10 hover:text-amber-200"
                        >
                          <Flag size={16} />
                          Moderacioni red
                        </Link>
                      )}

                      {user.role === 'admin' && (
                        <Link
                          to="/admin"
                          role="menuitem"
                          onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-violet-300 transition hover:bg-violet-500/10 hover:text-violet-200"
                        >
                          <Shield size={16} />
                          Admin panel
                        </Link>
                      )}

                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <LogOut size={16} />
                        Odjavi se
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link to="/login" className="ui-btn br-primary ui-btn-sm flex items-center gap-1.5">
                  <User size={14} />
                  <span>Prijava</span>
                </Link>
              )}

              {/* Mobile menu toggle */}
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="ui-icon-btn lg:hidden"
                aria-label={menuOpen ? 'Zatvori meni' : 'Otvori meni'}
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
                  placeholder="Pretraži članke, forum i popuste…"
                  aria-label="Pretraga foruma"
                  className="ui-field !py-2.5 !pl-10"
                  autoFocus
                />
              </div>
            </form>
          )}

          {/* Mobile menu */}
          {menuOpen && (
            <div id="mobile-menu" className="space-y-1 border-t border-white/[0.06] py-3 lg:hidden">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  to={item.path}
                  onClick={() => setMenuOpen(false)}
                  aria-current={isActive(item.path) ? 'page' : undefined}
                  className="block rounded-md px-3 py-2.5 text-sm text-slate-300 transition hover:bg-violet-500/10 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}

              <div className="mt-2 border-t border-white/[0.06] pt-2">
                <span className="px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Rubrike</span>
                {CATEGORY_LINKS.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-md px-3 py-2 text-sm text-slate-400 transition hover:bg-cyan-500/10 hover:text-cyan-200"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              {!isAuthenticated && (
                <Button block className="mt-2" onClick={() => navigate('/register')}>
                  Registruj se
                </Button>
              )}
            </div>
          )}
        </div>
      </nav>
    </>
  );
}

function roleLabel(role?: string) {
  if (role === 'admin') return 'ADMIN';
  if (role === 'dev') return 'DEV';
  if (role === 'moderator') return 'MOD';
  return 'ČLAN';
}
