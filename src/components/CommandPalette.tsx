import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CornerDownLeft, FileText, Gamepad2, LifeBuoy, MessageSquare, Search as SearchIcon,
  Tag, Trophy, X,
} from 'lucide-react';
import { api, type SearchHit } from '../lib/api';
import type { SearchScope } from '../../contracts/index';
import { cn } from './ui';

/**
 * F-13 — globalna pretraga sa tastaturom (⌘K / Ctrl+K).
 *
 * Zašto overlay, a ne samo `/search`: do sada je pretraga bila skrivena iza
 * ikone, a do teme/deal-a se stizalo tek posle dva klika. Ovde je tok
 * „otvori → kucaj → Enter“, sa skokom na tip (članci / forum / odgovori /
 * popusti) i pamćenjem poslednjih pretraga.
 *
 * Podaci: isti `GET /api/search` ugovor kao `/search` stranica — overlay ne
 * uvodi drugi izvor istine. `type=replies` (F-13 server deo) vraća odgovore
 * iz tema sa dubokim linkom `#post-<id>`.
 *
 * Stanje „poslednje pretrage“ je u `localStorage` (nije osetljivo); čuva se
 * najviše 6 unosa, bez duplikata.
 */

const RECENT_KEY = 'nexus-recent-searches';
const MAX_RECENT = 6;

const SCOPES: Array<{ id: SearchScope; label: string }> = [
  { id: 'all', label: 'Sve' },
  { id: 'articles', label: 'Članci' },
  { id: 'threads', label: 'Teme' },
  { id: 'replies', label: 'Odgovori' },
  { id: 'deals', label: 'Popusti' },
];

/** Brzi skokovi — ono što korisnik traži češće od pretrage. */
const SHORTCUTS: Array<{ label: string; href: string; icon: typeof FileText }> = [
  { label: 'Forum', href: '/forum', icon: MessageSquare },
  { label: 'Popusti', href: '/deals', icon: Tag },
  { label: 'Igre', href: '/games', icon: Gamepad2 },
  { label: 'Rang lista', href: '/leaderboard', icon: Trophy },
  { label: 'Pravila', href: '/rules', icon: LifeBuoy },
];

const HIT_ICON: Record<SearchHit['type'], typeof FileText> = {
  article: FileText,
  thread: MessageSquare,
  reply: CornerDownLeft,
  deal: Tag,
};

const HIT_LABEL: Record<SearchHit['type'], string> = {
  article: 'Članak',
  thread: 'Tema',
  reply: 'Odgovor',
  deal: 'Popust',
};

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecent(term: string): string[] {
  const next = [term, ...readRecent().filter((item) => item !== term)].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* privatni režim / pun storage — istorija je ukras, ne funkcija */
  }
  return next;
}

