import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquare, Send, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback';

/**
 * 2.11.0 — privatne poruke (DM). Backend (`/api/dm/*`) je gotov; ovo je UI:
 *
 *   `/messages`            — lista razgovora (partner, poslednja poruka, unread)
 *   `/messages/:id`        — nit razgovora + forma za slanje
 *
 * Nepročitani brojač ide i u zvonce (odvojeni upit `dm.unreadCount` po poll-u).
 * Tuđi razgovor je 404 (server ne odaje postojanje) — pokazujemo ErrorState.
 */

const MAX_LENGTH = 4000;

function initialsOf(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/** Relative vreme bez zavisnosti: „5 min“, „2 h“, „3 d“, inače datum. */
function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'sada';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  return new Date(iso).toLocaleDateString('sr-Latn-RS');
}

export default function MessagesPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="section container min-h-[80vh] py-10" aria-labelledby="messages-title">
      <div className="mb-6 flex items-center gap-3">
        {id && <BackLink />}
        <div>
          <h1 id="messages-title" className="font-display text-2xl font-semibold tracking-[-0.02em] text-white">
            Poruke
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            Privatni razgovori sa članovima zajednice.
          </p>
        </div>
      </div>
      {id ? <ConversationThread conversationId={id} /> : <ConversationList />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/messages" className="ui-btn br-ghost ui-btn-sm" aria-label="Nazad na listu poruka">
      <ArrowLeft size={14} />
    </Link>
  );
}

/* ------------------------- Lista razgovora ------------------------- */

function ConversationList() {
  const { isAuthenticated } = useAuthStore();
  const listQuery = useQuery({ queryKey: ['dm', 'list'], queryFn: () => api.dm.list() });

  if (!isAuthenticated) {
    return (
      <EmptyState
        icon={<MessageSquare size={22} />}
        title="Prijavite se za poruke"
        message="Privatne poruke su dostupne samo prijavljenim članovima."
      />
    );
  }
  if (listQuery.isLoading) return <SkeletonRows rows={4} />;
  if (listQuery.isError) {
    return <ErrorState onRetry={() => listQuery.refetch()} message="Lista poruka nije učitana." />;
  }

  const conversations = listQuery.data?.conversations ?? [];

  return (
    <div className="space-y-4">
      <StartConversation />
      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={22} />}
          title="Još nema razgovora"
          message="Započni razgovor sa korisničkim imenom — poruka stiže uz notifikaciju."
        />
      ) : (
        <ul className="ui-card-static divide-y divide-white/[0.06] p-0">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                to={`/messages/${conversation.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
              >
                <Avatar name={conversation.partnerUsername} src={conversation.partnerAvatar} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-white">
                      {conversation.partnerUsername || 'Nepoznat korisnik'}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                      {timeAgo(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-[var(--color-text-secondary)]">
                    {conversation.lastMessageFromMe ? 'Ti: ' : ''}
                    {conversation.lastMessage ?? '—'}
                  </p>
                </div>
                {conversation.unreadCount > 0 && (
                  <span
                    className="rounded-full bg-cyan-500/20 px-2 py-0.5 font-mono text-[11px] tabular-nums text-cyan-300"
                    aria-label={`${conversation.unreadCount} nepročitanih`}
                  >
                    {conversation.unreadCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Avatar({ name, src }: { name: string; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="size-9 shrink-0 rounded-full border border-white/10 object-cover"
        loading="lazy"
      />
    );
  }
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-2 font-mono text-[11px] text-white/70"
      aria-hidden="true"
    >
      {initialsOf(name || '?')}
    </span>
  );
}

/** Nova poruka: unese se korisničko ime → POST /dm → navigacija na nit. */
function StartConversation() {
  const [username, setUsername] = useState('');
  const navigate = useNavigate();
  const openMutation = useMutation({
    mutationFn: (user: string) => api.dm.open(user),
    onSuccess: (data) => navigate(`/messages/${data.conversation.id}`),
    onError: (error: any) => toast.error(error?.message ?? 'Razgovor nije otvoren.'),
  });

  return (
    <form
      className="ui-card-static flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = username.trim();
        if (trimmed) openMutation.mutate(trimmed);
      }}
    >
      <UserPlus size={16} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />
      <input
        type="text"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Korisničko ime za novu poruku…"
        aria-label="Korisničko ime za novu poruku"
        maxLength={32}
        className="ui-field min-w-40 flex-1"
      />
      <Button type="submit" variant="primary" size="sm" loading={openMutation.isPending}>
        Započni
      </Button>
    </form>
  );
}

/* ------------------------------ Nit ------------------------------ */

function ConversationThread({ conversationId }: { conversationId: string }) {
  const { user } = useAuthStore();
  const threadQuery = useQuery({
    queryKey: ['dm', 'thread', conversationId],
    queryFn: () => api.dm.thread(conversationId),
  });

  if (threadQuery.isLoading) return <SkeletonRows rows={5} />;
  if (threadQuery.isError) {
    return (
      <ErrorState
        onRetry={() => threadQuery.refetch()}
        message="Razgovor nije dostupan — možda ne postoji ili nisi njegov član."
      />
    );
  }

  const { conversation, messages } = threadQuery.data!;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={conversation.partnerUsername} src={conversation.partnerAvatar} />
        <div>
          <Link
            to={`/profile/${conversation.partnerUsername}`}
            className="text-sm font-medium text-white hover:underline"
          >
            {conversation.partnerUsername || 'Nepoznat korisnik'}
          </Link>
          <p className="text-xs text-[var(--color-text-tertiary)]">Privatni razgovor</p>
        </div>
      </div>

      <ul className="ui-card-static space-y-2 p-4" aria-label="Poruke razgovora">
        {messages.length === 0 && (
          <li className="py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            Nema poruka — pošalji prvu dole.
          </li>
        )}
        {messages.map((message) => {
          const mine = message.senderId === user?.id;
          return (
            <li key={message.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={[
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                  mine
                    ? 'bg-cyan-500/15 text-white'
                    : 'border border-white/[0.07] bg-surface-2 text-white/90',
                ].join(' ')}
                title={new Date(message.createdAt).toLocaleString('sr-Latn-RS')}
              >
                {message.content}
                <div className="mt-1 text-right font-mono text-[10px] text-white/40">
                  {timeAgo(message.createdAt)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <SendMessageForm conversationId={conversationId} />
    </div>
  );
}

function SendMessageForm({ conversationId }: { conversationId: string }) {
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendMutation = useMutation({
    mutationFn: (text: string) => api.dm.sendToConversation(conversationId, text),
    onSuccess: () => {
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['dm', 'thread', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['dm', 'list'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Poruka nije poslata.'),
  });

  // Nova poruka → skrol na dno nita.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sendMutation.data]);

  return (
    <>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = content.trim();
          if (trimmed) sendMutation.mutate(trimmed);
        }}
      >
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            // Enter šalje, Shift+Nova linija (isto ponašanje kao chat UI).
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              const trimmed = content.trim();
              if (trimmed) sendMutation.mutate(trimmed);
            }
          }}
          rows={2}
          maxLength={MAX_LENGTH}
          aria-label="Nova poruka"
          placeholder="Napiši poruku… (Enter šalje, Shift+Enter novi red)"
          className="ui-field min-h-16 flex-1 resize-y"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={sendMutation.isPending}
          disabled={!content.trim()}
          leftIcon={<Send size={14} aria-hidden="true" />}
        >
          Pošalji
        </Button>
      </form>
      <div ref={bottomRef} />
    </>
  );
}
