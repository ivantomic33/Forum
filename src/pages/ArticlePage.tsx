import { useParams, Link } from 'react-router-dom';
import { Clock, MessageSquare, Bookmark, Share2, Flame, ThumbsUp, Sparkles, Zap, Brain, Send, Eye, CheckCircle2, XCircle, Award } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useSanitizedHtml } from '../lib/sanitizeHtml';
import { useAuthStore } from '../store/authStore';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';

const DEFAULT_ARTICLE = {
  id: 'art_1',
  slug: 'cyberpunk-2077-phantom-liberty-analiza',
  title: 'Cyberpunk 2077: Phantom Liberty DLC stiže sa revolucionarnim promenama',
  author: 'NeuroGamer',
  authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NeuroGamer',
  publishedAt: '2026-10-15',
  category: 'Vesti',
  coverImage: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&q=80',
  views: 12400,
  reactions: { like: 342, gg: 189, hype: 420, fire: 98, mind_blown: 67 },
  content: `Night City nikada nije izgledala ovako realno. CD Projekt Red najavljuje ekspanziju koja će zauvek promeniti Cyberpunk 2077.

## Phantom Liberty — Nova era Night Cityja

Nakon dve godine kontinuiranih ažuriranja, CD Projekt Red konačno otkriva svoju prvu glavnu ekspanziju za Cyberpunk 2077 — Phantom Liberty. Ovaj dodatak nije samo novi sadržaj, već potpuna rekonstrukcija mnogih sistema igre.

### Šta donosi ekspanzija?

**Nova lokacija: Dogtown**
Potpuno nova četvrt Night Cityja, Dogtown, predstavlja zapušteni deo grada kontrolisan od strane para-vojne organizacije Barghest. Ova zona nudi:
- 15+ sati nove priče i špijunskog trilera
- Unikatan dizajn okruženja sa post-apokaliptičnim elementima
- Nove frakcije i NPC-jeve sa kompleksnim motivacijama

**Rework sistema**
- **Policijski sistem 2.0**: Inteligentni policajci koji reaguju na kontekst
- **Vehicular combat**: Pucanje iz vozila i naoružana oklopna kola
- **Perk tree**: Potpuno prepravljeno stablo veština i Relic implantati

### Tehnički skok napred
Phantom Liberty postavlja novi standard za Ray Tracing i Path Tracing vizuele na PC-ju.

*Ocena redakcije: 9.5 / 10*`,
};

import { usePageMeta, newsArticleJsonLd } from '../lib/pageMeta';

