import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, Bell, Bookmark, CheckCircle2, Lock, Mail, MessageSquare, Pencil, Pin, Reply, Send, Share2,
  ShieldAlert, Trash2, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, type PollResult } from '../lib/api';
import { DraftRecoveryBanner, DraftStatusIndicator, useFormDraft } from '../lib/useFormDraft.tsx';
import { useSanitizedHtml } from '../lib/sanitizeHtml';
import { embedifyHtml, hasEmbeds } from '../lib/embedify';
import { MediaEmbed } from '../components/MediaEmbed';
import { useAuthStore } from '../store/authStore';
import PollWidget from '../components/forum/PollWidget';
import { ReportButton } from '../components/ReportButton';
import { RoleEmblem } from '../components/profile/RoleEmblem';
import { Badge, Button, EmptyState, ErrorState, OnlineAvatar, SkeletonRows } from '../components/ui';
import { VerifiedBadge } from '../components/ui/VerifiedBadge';
import { RichContentWithLightbox } from '../components/ui/ImageLightbox';

interface Comment {
  id: string;
  author: string;
  authorId?: string;
  authorRole?: string | null;
  authorLevel?: number | null;
  /** Autor je potvrdio email (značka pored imena). */
  authorVerified?: boolean;
  /** 2.6.1 — server već zna da je autor „online sada“. */
  authorOnline?: boolean;
  avatar?: string;
  content: string;
  karma: number;
  isSpoiler?: boolean;
  createdAt: string;
  /** F-EDIT — `(izmenjeno)` oznaka; server je postavlja pri PUT thread/reply. */
  isEdited?: boolean;
  /**
   * 2.11.0 — ovaj odgovor je prihvaćeno rešenje teme.
   * Server ga šalje kao `acceptedReplyId` na TEMI; `ThreadPage` ga propagira dole.
   */
  isAccepted?: boolean;
  replies?: Comment[];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; thread: any; replies: Comment[]; poll: PollResult | null }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

function isNotFound(message: string) {
  return /nije pronađena|not found|404/i.test(message);
}

/**
 * F-EDIT — helperi za inline edit
 * ------------------------------
 * Server cuva sanitizovani HTML, a edit forma je obican textarea. Ova dva cista
 * helpera moste HTML <-> cist tekst:
 *  - `htmlToPlainText` — DOM parser (browser ga vec ima) — bez regex fragilnosti;
 *  - `textToParagraphHtml` — svaki neprazan red -> `<p>...</p>`. Server sanitizuje
 *    kroz `sanitizeRichText`, pa je opasni HTML svejedno odbijen (odbrana u dubini).
 */
