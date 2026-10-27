import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  ArrowRight, Bell, Bot, Check, Flame, MessageSquare, Shield, Sparkles, ThumbsUp, Trophy, Trash2, Users, Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { Notification } from '../../contracts/index';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback';

/**
 * U-14 — Notifikacije su grupisane po RAZLOGU povratka, ne po hronologiji.
 *
 * Ranije je stranica bila jedna ravna lista („Vaša aktivnost“), pa se „neko je
  const { isAuthenticated, user } = useAuthStore();
 *
 *   1. Novo (nepročitano, najnovije prvo) — šta se promenilo od poslednje posete,
 *   2. Odgovori tebi (reply / mention / upvote) — socijalni loop,
 *   3. Dostignuća (bedž, kvest) — gamifikacija, ali odvojeno od razgovora,
 *   4. Sistem (administrativne poruke) — nikad u prvom planu.
 *
 * Iznad liste je „dnevni loop“: kvest progres i jedan CTA („Odgovori na temu“),
 * da stranica ima razlog da se otvori svakog dana, a ne samo kada stigne toast.
 */

type GroupKey = 'new' | 'answers' | 'achievements' | 'system';

const GROUP_META: Record<GroupKey, { title: string; hint: string; icon: ReactNode }> = {
  new: { title: 'Novo', hint: 'Od vaše poslednje posete', icon: <Flame size={15} /> },
  answers: { title: 'Odgovori tebi', hint: 'Odgovori, pominjanja i glasovi', icon: <MessageSquare size={15} /> },
  achievements: { title: 'Dostignuća', hint: 'Bedževi i kvestovi', icon: <Trophy size={15} /> },
  system: { title: 'Sistem', hint: 'Obaveštenja administracije', icon: <Bell size={15} /> },
};

const TYPE_ICON: Record<string, ReactNode> = {
  reply: <MessageSquare size={15} />,
  mention: <Sparkles size={15} />,
  upvote: <ThumbsUp size={15} />,
  badge_earned: <Trophy size={15} />,
  quest_completed: <Trophy size={15} />,
  level_up: <Trophy size={15} />,
  system: <Bell size={15} />,
  warning: <Bell size={15} />,
  dm: <MessageSquare size={15} />,
  user_follow: <Sparkles size={15} />,
  guestbook: <Sparkles size={15} />,
  price_alert: <Bell size={15} />,
  streak: <Flame size={15} />,
  // 3.0.0 — verifikacioni bot i staff obaveštenja.
  verification: <Bot size={15} />,
  staff: <Shield size={15} />,
};

/**
 * Starija baza odbija nove tipove (CHECK), pa server fallback-uje na `system`
 * sa `metadata.originalType` — prikaz (ikona, grupa) treba da ide po PRAVOM tipu.
 */
function effectiveType(item: Notification): string {
  const original = (item.metadata as { originalType?: string } | undefined)?.originalType;
  return original ?? item.type;
}

function groupOf(item: Notification): GroupKey {
  if (!item.isRead) return 'new';
  const type = effectiveType(item);
  if (type === 'reply' || type === 'mention' || type === 'upvote' || type === 'dm' || type === 'user_follow') return 'answers';
  if (type === 'badge_earned' || type === 'quest_completed' || type === 'level_up') return 'achievements';
  return 'system';
}

const GROUP_ORDER: GroupKey[] = ['new', 'answers', 'achievements', 'system'];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'sada';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short' });
}

