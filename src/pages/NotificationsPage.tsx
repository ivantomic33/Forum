import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Bell, CheckCheck, MessageSquare, Sparkles, ThumbsUp, Trophy, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/Feedback';

const ICONS: Record<string, ReactNode> = {
  reply: <MessageSquare size={16} />,
  mention: <Sparkles size={16} />,
  upvote: <ThumbsUp size={16} />,
  badge_earned: <Trophy size={16} />,
  quest_completed: <Trophy size={16} />,
  system: <Bell size={16} />,
};

export default function NotificationsPage() {
  const { isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'page'],
    queryFn: () => api.notifications.list({ limit: 50 }),
    enabled: isAuthenticated,
    refetchInterval: 30_000,
  });

  const markAllRead = async () => {
    try {
      await api.notifications.markRead();
      toast.success('Sve notifikacije su oznacene kao procitane.');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err: any) {
      toast.error(err?.message || 'A�uriranje nije uspelo.');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.notifications.remove(id);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    } catch (err: any) {
      toast.error(err?.message || 'Brisanje nije uspelo.');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="page-shell py-10">
        <EmptyState
          icon={<Bell size={22} />}
          title="Prijavite se"
          message="Notifikacije su dostupne prijavljenim clanovima."
        />
      </div>
    );
  }

  const notifications = data?.notifications ?? [];

  return (
    <div className="page-shell space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-white">Notifikacije</h1>
          <p className="text-sm text-white/60">
            {data?.unreadCount ? `${data.unreadCount} neprocitanih` : 'Sve ste procitali.'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<CheckCheck size={14} />}
          onClick={markAllRead}
          disabled={!data?.unreadCount}
        >
          Oznaci sve kao procitano
        </Button>
      </div>

      <Card>
        <CardHeader title="Va�a aktivnost" subtitle="Odgovori, pominjanja, glasovi i kvestovi" icon={<Bell size={16} />} />
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : isError ? (
          <ErrorState message="Notifikacije nije moguce ucitati." onRetry={() => refetch()} />
        ) : notifications.length === 0 ? (
          <EmptyState title="Nema notifikacija" message="Kada neko odgovori ili vas pomenе, pojavice se ovde." />
        ) : (
          <ul className="divide-y divide-white/5">
            {notifications.map((item: any) => (
              <li
                key={item.id}
                className={`flex items-start gap-3 py-4 ${item.isRead ? 'opacity-70' : ''}`}
              >
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-white/[0.07] bg-surface-2 text-[var(--color-primary-fg)]">
                  {ICONS[item.type] ?? <Bell size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-sm text-white/65">{item.message}</p>
                  <span className="mt-1 block text-xs text-white/40">
                    {new Date(item.createdAt).toLocaleString('sr-Latn-RS')}
                  </span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1">
                  {item.link && (
                    <Link
                      to={item.link}
                      onClick={() => api.notifications.markRead([item.id]).catch(() => { })}
                      className="rounded px-2 py-1 text-xs font-semibold text-[var(--color-primary-fg)] hover:bg-white/[0.05]"
                    >
                      Otvori
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    className="rounded p-2 text-white/45 hover:bg-white/[0.05] hover:text-rose-400"
                    aria-label="Obri�i notifikaciju"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