export function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  // `<p>`/`<br>` prelaze u nove redove da tekst ne ostaje „slepljen“.
  div.querySelectorAll('p, br, li, blockquote').forEach((el) => el.insertAdjacentText('afterend', '\n'));
  return (div.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function textToParagraphHtml(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('');
}

function buildCommentTree(rawReplies: any[]): Comment[] {
  const map: Record<string, Comment> = {};
  const roots: Comment[] = [];

  rawReplies.forEach((r) => {
    map[r.id] = {
      id: r.id,
      author: r.author || 'Korisnik',
      authorId: r.authorId,
      authorRole: r.authorRole ?? null,
      authorLevel: r.authorLevel ?? null,
      authorVerified: r.authorVerified === true,
      authorOnline: r.authorOnline === true,
      avatar: r.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.author || 'User'}`,
      content: r.content,
      karma: r.karma || 0,
      isSpoiler: r.isSpoiler,
      isEdited: r.isEdited === true,
      createdAt: r.createdAt ? new Date(r.createdAt).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' }) : 'Upravo',
      replies: [],
    };
  });

  rawReplies.forEach((r) => {
    if (r.parentId && map[r.parentId]) {
      map[r.parentId].replies?.push(map[r.id]);
    } else {
      roots.push(map[r.id]);
    }
  });

  return roots;
}

function CommentItem({
  comment,
  depth = 0,
  canModerate,
  onReplySubmitted,
  onVote,
  onDelete,
  onEdited,
  canAccept,
  onAccept,
}: {
  comment: Comment;
  depth?: number;
  canModerate: boolean;
  onReplySubmitted: (parentId: string, text: string) => Promise<void>;
  onVote: (id: string, dir: 'up' | 'down' | null) => Promise<number | null>;
  onDelete: (id: string) => void;
  /** F-EDIT — poziva se posle uspešnog čuvanja (roditelj refetchuje). */
  onEdited?: () => Promise<void>;
  /** 2.11.0 — da li ulogovani korisnik SME da označi rešenje (autor teme ili staff). */
  canAccept?: boolean;
  /** 2.11.0 — `replyId` za prihvatanje, `'none'` za odznačavanje. */
  onAccept?: (replyId: string | 'none') => Promise<void>;
}) {
  const currentUser = useAuthStore((s) => s.user);
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [pending, setPending] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [revealed, setRevealed] = useState(!comment.isSpoiler);

  // F-EDIT — inline izmena sopstvenog odgovora (server postavlja isEdited).
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isOwn = Boolean(currentUser && comment.authorId && currentUser.id === comment.authorId);
  const safeContent = useSanitizedHtml(comment.content ?? '');

  const handleVote = async (dir: 'up' | 'down') => {
    if (pending) return;
    const next = voted === dir ? null : dir;
    // Server vraća tačnu karmu (uključujući promenu glasa). Ranije se glas
    // gubio bez poruke — sada greška vraća prethodno stanje i toast.
    setPending(true);
    const serverKarma = await onVote(comment.id, next);
    setPending(false);
    if (serverKarma !== null) setVoted(next);
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    await onReplySubmitted(comment.id, replyText.trim());
    setReplyText('');
    setShowReply(false);
  };

  /** F-EDIT — otvara edit formu sa ČISTIM tekstom (content je sanitizovani HTML). */
  const startEdit = () => {
    setEditText(htmlToPlainText(comment.content ?? ''));
    setEditing(true);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditText('');
  };

  const saveEdit = async () => {
    const text = editText.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await api.forum.updateReply(comment.id, { content: textToParagraphHtml(text) });
      toast.success('Odgovor je izmenjen.');
      setEditing(false);
      setEditText('');
      await onEdited?.();
    } catch (error: any) {
      toast.error(error?.message || 'Izmena nije uspela. Pokusaj ponovo.');
    } finally {
      setSaving(false);
    }
  };

  /** Escape otkazuje, Ctrl/Cmd+Enter cuva. */
  const onEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveEdit();
    }
  };

  return (
    <div className={depth > 0 ? 'nx-nested-reply ml-3 mt-3 border-l-2 border-white/[0.08] pl-3 sm:ml-6 sm:pl-5' : ''}>
      <div className="flex gap-3">
        {/* Vote column */}
        <div className="vote-box h-fit flex-shrink-0">
          <button
            type="button"
            onClick={() => handleVote('up')}
            aria-label="Glasaj za odgovor"
            aria-pressed={voted === 'up'}
            disabled={pending}
            className={`vote-btn ${voted === 'up' ? 'is-up' : ''}`}
          >
            <ArrowUp size={15} />
          </button>
          <span
            className={`vote-count ${
              voted === 'up'
                ? '!text-cyan-400'
                : voted === 'down'
                  ? '!text-rose-400'
                  : ''
            }`}
          >
            {comment.karma}
          </span>
          <button
            type="button"
            onClick={() => handleVote('down')}
            aria-label="Glasaj protiv odgovora"
            aria-pressed={voted === 'down'}
            disabled={pending}
            className={`vote-btn ${voted === 'down' ? 'is-down' : ''}`}
          >
            <ArrowDown size={15} />
          </button>
        </div>

        {/* Comment content */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/* 2.6.1 — zeleni prsten za autore koji su „online sada“ */}
            <OnlineAvatar src={comment.avatar} userId={comment.authorId} isOnline={comment.authorOnline} size="xs" alt="" />
            <span className="text-[13px] font-semibold text-white">{comment.author}</span>
            <VerifiedBadge isVerified={comment.authorVerified} size="xs" />
            <RoleEmblem role={comment.authorRole} />
            {comment.authorLevel ? (
              <Badge tone="neutral" className="!normal-case font-mono !text-[11px] !font-medium">
                LVL {comment.authorLevel}
              </Badge>
            ) : null}
            <span className="meta-time">{comment.createdAt}</span>
            {comment.isEdited && (
              <Badge tone="neutral" className="!normal-case !text-[11px]">
                izmenjeno
              </Badge>
            )}
            {comment.isSpoiler && (
              <Badge tone="error">
                <ShieldAlert size={11} /> Spoiler
              </Badge>
            )}
          </div>

          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveEdit();
              }}
              className="mb-2 animate-fade-in rounded-xl border border-cyan-400/30 bg-surface-2/80 p-3 backdrop-blur-sm"
            >
              <textarea
                ref={editRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={onEditKeyDown}
                className="ui-field resize-none !text-[13px]"
                rows={Math.min(10, Math.max(3, editText.split('\n').length + 1))}
                aria-label="Izmena odgovora"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="hidden font-mono text-[10px] uppercase tracking-[0.08em] text-white/35 sm:inline">
                  Ctrl+Enter → sačuvaj · Esc → odustani
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={cancelEdit} className="ui-btn br-ghost ui-btn-sm" disabled={saving}>
                    <X size={13} /> Otkaži
                  </button>
                  <button type="submit" className="ui-btn br-primary ui-btn-sm" disabled={saving || !editText.trim()}>
                    <Send size={13} />
                    {saving ? 'Čuvanje…' : 'Sačuvaj izmene'}
                  </button>
                </div>
              </div>
            </form>
          ) : comment.isSpoiler && !revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mb-2 inline-flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.07] px-3 py-2 text-xs font-medium text-rose-300 transition hover:bg-rose-500/[0.12] hover:border-rose-400/50"
            >
              <ShieldAlert size={14} aria-hidden="true" />
              Klikni da otkriješ spojler
            </button>
          ) : (
            <div
              className="article-rich-content mb-2 break-words text-sm leading-relaxed text-white/80"
              dangerouslySetInnerHTML={{ __html: safeContent }}
            />
          )}

          <div className="flex items-center gap-1 text-xs text-white/45">
            <button
              type="button"
              onClick={() => setShowReply(!showReply)}
              className="flex min-h-[32px] items-center gap-1.5 rounded px-1.5 transition hover:bg-white/[0.05] hover:text-white"
            >
              <Reply size={14} />
              Odgovori
            </button>
            {(canModerate || isOwn) && (
              <button
                type="button"
                onClick={() => onDelete(comment.id)}
                className="flex min-h-[32px] items-center gap-1.5 rounded px-1.5 transition hover:bg-rose-500/10 hover:text-rose-400"
              >
                <Trash2 size={13} />
                Obriši
              </button>
            )}
            {(canModerate || isOwn) && !editing && (
              <button
                type="button"
                onClick={startEdit}
                className="flex min-h-[32px] items-center gap-1.5 rounded px-1.5 transition hover:bg-cyan-500/10 hover:text-cyan-300"
              >
                <Pencil size={13} />
                Izmeni
              </button>
            )}
            {/* 2.11.0 — „Prihvati kao rešenje“. Vidi ga samo autor teme (ili staff)
                i to na odgovoru koji nije njegov — sopstveni odgovor nije „rešenje“. */}
            {canAccept && !isOwn && onAccept && !editing && (
              comment.isAccepted ? (
                <button
                  type="button"
                  onClick={() => void onAccept('none')}
                  className="flex min-h-[32px] items-center gap-1.5 rounded px-1.5 font-medium text-[var(--color-success)] transition hover:bg-[var(--color-success)]/10"
                  title="Ukloni oznaku rešenja"
                >
                  <CheckCircle2 size={13} />
                  Rešenje
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onAccept(comment.id)}
                  className="flex min-h-[32px] items-center gap-1.5 rounded px-1.5 transition hover:bg-[var(--color-success)]/10 hover:text-[var(--color-success)]"
                >
                  <CheckCircle2 size={13} />
                  Prihvati kao rešenje
                </button>
              )
            )}
            <ReportButton targetType="reply" targetId={comment.id} label="Prijavi" />
          </div>

          {/* Reply input */}
          {showReply && (
            <form onSubmit={submitReply} className="mt-3 animate-fade-in rounded-xl border border-white/[0.09] bg-surface-2/80 p-3 backdrop-blur-sm">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Odgovori korisniku @${comment.author}...`}
                className="ui-field resize-none !text-[13px]"
                rows={2}
                autoFocus
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReply(false)}
                  className="ui-btn br-ghost ui-btn-sm"
                >
                  Otkaži
                </button>
                <button type="submit" className="ui-btn br-primary ui-btn-sm">
                  Pošalji odgovor
                </button>
              </div>
            </form>
          )}

          {/* Nested replies */}
          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3 space-y-3">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  depth={depth + 1}
                  canModerate={canModerate}
                  onReplySubmitted={onReplySubmitted}
                  onVote={onVote}
                  onDelete={onDelete}
                  onEdited={onEdited}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { usePageMeta, discussionJsonLd } from '../lib/pageMeta';