export default function ArticlePage() {
  const { id } = useParams();
  const currentUser = useAuthStore((s) => s.user);

  const [article, setArticle] = useState<any>(null);
  // Ranije je postojao lažni fallback članak sa izmišljenih 12.4k pregleda —
  // sada se prikazuje pošteno stanje (loading / 404 / greška).
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const safeContent = useSanitizedHtml(markdownToHtml(article?.content ?? ''));
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [userReactions, setUserReactions] = useState<Set<string>>(new Set());

  const [bookmarked, setBookmarked] = useState<boolean>(false);

  // F-19 — naslov/description/canonical/OG/JSON-LD po ruti (SPA bez SSR-a).
  usePageMeta({
    title: article?.title ?? (loadError ? 'Članak nije pronađen' : 'Portal'),
    description: article?.excerpt || undefined,
    path: article?.slug ? `/article/${article.slug}` : id ? `/article/${id}` : '/',
    type: 'article',
    image: article?.coverImage || undefined,
    publishedTime: article?.publishedAt ?? article?.createdAt,
    modifiedTime: article?.updatedAt,
    jsonLd: article
      ? newsArticleJsonLd({
          headline: article.title,
          description: article.excerpt ?? '',
          url: `${window.location.origin}/article/${article.slug || article.id}`,
          image: article.coverImage || undefined,
          datePublished: article.publishedAt ?? article.createdAt,
          dateModified: article.updatedAt,
          author: article.author,
        })
      : undefined,
    noIndex: !article || (article.status && article.status !== 'published'),
  });

  // Komentari dolaze sa servera (ranije su bila dva izmišljena komentara).
  const [comments, setComments] = useState<any[]>([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setLoadError('Članak nije pronađen.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api.articles
      .get(id)
      .then((data) => {
        if (cancelled || !data) return;
        setArticle(data);
        setReactions(data.reactions ?? {});
      })
      .catch((error: any) => {
        if (cancelled) return;
        setArticle(null);
        setLoadError(error?.message || 'Članak trenutno nije dostupan.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!article?.id) return;
    let cancelled = false;
    setCommentsLoading(true);
    api.articles
      .comments(article.id)
      .then((res) => {
        if (!cancelled) setComments(res.comments ?? []);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [article?.id]);

  // Sačuvano: server za prijavljene, localStorage za goste (bez lažnog početnog stanja).
  useEffect(() => {
    if (!article?.id) return;
    if (currentUser) {
      api.articles
        .bookmarks()
        .then((res) => {
          const ids = new Set((res.articles ?? []).map((item: any) => item.id));
          setBookmarked(ids.has(article.id));
        })
        .catch(() => setBookmarked(false));
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem('nexus_bookmarks') || '[]');
      setBookmarked(Array.isArray(saved) && saved.includes(article.id));
    } catch {
      setBookmarked(false);
    }
  }, [article?.id, currentUser]);

  const handleReaction = async (type: 'like' | 'gg' | 'hype' | 'fire' | 'mind_blown') => {
    if (!article?.id) return;
    if (!currentUser) {
      toast.error('Prijavite se da biste reagovali.');
      return;
    }

    const previousReactions = reactions;
    const previousMine = userReactions;
    const wasActive = userReactions.has(type);
    setUserReactions((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    setReactions((prev) => ({
      ...prev,
      [type]: Math.max(0, (prev[type] || 0) + (wasActive ? -1 : 1)),
    }));

    try {
      // Server vraća tačne brojeve (izvor istine).
      const result = await api.articles.react(article.id, type);
      setReactions(result.reactions ?? previousReactions);
    } catch (error: any) {
      setReactions(previousReactions);
      setUserReactions(previousMine);
      toast.error(error?.message || 'Reakcija nije zabeležena.');
    }
  };

  const toggleBookmark = async () => {
    if (!article?.id) return;
    const next = !bookmarked;
    setBookmarked(next);

    // Backend je izvor istine kada je korisnik prijavljen; localStorage je fallback za goste.
    if (currentUser) {
      try {
        if (next) await api.articles.bookmark(article.id);
        else await api.articles.unbookmark(article.id);
        return;
      } catch {
        setBookmarked(!next);
        toast.error('Čuvanje članka nije uspelo.');
        return;
      }
    }

    const saved = localStorage.getItem('nexus_bookmarks');
    let list = saved ? JSON.parse(saved) : [];
    if (next) list = Array.from(new Set([...list, article.id]));
    else list = list.filter((x: string) => x !== article.id);
    localStorage.setItem('nexus_bookmarks', JSON.stringify(list));
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !article) return;

    if (!currentUser) {
      toast.error('Prijavite se da biste ostavili komentar.');
      return;
    }

    try {
      const created = await api.articles.addComment(article.id, newCommentText.trim());
      setComments((prev) => [...prev, created]);
      setNewCommentText('');
    } catch (err: any) {
      toast.error(err?.message || 'Komentar nije poslat.');
    }
  };

  if (loading) {
    return (
      <div className="section">
        <div className="container max-w-3xl" aria-busy="true">
          <div className="ui-skeleton mb-6 h-4 w-40" />
          <div className="ui-skeleton mb-4 h-10 w-full" />
          <div className="ui-skeleton mb-8 h-10 w-2/3" />
          <div className="ui-skeleton mb-8 aspect-[16/9] w-full rounded-lg" />
          <SkeletonRows rows={3} />
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="section">
        <div className="container max-w-3xl">
          <EmptyState
            icon={<MessageSquare size={22} />}
            title="Članak nije pronađen"
            message={loadError || 'Članak je možda uklonjen ili link nije tačan.'}
            action={
              <Link to="/" className="ui-btn br-primary ui-btn-sm">
                Sve vesti
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const publishedLabel = article.publishedAt
    ? new Date(article.publishedAt).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Danas';

  return (
    <div className="pb-16 pt-8">
      <div className="container max-w-3xl">
        {/* Breadcrumb */}
        <nav className="crumbs mb-8" aria-label="Putanja">
          <Link to="/">Portal</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-cyan-400">
            {article.category}
          </span>
        </nav>

        <article>
          {/* Article Header — editorial */}
          <header className="mb-9">
            <h1 className="mb-5 font-display text-[1.875rem] font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-[2.5rem]">
              {article.title}
            </h1>

            <div className="flex flex-wrap items-center justify-between gap-5 border-y border-white/[0.07] py-4">
              <div className="flex items-center gap-3">
                <img
                  src={article.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${article.author}`}
                  alt={article.author}
                  className="h-10 w-10 rounded-full border border-white/15 bg-surface-0"
                />
                <div>
                  <div className="text-sm font-medium text-white">{article.author || 'NEXUS Staff'}</div>
                  <div className="text-xs text-white/45">Gaming Redakcija</div>
                </div>
              </div>
              <div className="meta-row">
                <span className="flex items-center gap-1.5">
                  <Clock size={13} aria-hidden="true" /> {publishedLabel}
                </span>
                <span>7 min čitanja</span>
                <span className="flex items-center gap-1.5">
                  <Eye size={13} aria-hidden="true" /> {(article.views || 0).toLocaleString('sr-Latn-RS')} pregleda
                </span>
              </div>
            </div>
          </header>

          {/* Featured Image */}
          {article.coverImage || article.image ? (
            <figure className="mb-9 overflow-hidden rounded-2xl border border-white/[0.08] bg-surface-0 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <img
                src={article.coverImage || article.image}
                alt={article.title}
                className="aspect-[16/9] w-full object-cover"
              />
            </figure>
          ) : null}

          {/* Content — HTML sadržaj iz CMS-a renderuje se samo posle DOMPurify sanitizacije */}
          <div className="article-rich-content text-[16px] leading-[1.72] text-white/80 sm:text-[17px]">
            <div dangerouslySetInnerHTML={{ __html: safeContent }} />
          </div>

          {/* IGN-Style Review Scorecard */}
          {article.reviewScorecard && (article.reviewScorecard.score !== undefined || article.reviewScorecard.verdict) && (
            <div className="mt-12 overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0D101D]/80 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md">
              <div className="border-b border-white/10 bg-gradient-to-r from-violet-600/15 via-transparent to-cyan-500/10 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-cyan-300 border border-violet-500/35 shadow-[0_0_18px_-6px_rgba(124,58,237,0.8)]">
                    <Award size={22} />
                  </div>
                  <div>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-violet-300 font-semibold">
                      NEXUS Gaming Ocena
                    </span>
                    <h3 className="text-xl font-bold text-white">Presuda Redakcije</h3>
                  </div>
                </div>

                {article.reviewScorecard.score !== undefined && (
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500 font-display text-3xl sm:text-4xl font-extrabold text-white shadow-[0_0_28px_-4px_rgba(124,58,237,0.75)]">
                      {article.reviewScorecard.score}
                    </div>
                    <div className="text-xs font-mono uppercase text-white/40">
                      / 10<br />Bodova
                    </div>
                  </div>
                )}
              </div>

              {article.reviewScorecard.verdict && (
                <div className="p-5 sm:p-6 border-b border-white/5 bg-white/[0.015]">
                  <p className="text-base sm:text-lg italic text-slate-100 leading-relaxed font-serif">
                    „{article.reviewScorecard.verdict}“
                  </p>
                </div>
              )}

              {((article.reviewScorecard.pros && article.reviewScorecard.pros.length > 0) ||
                (article.reviewScorecard.cons && article.reviewScorecard.cons.length > 0)) && (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-white/10 p-5 sm:p-6 bg-surface-2/40 gap-6">
                  {/* Pros */}
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                      <CheckCircle2 size={16} />
                      <span>Dobre strane (+)</span>
                    </div>
                    <ul className="space-y-2">
                      {(article.reviewScorecard.pros || []).map((pro: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                          <span className="text-emerald-400 font-bold mt-0.5">•</span>
                          <span>{pro}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Cons */}
                  <div className="pt-6 md:pt-0">
                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-400">
                      <XCircle size={16} />
                      <span>Loše strane (-)</span>
                    </div>
                    <ul className="space-y-2">
                      {(article.reviewScorecard.cons || []).map((con: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                          <span className="text-rose-400 font-bold mt-0.5">•</span>
                          <span>{con}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Gaming Reactions bar */}
          <section className="mt-12 border-t border-white/[0.08] pt-7" aria-label="Reakcije">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Reakcije gejmera na ovaj članak
            </div>
            <div className="flex flex-wrap gap-2">
              <ReactionButton
                label="Like"
                icon={<ThumbsUp size={15} />}
                count={reactions.like || 0}
                active={userReactions.has('like')}
                onClick={() => handleReaction('like')}
                tone="steel"
              />
              <ReactionButton
                label="GG"
                icon={<Sparkles size={15} />}
                count={reactions.gg || 0}
                active={userReactions.has('gg')}
                onClick={() => handleReaction('gg')}
                tone="success"
              />
              <ReactionButton
                label="Hype"
                icon={<Zap size={15} />}
                count={reactions.hype || 0}
                active={userReactions.has('hype')}
                onClick={() => handleReaction('hype')}
                tone="amber"
              />
              <ReactionButton
                label="Fire"
                icon={<Flame size={15} />}
                count={reactions.fire || 0}
                active={userReactions.has('fire')}
                onClick={() => handleReaction('fire')}
                tone="error"
              />
              <ReactionButton
                label="Mind Blown"
                icon={<Brain size={15} />}
                count={reactions.mind_blown || 0}
                active={userReactions.has('mind_blown')}
                onClick={() => handleReaction('mind_blown')}
                tone="warning"
              />
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-5">
              <a href="#comments" className="ui-btn br-ghost ui-btn-sm">
                <MessageSquare size={15} />
                <span>{comments.length} komentara</span>
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleBookmark}
                  className={`ui-icon-btn ${bookmarked ? '!border-cyan-400/40 !bg-cyan-500/10 !text-cyan-300' : ''}`}
                  title={bookmarked ? 'Sačuvano' : 'Sačuvaj'}
                  aria-label={bookmarked ? 'Ukloni članak iz sačuvanih' : 'Sačuvaj članak'}
                  aria-pressed={bookmarked}
                >
                  <Bookmark size={17} fill={bookmarked ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    alert('Link je kopiran u clipboard!');
                  }}
                  className="ui-icon-btn"
                  title="Podeli"
                  aria-label="Podeli članak"
                >
                  <Share2 size={17} />
                </button>
              </div>
            </div>
          </section>
        </article>

        {/* Comments Section */}
        <section className="mt-14" id="comments">
          <div className="mb-6 flex items-center gap-2.5 border-b border-white/[0.07] pb-4">
            <MessageSquare size={16} className="text-white/35" aria-hidden="true" />
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-white">
              Komentari <span className="font-mono text-sm font-normal text-white/40">{comments.length}</span>
            </h2>
          </div>

          {/* Add comment form */}
          <form onSubmit={handleAddComment} className="mb-6 rounded-2xl border border-white/[0.08] bg-[#0D101D]/75 p-4 backdrop-blur-md">
            <textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder={currentUser ? `Ostavi komentar kao ${currentUser.username}...` : 'Prijavite se ili ostavite komentar kao gost...'}
              className="ui-field mb-3 resize-none"
              rows={3}
              aria-label="Novi komentar"
            />
            <div className="flex justify-end">
              <button type="submit" className="ui-btn br-primary ui-btn-sm">
                <Send size={15} />
                Objavi komentar
              </button>
            </div>
          </form>

          {/* Comments list */}
          <div className="space-y-3">
            {commentsLoading ? (
              <SkeletonRows rows={2} />
            ) : comments.length === 0 ? (
              <div className="ui-state-box !py-10">
                <span className="ui-state-icon" aria-hidden="true">
                  <MessageSquare size={22} />
                </span>
                <h3 className="ui-state-title">Još nema komentara</h3>
                <p className="ui-state-text">Budi prvi koji će podeliti mišljenje o ovoj objavi.</p>
              </div>
            ) : (
              comments.map((com) => (
                <div key={com.id} className="flex items-start gap-3.5 rounded-2xl border border-white/[0.07] bg-[#0D101D]/70 p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-[0_12px_30px_-10px_rgba(6,182,212,0.25)]">
                  <img
                    src={com.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(com.author || 'user')}`}
                    alt=""
                    className="h-9 w-9 flex-shrink-0 rounded-full border border-white/15 bg-surface-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-white">
                        {com.author}
                        <VerifiedBadge isVerified={com.authorVerified} size="xs" />
                      </span>
                      <span className="meta-time text-[11px]">
                        {com.createdAt ? new Date(com.createdAt).toLocaleString('sr-Latn-RS') : 'Nedavno'}
                      </span>
                    </div>
                    <CommentBody html={com.content ?? ''} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * CMS sadržaj ponekad stiže kao plain-text sa Markdown oznakama (##, **bold**, liste).
 * Takav tekst se priprema za prikaz pre DOMPurify sanitizacije; pravi HTML iz
 * editora ostaje netaknut. Bez ove pripreme bi "##" i "**" ostali vidljivi.
 */
function markdownToHtml(raw: string): string {
  if (!raw || /<\/?[a-z][^>]*>/i.test(raw)) return raw;

  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (value: string) =>
    value
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');

  const blocks: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length) {
      blocks.push(`<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
      list = [];
    }
  };

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushList();
      const level = Math.min(3, Math.max(2, trimmed.match(/^#+/)?.[0].length ?? 2));
      blocks.push(`<h${level}>${inline(escape(trimmed.replace(/^#{1,6}\s+/, '')))}</h${level}>`);
      return;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      list.push(inline(escape(trimmed.replace(/^[-*]\s+/, ''))));
      return;
    }
    flushList();
    blocks.push(`<p>${inline(trimmed)}</p>`);
  });
  flushList();

  return blocks.join('');
}

function CommentBody({ html }: { html: string }) {
  // Komentari su rich text (sanitizovani na serveru) — DOMPurify je druga linija odbrane.
  const safe = useSanitizedHtml(html);
  return (
    <div
      className="article-rich-content break-words text-[13.5px] leading-relaxed text-white/70"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

// Aktivna reakcija = cyan/violet neon pilula sa suptilnim sjajem.
const REACTION_TONES = {
  steel: { idle: 'text-slate-500', active: 'border-violet-400/50 bg-violet-500/15 text-violet-200 shadow-[0_0_16px_-4px_rgba(124,58,237,0.7)]' },
  success: { idle: 'text-slate-500', active: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200 shadow-[0_0_16px_-4px_rgba(6,182,212,0.7)]' },
  amber: { idle: 'text-slate-500', active: 'border-violet-400/50 bg-violet-500/15 text-violet-200 shadow-[0_0_16px_-4px_rgba(124,58,237,0.7)]' },
  warning: { idle: 'text-slate-500', active: 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200 shadow-[0_0_16px_-4px_rgba(6,182,212,0.7)]' },
  error: { idle: 'text-slate-500', active: 'border-rose-400/50 bg-rose-500/15 text-rose-200 shadow-[0_0_16px_-4px_rgba(244,63,94,0.7)]' },
} as const;

function ReactionButton({
  label,
  icon,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  tone: keyof typeof REACTION_TONES;
}) {
  const styles = REACTION_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`reaction-btn inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium backdrop-blur-sm ${
        active
          ? styles.active
          : 'border-violet-500/20 bg-[#0D101D]/80 text-slate-300 hover:border-cyan-500/40 hover:bg-cyan-500/[0.08] hover:text-white'
      }`}
    >
      <span className={active ? 'drop-shadow-[0_0_6px_rgba(124,58,237,0.6)]' : styles.idle}>{icon}</span>
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums ${
          active ? 'bg-white/10 text-current' : 'bg-white/[0.04] text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  );
}