/** Tastatura: ⌘K / Ctrl+K otvara, Esc zatvara. */
export function useCommandPaletteShortcut(onOpen: () => void, onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCombo) {
        event.preventDefault();
        onOpen();
        return;
      }
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen, onClose]);
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Otvaranje: sveže stanje + fokus na polje.
  useEffect(() => {
    if (!open) return;
    setRecent(readRecent());
    setActive(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const query = term.trim();
  const { data, isFetching } = useQuery({
    queryKey: ['palette-search', query, scope],
    queryFn: () => api.search.all(query, scope, 8),
    enabled: open && query.length >= 2,
    staleTime: 30_000,
  });

  const hits = data?.hits ?? [];

  // Lista za tastaturu: rezultati kada ima upita, inače skokovi.
  const rows = useMemo(() => {
    if (query.length >= 2) return hits;
    return [];
  }, [hits, query.length]);

  const go = useCallback(
    (href: string, value?: string) => {
      if (value && value.length >= 2) setRecent(pushRecent(value));
      onClose();
      navigate(href);
    },
    [navigate, onClose],
  );

  const submit = () => {
    if (query.length < 2) return;
    if (rows.length > 0 && rows[active]) {
      go(rows[active].href, query);
      return;
    }
    go(`/search?q=${encodeURIComponent(query)}${scope !== 'all' ? `&type=${scope}` : ''}`, query);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const max = Math.max(rows.length, 1);
      setActive((current) => (current + 1) % max);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const max = Math.max(rows.length, 1);
      setActive((current) => (current - 1 + max) % max);
      return;
    }
    if (event.key === 'Tab' && rows.length === 0) {
      // Tab bez upita menja brzi skok; sa rezultatima tab ostaje fokus.
      event.preventDefault();
    }
  };

  // Aktivni red se skroluje u vidno polje pri navigaciji strelicama.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 px-3 pt-[8vh] backdrop-blur-sm sm:pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Globalna pretraga"
        className="w-full max-w-2xl overflow-hidden rounded-xl border-white/10 bg-[var(--color-surface-1)] shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-3">
          <SearchIcon size={16} className="text-white/40" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Traži članke, teme, odgovore i popuste…"
            aria-label="Pretraga"
            aria-controls="palette-results"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/35"
          />
          {isFetching && <span className="font-mono text-[10px] uppercase tracking-wider text-white/30">traži…</span>}
          <button type="button" onClick={onClose} className="ui-icon-btn !h-7 !w-7" aria-label="Zatvori pretragu">
            <X size={14} />
          </button>
        </div>

        {/* Skok na tip — isti tabovi kao `/search`, bez napuštanja overlaya. */}
        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] px-3 py-2" role="tablist" aria-label="Vrsta sadržaja">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={scope === item.id}
              onClick={() => {
                setScope(item.id);
                setActive(0);
                inputRef.current?.focus();
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                scope === item.id ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.length >= 2 ? (
            rows.length > 0 ? (
              <ul id="palette-results" ref={listRef} role="listbox" aria-label="Rezultati pretrage">
                {rows.map((hit, index) => {
                  const Icon = HIT_ICON[hit.type];
                  return (
                    <li key={`${hit.type}-${hit.id}`} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        data-row={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit.href, query)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                          index === active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                        )}
                      >
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-cyan-300">
                          <Icon size={14} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-white">{hit.title}</span>
                            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-white/35">
                              {HIT_LABEL[hit.type]}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-xs text-white/50">{hit.snippet}</span>
                          {hit.type === 'reply' && hit.extra && (
                            <span className="mt-0.5 block font-mono text-[10px] text-white/35">{hit.extra}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-3 py-6 text-center text-sm text-white/50">
                {isFetching ? 'Tražim…' : `Nema rezultata za „${query}“.`}
                {data?.suggestion && (
                  <button
                    type="button"
                    className="mt-2 block w-full text-center text-cyan-300 hover:text-cyan-200"
                    onClick={() => {
                      setTerm(data.suggestion!);
                      setActive(0);
                    }}
                  >
                    Da li ste mislili: {data.suggestion}?
                  </button>
                )}
              </div>
            )
          ) : recent.length > 0 || SHORTCUTS.length > 0 ? (
            <div className="space-y-3">
              {recent.length > 0 && (
                <div>
                  <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">Poslednje pretrage</div>
                  {recent.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setTerm(item);
                        inputRef.current?.focus();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
                    >
                      <SearchIcon size={13} className="text-white/30" aria-hidden="true" />
                      {item}
                    </button>
                  ))}
                </div>
              )}
              <div>
                <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/30">Skok na</div>
                {SHORTCUTS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => go(item.href)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
                    >
                      <Icon size={13} className="text-white/30" aria-hidden="true" />
                      {item.label}
                      <ArrowRight size={12} className="ml-auto text-white/20" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-white/30">
          <span>↑↓ biraj · Enter otvori · Esc zatvori</span>
          <span>{query.length >= 2 ? `${hits.length} rezultata` : '⌘K / Ctrl+K'}</span>
        </div>
      </div>
    </div>
  );
}