export default function NotificationsPage() {
  const { isAuthenticated, user } = useAuthStore();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<GroupKey | 'all'>('all');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'page'],
    queryFn: () => api.notifications.list({ limit: 50 }),
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  // U-14 — dnevni loop: kvest progres (isti endpoint kao profil).
  const questsQuery = useQuery({
    queryKey: ['notifications', 'quests', user?.username],
    queryFn: () => api.users.getQuests(user!.username),
    enabled: isAuthenticated && Boolean(user?.username),
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markAllRead = async () => {
    try {
      await api.notifications.markRead();
      toast.success('Sve notifikacije su označene kao pročitane.');
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || 'Ažuriranje nije uspelo.');
    }
  };

  const markOneRead = async (id: string) => {
    try {
      await api.notifications.markRead([id]);
      invalidate();
    } catch {
      /* otvaranje linka je važnije od tihog neuspeha */
    }
  };

  const remove = async (id: string) => {
    try {
      await api.notifications.remove(id);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || 'Brisanje nije uspelo.');
    }
  };

  const notifications: Notification[] = useMemo(() => data?.notifications ?? [], [data]);
  const groups = useMemo(() => {
    const map: Record<GroupKey, Notification[]> = { new: [], answers: [], achievements: [], system: [] };
    for (const item of notifications) map[groupOf(item)].push(item);
    // „Novo“ prvo po vremenu (najnovije gore); ostale grupe takođe.
    for (const key of GROUP_ORDER) {
      map[key].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return map;
  }, [notifications]);

  if (!isAuthenticated) {
    return (
      <div className="section">
        <div className="container">
          <EmptyState
            icon={<Bell size={22} />}
            title="Prijavite se"
            message="Notifikacije su dostupne prijavljenim članovima — odgovori, pominjanja i bedževi na jednom mestu."
            action={
              <Link to="/login?next=/notifications" className="ui-btn br-primary ui-btn-md">
                Prijava
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const unread = data?.unreadCount ?? 0;
  const quests = questsQuery.data;
  const nextQuest = quests?.quests.find((quest) => !quest.completed);
  const visibleGroups = GROUP_ORDER.filter((key) => filter === 'all' || filter === key);

  return (
    <div className="section">
      <div className="container">
        <header className="mb-6 border-b border-[var(--color-border-subtle)] pb-6">
          <span className="eyebrow mb-3">Tvoj feed</span>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="page-title">Notifikacije</h1>
              <p className="text-lead mt-2">
                {unread > 0 ? `${unread} nepročitanih — počni od „Novo“` : 'Sve je pročitano. Vreme za sledeći odgovor.'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Check size={14} />}
              onClick={markAllRead}
              disabled={!unread}
            >
              Označi sve kao pročitano
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            {/* 6.x — ulaz u feed praćenih autora (inače se do njega nije znalo). */}
            <Link
              to="/forum?feed=following"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors hover:border-[var(--color-primary)]/40"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Users size={16} className="shrink-0 text-[var(--color-primary-fg)]" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-meta font-medium text-[var(--color-text-primary)]">Teme ljudi koje pratite</span>
                  <span className="text-micro block">Sve nove teme praćenih autora — bez mejla, sve u aplikaciji.</span>
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
            </Link>

            {/* Filter čipovi — isti jezik kao Deals/Forum */}
            <div className="mb-5 flex-wrap items-center gap-1.5" role="tablist" aria-label="Grupe notifikacija">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                onClick={() => setFilter('all')}
                className={`ui-tab ${filter === 'all' ? 'is-active' : ''}`}
              >
                Sve <span className="text-micro">{notifications.length}</span>
              </button>
              {GROUP_ORDER.map((key) => {
                const count = groups[key].length;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    onClick={() => setFilter(key)}
                    disabled={count === 0 && filter !== key}
                    className={`ui-tab ${filter === key ? 'is-active' : ''} ${count === 0 ? 'opacity-50' : ''}`}
                  >
                    {GROUP_META[key].title} <span className="text-micro">{count}</span>
                  </button>
                );
              })}
            </div>

            {isLoading ? (
              <SkeletonRows rows={5} />
            ) : isError ? (
              <ErrorState message="Notifikacije nije moguće učitati." onRetry={() => refetch()} />
            ) : notifications.length === 0 ? (
              <EmptyState
                icon={<Bell size={22} />}
                title="Nema notifikacija"
                message="Kada neko odgovori, pomenе vas ili vam dodeli bedž, pojaviće se ovde — grupisano po razlogu."
                action={
                  <Link to="/forum" className="ui-btn br-primary ui-btn-sm">
                    Otvori forum
                  </Link>
                }
              />
            ) : (
              <div className="space-y-8">
                {visibleGroups.map((key) => {
                  const items = groups[key];
                  if (items.length === 0) return null;
                  const meta = GROUP_META[key];
                  return (
                    <section key={key} aria-labelledby={`group-${key}`}>
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <h2 id={`group-${key}`} className="flex items-center gap-2 text-h3">
                          <span className="text-[var(--color-primary-fg)]" aria-hidden="true">
                            {meta.icon}
                          </span>
                          {meta.title}
                          <span className="font-mono text-meta font-normal text-[var(--color-text-tertiary)]">
                            {items.length}
                          </span>
                        </h2>
                        <span className="text-micro">{meta.hint}</span>
                      </div>

                      <ul className="rounded-xl border-[var(--color-border-default)] bg-[var(--color-surface-1)]">
                        {items.map((item) => (
                          <li
                            key={item.id}
                            className={`group flex items-start gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5 last:border-b-0 ${
                              item.isRead ? '' : 'bg-[var(--color-primary-subtle)]'
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md ${
                                item.isRead
                                  ? 'bg-[var(--color-surface-2)] text-[var(--color-text-tertiary)]'
                                  : 'bg-[var(--color-primary-muted)] text-[var(--color-primary-fg)]'
                              }`}
                              aria-hidden="true"
                            >
                              {TYPE_ICON[effectiveType(item)] ?? <Bell size={15} />}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <p className={`text-body !text-[0.9375rem] ${item.isRead ? '' : 'font-semibold'}`}>
                                  {item.title}
                                </p>
                                <span className="font-mono text-micro">{timeAgo(item.createdAt)}</span>
                                {!item.isRead && (
                                  <span className="rounded-sm bg-[var(--color-primary)] px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-[var(--color-on-solid)]">
                                    novo
                                  </span>
                                )}
                                {(item.metadata as { bot?: boolean } | undefined)?.bot && (
                                  <span className="rounded-sm border border-[var(--color-border-default)] px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
                                    bot
                                  </span>
                                )}
                              </div>
                              <p className="text-meta mt-0.5 line-clamp-2">{item.message}</p>
                            </div>

                            <div className="flex flex-shrink-0 items-center gap-1">
                              {item.link && (
                                <Link
                                  to={item.link}
                                  onClick={() => (item.isRead ? undefined : markOneRead(item.id))}
                                  className="ui-btn br-ghost ui-btn-sm !min-h-0 !px-2 !py-1"
                                >
                                  Otvori <ArrowRight size={13} />
                                </Link>
                              )}
                              <button
                                type="button"
                                onClick={() => remove(item.id)}
                                className="rounded p-1.5 text-[var(--color-text-tertiary)] opacity-0 transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-error)] focus-visible:opacity-100 group-hover:opacity-100"
                                aria-label="Obriši notifikaciju"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dnevni loop — zašto se stranica otvara svakog dana */}
          <aside className="space-y-8 lg:col-span-4 lg:sticky lg:top-24">
            <div className="primary-action-panel">
              <p className="text-label">Današnji loop</p>
              <p className="text-h3 mt-2 text-[var(--color-text-primary)]">
                {quests ? `${quests.completed}/${quests.total} kvestova danas` : 'Dnevni kvestovi'}
              </p>
              <p className="text-body mt-1.5">
                {nextQuest ? nextQuest.title : 'Svi dnevni kvestovi su završeni — svaka nova objava nosi XP.'}
              </p>
              <div className="mt-4 flex-wrap gap-2">
                <Link to="/forum?compose=1" className="ui-btn br-primary ui-btn-sm">
                  Otvori temu
                </Link>
                <Link to="/deals" className="ui-btn br-ghost ui-btn-sm">
                  Podeli popust
                </Link>
              </div>
            </div>

            <div className="rail-panel">
              <h2 className="rail-title mb-2 flex items-center gap-1.5">
                <Zap size={13} aria-hidden="true" /> Kako se dobija XP
              </h2>
              <ul className="space-y-1.5 text-meta">
                <li>Nova tema — +20 XP</li>
                <li>Odgovor koji neko označi korisnim — karma</li>
                <li>Prvi post dana — bonus za streak</li>
                <li>Deal sa dokazom — doprinos zajednici</li>
              </ul>
            </div>

            <div className="rail-panel">
              <h2 className="rail-title mb-2">Ne propusti</h2>
              <div className="space-y-1">
                <Link
                  to="/deals?expiringSoon=true"
                  className="flex items-center justify-between py-1.5 text-meta text-[var(--color-text-primary)] hover:text-[var(--color-primary-fg)]"
                >
                  Popusti koji ističu danas <ArrowRight size={13} />
                </Link>
                <Link
                  to="/leaderboard"
                  className="flex items-center justify-between py-1.5 text-meta text-[var(--color-text-primary)] hover:text-[var(--color-primary-fg)]"
                >
                  Rang lista nedelje <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
