import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { Button } from './Button';
import { cn } from './cn';

/**
 * Skeleton — jedinstven loading placeholder.
 * `SkeletonText` za pasuse, `SkeletonCard` za kartice (članak/temu).
 * Dimenzije prate finalni layout (16:9 hero, 4:3 kartica, 56/72 px red) da
 * CLS ostane < 0,05.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('ui-skeleton', className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function SkeletonCard({ withImage = true, className }: { withImage?: boolean; className?: string }) {
  return (
    <div className={cn('ui-card-static overflow-hidden !p-0', className)} aria-hidden="true">
      {withImage && <Skeleton className="aspect-[4/3] w-full rounded-none" />}
      <div className="space-y-3 p-4">
        <Skeleton className="h-3.5 w-16 rounded-md" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}

/** Skeletonska lista tema — red ≥ 56 px, bez okvira (kao `ThreadRow`). */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-[56px] items-center gap-3 border-b border-[var(--color-border-subtle)] px-3 py-3.5 last:border-b-0"
        >
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-5 w-14 rounded-md sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Skeletonska lista u stilu `ThreadRow`: ikona, naslov, meta, avatar + vreme. */
export function SkeletonThreadRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex min-h-[72px] items-center gap-3 border-b border-[var(--color-border-subtle)] px-1 py-3 last:border-b-0"
        >
          <Skeleton className="h-8 w-8 flex-shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="hidden h-3 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
}

/** ErrorState — zajednički prikaz greške sa "Pokušaj ponovo" (i18n preko `common.*`). */
export function ErrorState({ title, message, onRetry, className, children }: ErrorStateProps) {
  const t = useT();
  return (
    <div role="alert" className={cn('ui-state-box', className)}>
      <span className="ui-state-icon ui-state-icon-error">
        <AlertTriangle size={22} />
      </span>
      <h2 className="ui-state-title">{title ?? t('common.error')}</h2>
      {message && <p className="ui-state-text">{message}</p>}
      {children}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} leftIcon={<RefreshCw size={14} />}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
}

/** EmptyState — "nema podataka" stanje (bez lažnog fallback sadržaja). */
export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn('ui-state-box', className)}>
      {icon && <span className="ui-state-icon">{icon}</span>}
      <h2 className="ui-state-title">{title}</h2>
      {message && <p className="ui-state-text">{message}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
