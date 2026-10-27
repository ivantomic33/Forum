import { Link } from 'react-router-dom';
import { Youtube, Twitch, Github } from 'lucide-react';

/**
 * Footer — mirna, neutralna zona: tekst i naslovi kolona idu kroz tokene,
 * linkovi na hover u cyan (forum/sadržajna zona). Brend mark koristi
 * `--gradient-brand` (dozvoljeni gradijent), ne hardkodovan violet→cyan.
 *
 * 5.0 TERMINAL — linkovi kao komande, path naslovi, version tag sa tooltipom,
 * status red (ssl/cloud + scroll-to-top).
 */

/** Version tag tooltip sadržaj (8) — build info za hover */
const BUILD_INFO = 'build 2026.10 · commit a3f2c9';

export default function Footer() {
  const columnTitleClass = 'footer-path font-mono text-[11px] font-medium tracking-[0.06em] text-[var(--color-text-tertiary)]';
  const columnListClass = 'footer-cmds space-y-2 text-xs text-[var(--color-text-secondary)]';
  const linkClass = 'footer-cmd transition hover:text-[var(--color-secondary)]';

  return (
    <footer className="forge-footer mt-24 border-t border-[var(--color-border-subtle)] pb-20 lg:pb-0">
      <div className="container py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 mb-4 group inline-flex">
              <div className="nexus-logo-mark flex h-9 w-9 items-center justify-center rounded-[10px] font-display text-base font-extrabold tracking-wider text-[var(--color-on-solid)] transition-transform duration-150 group-active:scale-95">
                N
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-lg font-semibold tracking-[0.08em] text-[var(--color-text-primary)] transition-colors group-hover:text-[var(--color-primary-fg)]">NEXUS</span>
                <span className="rounded-[4px] border-[var(--color-secondary-glow)] bg-[var(--color-secondary-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-info-fg)]">
                  GG
                </span>
              </div>
            </Link>
            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mb-4">
              Vodeći domaći gejming portal i interaktivni forum sa sistemom reputacije, analizama hardvera, e-sport turnirima i gejmifikovanim profilima.
            </p>
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              {/* 9 — sys status: mono checkmarkovi umesto ikone */}
              <span className="footer-sys font-mono text-[11px] text-[var(--color-text-tertiary)]">
                <span className="text-[var(--color-accent)]">✓</span> ssl
                <span className="mx-1.5 opacity-40">·</span>
                <span className="text-[var(--color-accent)]">✓</span> cloud:supabase
              </span>
            </div>
            {/* 8 — version tag sa tooltip-om */}
            <div className="footer-version font-mono text-[10px] text-[var(--color-text-muted)]" tabIndex={0}>
              v5.0.0
              <span className="footer-version-tip" role="tooltip">[{BUILD_INFO}]</span>
            </div>
          </div>

          {/* Links: Portal — 6: path-style naslov */}
          <div>
            <h4 className={columnTitleClass}>~/portal/</h4>
            <ul className={columnListClass}>
              <li><Link to="/" className={linkClass}>Sve Vesti</Link></li>
              <li><Link to="/category/Hardware" className={linkClass}>Hardver &amp; Benchmark</Link></li>
              <li><Link to="/category/Recenzija" className={linkClass}>Recenzije Igara</Link></li>
              <li><Link to="/category/Najave" className={linkClass}>Najave &amp; Trejleri</Link></li>
              <li><Link to="/leaderboard" className={linkClass}>Top Članovi (Hall of Fame)</Link></li>
            </ul>
          </div>

          {/* Links: Forum */}
          <div>
            <h4 className={columnTitleClass}>~/forum/</h4>
            <ul className={columnListClass}>
              <li><Link to="/forum/pc-gaming" className={linkClass}>PC Gaming Diskusije</Link></li>
              <li><Link to="/forum/consoles" className={linkClass}>PlayStation, Xbox &amp; Switch</Link></li>
              <li><Link to="/forum/esports" className={linkClass}>Esports &amp; Turniri</Link></li>
              <li><Link to="/forum/hardware" className={linkClass}>Sklapanje Konfiguracija</Link></li>
              <li><Link to="/forum/lfg" className={linkClass}>LFG — Pronađi Ekipu</Link></li>
            </ul>
          </div>

          {/* Community & Socials */}
          <div>
            <h4 className={columnTitleClass}>~/community/</h4>
            <p className="mb-4 text-xs text-[var(--color-text-secondary)]">Pridruži se zvaničnim kanalima za turnire, nagradne igre i diskusije.</p>
            {/*
              F-29 — stvarni profili portala. Linkovi se postavljaju kroz env
              (`VITE_SOCIAL_*`); ikonica bez profila se NE prikazuje, umesto linka
              ka početnoj stranici servisa.
            */}
            <div className="footer-socials">
              {[
                { label: 'youtube', href: import.meta.env.VITE_SOCIAL_YOUTUBE, Icon: Youtube },
                { label: 'twitch', href: import.meta.env.VITE_SOCIAL_TWITCH, Icon: Twitch },
                { label: 'github', href: import.meta.env.VITE_SOCIAL_GITHUB, Icon: Github },
              ]
                .filter((social): social is { label: string; href: string; Icon: typeof Youtube } =>
                  Boolean(social.href && /^https:\/\//.test(String(social.href))),
                )
                .map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`NEXUS na ${label}`}
                    className="footer-social-tag"
                  >
                    <Icon aria-hidden="true" />
                    [{label}]
                  </a>
                ))}
            </div>
            <p className="mt-4 text-xs text-[var(--color-text-tertiary)]">
              Zvanični profili se postavljaju pre objavljivanja portala.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-6 text-xs text-[var(--color-text-tertiary)] sm:flex-row">
          <p className="font-mono">© 2026 NEXUS Gaming Portal. Sva prava zadržana.</p>
          <div className="flex items-center gap-6">
            <Link to="/privacy" className={linkClass}>Politika privatnosti</Link>
            <Link to="/terms" className={linkClass}>Uslovi korišćenja</Link>
            <Link to="/rules" className={linkClass}>Pravila foruma</Link>
            {/* 10 — scroll-to-top kao komanda */}
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="footer-top font-mono text-[11px] text-[var(--color-text-muted)] transition hover:text-[var(--color-primary-fg)]"
              aria-label="Nazad na vrh strane"
            >
              [ ↑ top ]
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
