import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, FileText, Scale, Search, Shield } from 'lucide-react';

/**
 * U-13 — zajednička školjka za pravne stranice (Uslovi / Privatnost / Pravila).
 *
 * Ranije su sve tri bile isti šablon: centriran naslov + jedna kutija teksta i
 * nijedan put nazad u sadržaj. Sada:
 *
 *  - leva kolona je SADRŽAJ dokumenta (sticky, sa aktivnom sekcijom) — pravni
 *    tekst se skenira, ne čita od početka;
 *  - desna kolona je „nazad u NEXUS“: forum, popusti, poslednje vesti;
 *  - 404 koristi isti jezik (vidi `NotFoundPage`), pa se greška ne oseća kao
 *    mrtav kraj.
 *
 * Sadržaj se izdvaja u <article> sa `.article-rich-content` — isti režim čitanja
 * kao članak (16/26, print, AA kontrast).
 */

/**
 * Sekcija pravnog dokumenta. `body` je niz pasusa (terminologija Uslova) —
 * sekcije sa jednim pasusom mogu da pošalju i string (Politika privatnosti).
 */
export interface LegalSection {
  id: string;
  title: string;
  body?: string | readonly string[];
  body2?: string | readonly string[];
  bullets?: readonly string[];
  italic?: string;
}

/** Pasusi sekcije, bez obzira na to da li su poslati kao string ili niz. */
function paragraphs(value: LegalSection['body']): string[] {
  if (!value) return [];
  return Array.isArray(value) ? [...value] : [value as string];
}

export interface LegalDoc {
  /** „Legal“ / „Zajednica“ — eyebrow */
  eyebrow: string;
  title: string;
  description: string;
  version?: string;
  icon: 'scale' | 'shield' | 'rules';
  sections: readonly LegalSection[];
}

const ICONS = {
  scale: Scale,
  shield: Shield,
  rules: FileText,
} as const;

export function LegalLayout({ doc, footerNote }: { doc: LegalDoc; footerNote?: ReactNode }) {
  const [query, setQuery] = useState('');
  const Icon = ICONS[doc.icon];

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return doc.sections;
    return doc.sections.filter((section) => {
      const haystack = [
        section.title,
        section.body,
        section.body2,
        section.italic,
        ...(section.bullets ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [doc.sections, query]);

  return (
    <div className="section">
      <div className="container">
        <nav className="crumbs mb-6" aria-label="Putanja">
          <Link to="/">Početna</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span>{doc.title}</span>
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <article className="min-w-0 lg:col-span-8">
            <header className="mb-8 border-b border-[var(--color-border-subtle)] pb-6">
              <span className="eyebrow mb-3">
                <Icon size={13} aria-hidden="true" />
                {doc.eyebrow}
              </span>
              <h1 className="page-title">{doc.title}</h1>
              <p className="text-lead mt-3 max-w-2xl">{doc.description}</p>
              {doc.version && <p className="text-meta mt-2">{doc.version}</p>}
            </header>

            {/* Pretraga unutar dokumenta — dokumenti imaju 6–9 sekcija */}
            <div className="relative mb-8 max-w-md" role="search">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pretraži ovaj dokument…"
                aria-label={`Pretraga: ${doc.title}`}
                className="ui-field !pl-9"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-body rounded-lg border-dashed border-[var(--color-border-default)] p-6">
                Nema sekcija koje sadrže „{query}“.{' '}
                <button type="button" className="underline" onClick={() => setQuery('')}>
                  Prikaži sve
                </button>
              </p>
            ) : (
              <div className="article-rich-content space-y-8">
                {filtered.map((section) => (
                  <section key={section.id} id={`sekcija-${section.id}`} className="scroll-mt-24">
                    <h2 className="!mt-0 flex items-baseline gap-3 !text-[var(--text-h3)]">
                      <span className="font-mono text-meta text-[var(--color-text-tertiary)]">{section.id}.</span>
                      {section.title}
                    </h2>
                    {paragraphs(section.body).map((text, index) => (
                      <p key={`b-${index}`}>{text}</p>
                    ))}
                    {paragraphs(section.body2).map((text, index) => (
                      <p key={`b2-${index}`}>{text}</p>
                    ))}
                    {section.bullets && (
                      <ul>
                        {section.bullets.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {section.italic && (
                      <blockquote className="!not-italic text-body">{section.italic}</blockquote>
                    )}
                  </section>
                ))}
              </div>
            )}

            {footerNote && (
              <div className="mt-10 rounded-lg border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 text-meta">
                {footerNote}
              </div>
            )}

            <div className="mt-8 flex-wrap items-center gap-3">
              <Link to="/" className="ui-btn br-secondary ui-btn-sm">
                <ArrowLeft size={14} /> Početna
              </Link>
              <Link to="/forum" className="ui-btn br-ghost ui-btn-sm">
                Forum
              </Link>
            </div>
          </article>

          {/* Desna kolona: navigacija dokumentom + put nazad u sadržaj */}
          <aside className="space-y-8 lg:col-span-4 lg:sticky lg:top-24 lg:self-start">
            <nav className="rail-panel" aria-label="Sadržaj dokumenta">
              <h2 className="rail-title mb-3">Sadržaj</h2>
              <ol className="space-y-1.5">
                {doc.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#sekcija-${section.id}`}
                      className="flex gap-2 text-meta leading-snug text-[var(--color-text-secondary)] transition hover:text-[var(--color-primary-fg)]"
                    >
                      <span className="font-mono text-micro">{section.id}</span>
                      <span>{section.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="rail-panel">
              <h2 className="rail-title mb-2">Nazad u sadržaj</h2>
              <div className="space-y-1">
                {[
                  { to: '/', label: 'Najnovije vesti' },
                  { to: '/deals', label: 'Popusti danas' },
                  { to: '/forum', label: 'Forum — aktivne teme' },
                  { to: '/leaderboard', label: 'Rang lista' },
                ].map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="flex items-center justify-between gap-2 rounded-md py-2 text-meta font-medium text-[var(--color-text-primary)] transition hover:text-[var(--color-primary-fg)]"
                  >
                    {link.label}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>

            {doc.icon === 'scale' ? (
              <div className="rail-panel">
                <h2 className="rail-title mb-2">U vezi sa uslovima</h2>
                <p className="text-meta">
                  Odgovor na pitanje o uslovima ili moderaciji:{' '}
                  <a className="underline" href="mailto:support@nexusgaming.com">support@nexusgaming.com</a>.
                </p>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
