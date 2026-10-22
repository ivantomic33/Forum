import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { cn } from './ui/cn';

/**
 * NotificationBell — broj neprocitanih notifikacija iz `GET /api/notifications`.
 * Ceo prostor je link ka profilu (tab Notifikacije); polling na 30s.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { isAuthenticated } = useAuthStore();

  const { data } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notifications.list({ unreadOnly: false, limit: 20 }),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  if (!isAuthenticated) return null;

  const unread = data?.unreadCount ?? 0;

  return (
    <Link
      to="/notifications"
      className={cn('ui-icon-btn relative', className)}
      aria-label={unread ? `${unread} neprocitanih notifikacija` : 'Nema novih notifikacija'}
    >
      <Bell size={16} />
      {unread > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-[var(--color-text-on-primary)]"
          aria-hidden="true"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