export default function ThreadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [karma, setKarma] = useState(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [following, setFollowing] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentSpoiler, setNewCommentSpoiler] = useState(false);
  const [moderating, setModerating] = useState(false);

  // F-EDIT2 — autosave drafta odgovora (po temi; različite teme ne gaze jedne druge).
  const replyDraft = useFormDraft(
    `nexus_forum_draft_reply_${id ?? 'unknown'}`,
    { content: newCommentText, isSpoiler: newCommentSpoiler },
    (draft) => {
      setNewCommentText(String(draft.content ?? ''));
      setNewCommentSpoiler(Boolean(draft.isSpoiler));
    },
  );

  // F-EDIT — inline izmena teme (naslov + sadržaj); dugme vidi autor ili moderacija.
  const [editingThread, setEditingThread] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [savingThread, setSavingThread] = useState(false);

  const thread = state.status === 'ready' ? state.thread : null;
  const canModerate = currentUser?.role === 'admin' || currentUser?.role === 'moderator';
  const acceptedId: string | null =
    state.status === 'ready' ? ((state.thread as any).acceptedReplyId ?? null) : null;
  /** F-EDIT — dugme „Izmeni“ vidi autor teme ili moderacija (server dozvoljava isto). */
  const isOwnThread = Boolean(currentUser && thread?.authorId && currentUser.id === thread.authorId);
  /** 2.11.0 — „Prihvati kao rešenje“: autor teme ili staff (server proverava isto). */
  const canAccept = isOwnThread || canModerate;

  // F-19 — meta za deljenje i indeksaciju teme (obrisana tema ostaje noindex).
  usePageMeta({
    title: thread?.title ?? (state.status === 'not_found' ? 'Tema nije pronađena' : 'Forum'),
    description: thread
      ? `${thread.title} — diskusija u ${thread.subforum} na NEXUS forumu. ${String(thread.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 140)}`
      : undefined,
    path: id ? `/thread/${id}` : '/forum',
    type: 'article',
    publishedTime: thread?.createdAt,
    jsonLd: thread && id
      ? discussionJsonLd({
          headline: thread.title,
          text: String(thread.content ?? '').replace(/<[^>]+>/g, ' '),
          url: `${window.location.origin}/thread/${id}`,
          datePublished: thread.createdAt,
          author: thread.author,
          comments: Number(thread.replies) || undefined,
        })
      : undefined,
    noIndex: !thread || thread.isDeleted,
  });

  const loadThread = async () => {
    if (!id) {
      setState({ status: 'not_found' });
      return;
    }
    try {
      const res = await api.forum.getThread(id);
      if (!res.thread) {
        setState({ status: 'not_found' });
        return;
      }
      setKarma(Number(res.thread.karma) || 0);
      // 2.11.0 — server daje `acceptedReplyId` na temi; spuštamo oznaku do kartice.
      const acceptedId = (res.thread as any).acceptedReplyId ?? null;
      setState({
        status: 'ready',
        thread: res.thread,
        replies: markAccepted(buildCommentTree(res.replies ?? []), acceptedId),
        poll: res.poll ?? null,
      });
    } catch (error: any) {
      const message = error?.message || 'Tema nije moguće učitati.';
      // Mrežna greška NIJE "tema ne postoji": ranije je svaka greška
      // prikazivala "Tema nije pronađena" uz lažni fallback sadržaj.
      setState(isNotFound(message) ? { status: 'not_found' } : { status: 'error', message });
    }
  };

  useEffect(() => {
    setState({ status: 'loading' });
    setVoted(null);
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Stvarno stanje praćenja sa servera (thread_subscriptions)
  useEffect(() => {
    if (!id || !currentUser) return;
    api.forum
      .isFollowingThread(id)
      .then((res) => setFollowing(Boolean(res.following)))
      .catch(() => setFollowing(false));

    // Stari mejlovi su vodili na `?unfollow=1` (gasi mejl za temu). Mejl o
    // odgovorima više ne postoji, pa link samo skloni parametar i objasni stanje.
    if (new URLSearchParams(window.location.search).get('unfollow') === '1') {
      const url = new URL(window.location.href);
      url.searchParams.delete('unfollow');
      window.history.replaceState({}, '', url.toString());
      toast.info('Mejl o novim odgovorima se više ne šalje — notifikacije stižu u aplikaciji.');
    }
  }, [id, currentUser]);

  const handleThreadVote = async (dir: 'up' | 'down') => {
    if (!thread) return;
    if (!currentUser) {
      toast.error('Prijavi se da bi glasao.');
      return;
    }
    const next = voted === dir ? null : dir;
    const previous = voted;
    setVoted(next);
    try {
      const result = await api.forum.voteThread(thread.id, next);
      setKarma(result.karma);
    } catch (error: any) {
      setVoted(previous);
      toast.error(error?.message || 'Glas nije zabeležen. Pokušaj ponovo.');
    }
  };

  const handleReplyVote = async (replyId: string, dir: 'up' | 'down' | null) => {
    if (!currentUser) {
      toast.error('Prijavi se da bi glasao.');
      return null;
    }
    try {
      const result = await api.forum.voteReply(replyId, dir);
      return result.karma;
    } catch (error: any) {
      toast.error(error?.message || 'Glas nije zabeležen. Pokušaj ponovo.');
      return null;
    }
  };

  const handlePostTopComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !thread?.id) return;
    if (!currentUser) {
      toast.error('Prijavi se da bi odgovorio.');
      return;
    }
    try {
      await api.forum.createReply(thread.id, {
        content: newCommentText.trim(),
        parentId: null,
        isSpoiler: newCommentSpoiler,
      });
      setNewCommentText('');
      setNewCommentSpoiler(false);
      replyDraft.clear(); // F-EDIT2 — draft se briše TEK po uspešnom slanju odgovora.
      await loadThread();
    } catch (err: any) {
      toast.error(err?.message || 'Greška pri objavljivanju odgovora.');
    }
  };

  const handleNestedReply = async (parentId: string, text: string) => {
    if (!thread?.id) return;
    try {
      await api.forum.createReply(thread.id, { content: text, parentId });
      await loadThread();
    } catch (err: any) {
      toast.error(err?.message || 'Greška pri slanju odgovora.');
    }
  };

  const handleDeleteReply = async (replyId: string) => {
    if (!window.confirm('Obrisati ovaj odgovor?')) return;
    try {
      await api.forum.deleteReply(replyId);
      toast.success('Odgovor je obrisan.');
      await loadThread();
    } catch (err: any) {
      toast.error(err?.message || 'Brisanje nije uspelo.');
    }
  };

  /**
   * 2.11.0 — označi/odznači prihvaćen odgovor. Server je izvor istine: posle
   * akcije se tema ponovo učitava da se vidi tačno stanje (i eventualna greška
   * je već vraćena sa porukom, pa je toast dovoljan).
   */
  const handleAccept = async (replyId: string | 'none') => {
    if (!thread) return;
    try {
      const result = await api.forum.acceptAnswer(thread.id, replyId);
      toast.success(
        replyId === 'none'
          ? 'Oznaka rešenja je uklonjena.'
          : result.awardedXp
            ? `Odgovor je prihvaćen. Autor dobija ${result.awardedXp} XP.`
            : 'Odgovor je označen kao rešenje.',
      );
      await loadThread();
    } catch (err: any) {
      toast.error(err?.message || 'Označavanje rešenja nije uspelo.');
    }
  };

  const handleModerate = async (
    payload: { isPinned?: boolean; isLocked?: boolean; deleteThread?: boolean },
    message: string,
  ) => {
    if (!thread) return;
    setModerating(true);
    try {
      await api.forum.moderate(thread.id, payload);
      toast.success(message);
      if (payload.deleteThread) navigate('/forum');
      else await loadThread();
    } catch (err: any) {
      toast.error(err?.message || 'Moderacija nije uspela.');
    } finally {
      setModerating(false);
    }
  };

  /** F-EDIT — čuvanje izmene teme preko postojećeg api.forum.updateThread. */
  const saveThreadEdit = async () => {
    if (!thread || savingThread) return;
    const title = editTitle.trim();
    const content = editContent.trim();
    if (!title || !content) return;
    setSavingThread(true);
    try {
      await api.forum.updateThread(thread.id, { title, content: textToParagraphHtml(content) });
      toast.success('Tema je izmenjena.');
      setEditingThread(false);
      await loadThread();
    } catch (error: any) {
      toast.error(error?.message || 'Izmena teme nije uspela. Pokusaj ponovo.');
    } finally {
      setSavingThread(false);
    }
  };

  const startThreadEdit = () => {
    setEditTitle(thread.title);
    setEditContent(htmlToPlainText(thread.content ?? ''));
    setEditingThread(true);
  };

  /** Escape otkazuje, Ctrl/Cmd+Enter cuva. */
  const onThreadEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditingThread(false);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveThreadEdit();
    }
  };

  if (state.status === 'loading') {
    return (
      <div className="section">
        <div className="container max-w-4xl" aria-busy="true">
          <span className="sr-only">Učitavanje teme…</span>
          <div className="ui-skeleton mb-6 h-4 w-48" />
          <div className="ui-skeleton mb-8 h-52 w-full rounded-lg" />
          <SkeletonRows rows={3} />
        </div>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="section">
        <div className="container max-w-4xl">
          <EmptyState
            icon={<ShieldAlert size={22} />}
            title="Tema nije pronađena"
            message="Tema je obrisana ili link nije tačan."
            action={
              <Link to="/forum" className="ui-btn br-primary ui-btn-sm">
                Nazad na forum
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="section">
        <div className="container max-w-4xl">
          <ErrorState
            title="Tema trenutno nije dostupna"
            message={state.message}
            onRetry={() => {
              setState({ status: 'loading' });
              loadThread();
            }}
          />
        </div>
      </div>
    );
  }

  const { replies, poll } = state;
  const isLocked = Boolean(thread.isLocked);

  return (
    <div className="section">
      <div className="container max-w-4xl">
        {/* Breadcrumb */}
        <nav className="crumbs mb-6" aria-label="Putanja">
          <Link to="/forum">Forum</Link>
          <span className="sep" aria-hidden="true">/</span>
          <Link to={`/forum/${thread.subforum}`} className="font-mono text-[11px] uppercase tracking-[0.08em]">
            {thread.subforum}
          </Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="truncate text-white/70">{thread.title}</span>
        </nav>

        {thread.isDeleted && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-300" role="status">
            <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            Ova tema je obrisana. Vidljiva je samo autoru i moderatorima radi revizije.
          </div>
        )}

        {/* Thread Box */}
        <article className="mb-8 rounded-2xl border border-white/[0.08] bg-[#0D101D]/75 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md sm:p-7">
          <div className="flex gap-3 sm:gap-5">
            {/* Vote */}
            <div className="vote-box h-fit flex-shrink-0">
              <button
                type="button"
                onClick={() => handleThreadVote('up')}
                className={`vote-btn !h-9 !w-9 ${voted === 'up' ? 'is-up' : ''}`}
                title="Upvote"
                aria-pressed={voted === 'up'}
              >
                <ArrowUp size={18} />
              </button>
              <span className="vote-count !py-1 font-display !text-lg">{karma}</span>
              <button
                type="button"
                onClick={() => handleThreadVote('down')}
                className={`vote-btn !h-9 !w-9 ${voted === 'down' ? 'is-down' : ''}`}
                title="Downvote"
                aria-pressed={voted === 'down'}
              >
                <ArrowDown size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {editingThread ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveThreadEdit();
                  }}
                  className="mb-4 space-y-3 animate-fade-in"
                >
                  <div>
                    <label htmlFor="edit-thread-title" className="mb-1 block text-sm font-semibold text-white/85">
                      Naslov teme
                    </label>
                    <input
                      id="edit-thread-title"
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      maxLength={300}
                      className="ui-field"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-thread-content" className="mb-1 block text-sm font-semibold text-white/85">
                      Sadržaj
                    </label>
                    <textarea
                      id="edit-thread-content"
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={onThreadEditKeyDown}
                      className="ui-field resize-none"
                      rows={Math.min(16, Math.max(6, editContent.split('\n').length + 2))}
                      aria-label="Izmena sadržaja teme"
                      required
                    />
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-white/35">
                      Ctrl+Enter → sačuvaj · Esc → odustani
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingThread(false)}
                      className="ui-btn br-ghost ui-btn-sm"
                      disabled={savingThread}
                    >
                      <X size={13} /> Otkaži
                    </button>
                    <button
                      type="submit"
                      className="ui-btn br-primary ui-btn-sm"
                      disabled={savingThread || !editTitle.trim() || !editContent.trim()}
                    >
                      <Send size={13} />
                      {savingThread ? 'Čuvanje…' : 'Sačuvaj izmene'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <h1 className="font-display text-[1.625rem] font-semibold leading-[1.15] tracking-[-0.025em] text-white sm:text-3xl">
                      {thread.title}
                      {/* 6.x — isto kao u listi foruma: rešena tema je odmah prepoznatljiva. */}
                      {acceptedId && (
                        <span className="ml-2 inline-flex translate-y-[-2px] items-center gap-1 rounded-full border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 px-2 py-0.5 align-middle font-mono text-[11px] font-medium uppercase tracking-wide text-[var(--color-success)]">
                          <CheckCircle2 size={11} aria-hidden="true" /> Rešeno
                        </span>
                      )}
                    </h1>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {thread.isPinned && (
                        <Badge tone="warning">
                          <Pin size={11} /> Fiksirano
                        </Badge>
                      )}
                      {isLocked && (
                        <Badge tone="error">
                          <Lock size={11} /> Zaključano
                        </Badge>
                      )}
                      {thread.isEdited && (
                        <Badge tone="neutral" className="!normal-case !text-[11px]">
                          izmenjeno
                        </Badge>
                      )}
                    </div>
                  </div>
                </>
              )}

              {Array.isArray(thread.tags) && thread.tags.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  {thread.tags.map((tag: string) => (
                    <Link
                      key={tag}
                      to={`/forum?search=${encodeURIComponent(tag)}`}
                      className="rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-200 transition hover:border-cyan-400/50 hover:bg-cyan-500/10 hover:text-cyan-200"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}

              {editingThread ? null : <ThreadBody content={thread.content} />}

              {/* Interaktivna anketa (ako tema ima poll) */}
              {poll && <PollWidget threadId={thread.id} poll={poll} />}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                <div className="flex items-center gap-3">
                  <OnlineAvatar
                    src={thread.authorAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.author}`}
                    userId={thread.authorId}
                    isOnline={thread.authorOnline}
                    status={thread.authorStatus}
                    size="md"
                    alt=""
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Link to={`/profile/${thread.author}`} className="text-white transition hover:text-[var(--color-primary-hover)]">
                        {thread.author}
                      </Link>
                      <VerifiedBadge isVerified={thread.authorVerified} size="sm" />
                      <RoleEmblem role={thread.authorRole} />
                      {thread.authorLevel ? (
                        <Badge tone="neutral" className="!normal-case font-mono !text-[11px] !font-medium">
                          LVL {thread.authorLevel}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="meta-row mt-1">
                      <span>{thread.createdAt ? new Date(thread.createdAt).toLocaleDateString('sr-Latn-RS') : 'Danas'}</span>
                      <span>{(thread.views || 0).toLocaleString()} pregleda</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {currentUser && (
                    <button
                      type="button"
                      onClick={async () => {
                        const next = !following;
                        setFollowing(next);
                        try {
                          if (next) await api.forum.followThread(thread.id);
                          else await api.forum.unfollowThread(thread.id);
                          toast.success(
                            next
                              ? 'Pratite temu — dobijate notifikacije o odgovorima.'
                              : 'Više ne pratite temu.',
                          );
                        } catch (error: any) {
                          setFollowing(!next);
                          toast.error(error?.message || 'Praćenje teme nije uspelo.');
                        }
                      }}
                      className={`ui-btn ui-btn-sm ${following ? 'br-secondary !border-cyan-400/40 !text-cyan-300 !bg-cyan-500/10' : 'br-ghost'}`}
                      aria-pressed={following}
                    >
                      <Bell size={14} fill={following ? 'currentColor' : 'none'} />
                      <span className="hidden sm:inline">{following ? 'Pratite' : 'Prati temu'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(window.location.href);
                        toast.success('Link teme je kopiran!');
                      } catch {
                        toast.error('Kopiranje linka nije uspelo.');
                      }
                    }}
                    className="ui-icon-btn"
                    aria-label="Kopiraj link teme"
                  >
                    <Share2 size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = !bookmarked;
                      setBookmarked(next);
                      try {
                        if (next) await api.forum.bookmarkThread(thread.id);
                        else await api.forum.unbookmarkThread(thread.id);
                      } catch (error: any) {
                        setBookmarked(!next);
                        toast.error(error?.message || 'Čuvanje teme nije uspelo.');
                      }
                    }}
                    className={`ui-icon-btn ${bookmarked ? '!border-cyan-400/40 !bg-cyan-500/10 !text-cyan-300' : ''}`}
                    title={bookmarked ? 'Sačuvano' : 'Sačuvaj temu'}
                    aria-label={bookmarked ? 'Ukloni temu iz sačuvanih' : 'Sačuvaj temu'}
                    aria-pressed={bookmarked}
                  >
                    <Bookmark size={18} fill={bookmarked ? 'currentColor' : 'none'} />
                  </button>
                  {(isOwnThread || canModerate) && !editingThread && !thread.isDeleted && (
                    <button
                      type="button"
                      onClick={startThreadEdit}
                      className="ui-icon-btn hover:!text-cyan-300"
                      title="Izmeni temu"
                      aria-label="Izmeni temu"
                    >
                      <Pencil size={18} />
                    </button>
                  )}
                  <ReportButton
                    targetType="thread"
                    targetId={thread.id}
                    label=""
                    className="ui-icon-btn hover:!text-rose-400"
                  />
                </div>
              </div>

              {/* Moderatorske akcije — API postoji, dugmad su ranije nedostajala */}
              {canModerate && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.07] p-3">
                  <span className="mr-1 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-cyan-300">Moderacija</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={moderating}
                    leftIcon={<Pin size={14} />}
                    onClick={() =>
                      handleModerate(
                        { isPinned: !thread.isPinned },
                        thread.isPinned ? 'Tema više nije fiksirana.' : 'Tema je fiksirana.',
                      )
                    }
                  >
                    {thread.isPinned ? 'Otkači' : 'Fiksiraj'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={moderating}
                    leftIcon={<Lock size={14} />}
                    onClick={() =>
                      handleModerate(
                        { isLocked: !thread.isLocked },
                        thread.isLocked ? 'Tema je otključana.' : 'Tema je zaključana.',
                      )
                    }
                  >
                    {thread.isLocked ? 'Otključaj' : 'Zaključaj'}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={moderating}
                    leftIcon={<Trash2 size={14} />}
                    onClick={() => {
                      if (window.confirm('Obrisati temu? Tema nestaje sa foruma, ali ostaje u bazi za reviziju.')) {
                        handleModerate({ deleteThread: true }, 'Tema je obrisana.');
                      }
                    }}
                  >
                    Obriši
                  </Button>
                </div>
              )}
            </div>
          </div>
        </article>

        {/* Comments count */}
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-2.5">
            <MessageSquare className="text-[var(--color-primary-fg)]/70" size={16} aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-white">
              Odgovori zajednice{' '}
              <span className="font-mono text-sm font-normal tabular-nums text-[var(--color-text-tertiary)]">
                {countReplies(replies)}
              </span>
            </h2>
          </div>
        </div>

        {/* Add comment box */}
        {isLocked ? (
          <div className="mb-8 flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#0D101D]/75 p-6 text-center text-sm text-slate-400 backdrop-blur-md">
            <Lock size={15} aria-hidden="true" /> Tema je zaključana — novi odgovori nisu mogući.
          </div>
        ) : (
          <form onSubmit={handlePostTopComment} className="mb-8 rounded-2xl border border-white/[0.08] bg-[#0D101D]/75 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md sm:p-5">
            {/* F-EDIT2 — nenametljiv banner za vraćanje nesačuvanog drafta odgovora. */}
            {replyDraft.hasDraft && (
              <DraftRecoveryBanner
                updatedAt={replyDraft.updatedAt}
                isStale={false}
                onRestore={() => replyDraft.restore()}
                onDiscard={() => {
                  replyDraft.clear();
                  setNewCommentText('');
                  setNewCommentSpoiler(false);
                }}
              />
            )}
            <textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              placeholder={
                currentUser
                  ? `Napiši odgovor kao ${currentUser.username}... Koristi @username za pominjanje.`
                  : 'Prijavi se da bi ostavio odgovor.'
              }
              className="ui-field mb-3 resize-none"
              rows={3}
              required
              aria-label="Novi odgovor"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-white/55">
                <input
                  type="checkbox"
                  checked={newCommentSpoiler}
                  onChange={(e) => setNewCommentSpoiler(e.target.checked)}
                  className="h-4 w-4 rounded"
                />
                <span>Označi odgovor kao spoiler</span>
              </label>
              <span className="flex items-center gap-3">
                <DraftStatusIndicator status={replyDraft.status} />
                <button type="submit" className="ui-btn br-primary ui-btn-sm" disabled={!currentUser}>
                  <Send size={15} />
                  Objavi odgovor (+5 XP)
                </button>
              </span>
            </div>
          </form>
        )}

        {/* Comments list */}
        {replies.length === 0 ? (
          <div className="ui-state-box !py-10">
            <span className="ui-state-icon" aria-hidden="true">
              <MessageSquare size={22} />
            </span>
            <h3 className="ui-state-title">Još uvek nema odgovora</h3>
            <p className="ui-state-text">Budi prvi koji će se uključiti u raspravu na ovu temu.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {replies.map((comment) => (
              <div
                key={comment.id}
                className={
                  acceptedId && (comment.id === acceptedId || hasAcceptedDescendant(comment, acceptedId))
                    ? 'rounded-2xl border border-[var(--color-success)]/40 bg-[var(--color-success)]/[0.04] p-4 backdrop-blur-md transition-all duration-300 sm:p-5'
                    : 'rounded-2xl border border-white/[0.07] bg-[#0D101D]/70 p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-500/30 hover:shadow-[0_12px_30px_-10px_rgba(6,182,212,0.25)] sm:p-5'
                }
              >
                <CommentItem
                  comment={comment}
                  canModerate={Boolean(canModerate)}
                  onReplySubmitted={handleNestedReply}
                  onVote={handleReplyVote}
                  onDelete={handleDeleteReply}
                  onEdited={loadThread}
                  canAccept={Boolean(canAccept) && !thread.isLocked}
                  onAccept={handleAccept}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Sadržaj teme: rich editor čuva HTML, pa se prikazuje kroz DOMPurify.
 * Plain tekst (bez tagova) dobija `<br />` umesto sirovih newline-ova.
 * F-LB — klik na sliku u tekstu otvara Lightbox (delegirani klik).
 */
function ThreadBody({ content }: { content?: string }) {
  const raw = content ?? '';
  const looksLikeHtml = /<\/?[a-z][^>]*>/i.test(raw);
  const safe = useSanitizedHtml(raw);
  const html = looksLikeHtml ? safe : `<p>${escapeHtml(raw).replace(/\n/g, '<br />')}</p>`;

  // F-7 — standalone whitelist URL-ovi (YouTube/Spotify/Twitch) u zasebnom
  // redu postaju MediaEmbed; ostalo ostaje sanitizovan HTML/`<a>`.
  return <EmbeddedContent html={html} className="article-rich-content mb-6 break-words text-[15px] leading-[1.7] text-white/80" />;
}

/** RichContentWithLightbox + F-7 embed prepoznavanje (deli html na segmente). */
function EmbeddedContent({ html, className }: { html: string; className?: string }) {
  const segments = embedifyHtml(html);
  if (!hasEmbeds(segments)) {
    return <RichContentWithLightbox html={html} className={className} />;
  }
  return (
    <div className={className}>
      {segments.map((segment, index) =>
        segment.type === 'embed' ? (
          <MediaEmbed key={`embed-${index}`} media={segment.media} />
        ) : (
          <RichContentWithLightbox key={`html-${index}`} html={segment.html} className="" />
        ),
      )}
    </div>
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countReplies(list: Comment[]): number {
  return list.reduce((sum, item) => sum + 1 + (item.replies ? countReplies(item.replies) : 0), 0);
}

/**
 * 2.11.0 — prihvaćen odgovor može biti i ugnježden. Kartica „rešenja“ mora da
 * oboji roditelja da bi se videlo bez skrolovanja do unutrašnjeg odgovora.
 */
function hasAcceptedDescendant(comment: Comment, acceptedId: string | null): boolean {
  if (!acceptedId || !comment.replies) return false;
  return comment.replies.some(
    (reply) => reply.id === acceptedId || hasAcceptedDescendant(reply, acceptedId),
  );
}

/**
 * 2.11.0 — propagira `acceptedReplyId` teme kroz drvo odgovora.
 * Server ga šalje samo na temi, pa se oznaka mora spustiti do konkretne kartice.
 */
function markAccepted(list: Comment[], acceptedId: string | null): Comment[] {
  if (!acceptedId) return list;
  return list.map((comment) => ({
    ...comment,
    isAccepted: comment.id === acceptedId,
    replies: comment.replies ? markAccepted(comment.replies, acceptedId) : comment.replies,
  }));
}
