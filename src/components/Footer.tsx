import { Link } from 'react-router-dom';
import { Github, Youtube, Twitch, ShieldCheck } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="forge-footer mt-24 border-t border-white/[0.08] pb-20 lg:pb-0">
      <div className="container py-14">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="flex items-center gap-2.5 mb-4 group inline-flex">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-violet-500 to-cyan-400 font-display text-base font-extrabold tracking-wider text-white shadow-[0_0_15px_rgba(124,58,237,0.5)] transition-shadow duration-300 group-hover:shadow-[0_0_22px_rgba(6,182,212,0.65)]">
                N
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-lg font-semibold tracking-[0.08em] text-white transition-colors group-hover:text-violet-300">NEXUS</span>
                <span className="rounded-[4px] border border-cyan-400/50 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300 shadow-[inset_0_0_10px_rgba(6,182,212,0.15)]">
                  GG
                </span>
              </div>
            </Link>
            <p className="text-xs text-white/55 leading-relaxed mb-4">
              Vodeći domaći gejming portal i interaktivni forum sa sistemom reputacije, analizama hardvera, e-sport turnirima i gejmifikovanim profilima.
            </p>
            <div className="flex items-center gap-2 text-xs text-white/55">
              <ShieldCheck size={14} className="text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]" />
              <span>SSL Zaštićeno • Supabase Cloud</span>
            </div>
          </div>

          {/* Links: Portal */}
          <div>
            <h4 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Portal &amp; Magazin</h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li><Link to="/" className="transition hover:text-cyan-300">Sve Vesti</Link></li>
              <li><Link to="/category/Hardware" className="transition hover:text-cyan-300">Hardver &amp; Benchmark</Link></li>
              <li><Link to="/category/Recenzija" className="transition hover:text-cyan-300">Recenzije Igara</Link></li>
              <li><Link to="/category/Najave" className="transition hover:text-cyan-300">Najave &amp; Trejleri</Link></li>
              <li><Link to="/leaderboard" className="transition hover:text-cyan-300">Top Članovi (Hall of Fame)</Link></li>
            </ul>
          </div>

          {/* Links: Forum */}
          <div>
            <h4 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Gaming Forum</h4>
            <ul className="space-y-2 text-xs text-slate-400">
              <li><Link to="/forum/pc-gaming" className="transition hover:text-cyan-300">PC Gaming Diskusije</Link></li>
              <li><Link to="/forum/consoles" className="transition hover:text-cyan-300">PlayStation, Xbox &amp; Switch</Link></li>
              <li><Link to="/forum/esports" className="transition hover:text-cyan-300">Esports &amp; Turniri</Link></li>
              <li><Link to="/forum/hardware" className="transition hover:text-cyan-300">Sklapanje Konfiguracija</Link></li>
              <li><Link to="/forum/lfg" className="transition hover:text-cyan-300">LFG — Pronađi Ekipu</Link></li>
            </ul>
          </div>

          {/* Community & Socials */}
          <div>
            <h4 className="mb-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Zajednica</h4>
            <p className="mb-4 text-xs text-slate-400">Pridruži se zvaničnim kanalima za turnire, nagradne igre i diskusije.</p>
            {/*
              F-29 — stvarni profili portala. Linkovi se postavljaju kroz env
              (`VITE_SOCIAL_*`); ikonica bez profila se NE prikazuje, umesto linka
              ka početnoj stranici servisa.
            */}
            <div className="flex gap-2">
              {[
                { label: 'YouTube', href: import.meta.env.VITE_SOCIAL_YOUTUBE, Icon: Youtube },
                { label: 'Twitch', href: import.meta.env.VITE_SOCIAL_TWITCH, Icon: Twitch },
                { label: 'GitHub', href: import.meta.env.VITE_SOCIAL_GITHUB, Icon: Github },
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
                    className="ui-icon-btn !h-8 !w-8"
                  >
                    <Icon size={15} />
                  </a>
                ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Zvanični profili se postavljaju pre objavljivanja portala.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-6 text-xs text-slate-500 sm:flex-row">
          <p className="font-mono">© 2026 NEXUS Gaming Portal. Sva prava zadržana.</p>
          <div className="flex gap-6">
            <Link to="/privacy" className="transition hover:text-cyan-300">Politika privatnosti</Link>
            <Link to="/terms" className="transition hover:text-cyan-300">Uslovi korišćenja</Link>
            <Link to="/rules" className="transition hover:text-cyan-300">Pravila foruma</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
