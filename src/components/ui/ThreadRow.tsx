import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

/**
 * ThreadRow — jedan red forum liste (bez okvira).
 *
 * Levo 32 px ikona kategorije u boji akcenta, naslov 17 px, meta 13 px u jednoj
 * liniji sa „·“ separatorima, desno avatar zadnjeg odgovora + relativno vreme.
 * Pin / Lock / Hot su IKONICE 14 px (ne badgevi) i stoje uz naslov.
 */
export interface ThreadRowProps {
  to: string;
  title: string;
  /** Ikona kategorije (lucide), već obojena po akcentu sekcije. */
  categoryIcon?: ReactNode;
  categoryLabel?: string;
  /** Flag ikonice: pin, lock, hot. */
  flags?: ReactNode;
  replies?: number;
  votes?: number;
  views?: number;
  /** Autor teme. */
  author?: string;
  /** Zasebna meta linija, na primer relativno vreme kreiranja. */
  time?: string;
  /** Avatar zadnjeg odgovora (element `img`/`span`). */
  lastAvatar?: ReactNode;
  lastRepliesLabel?: string;
  lastTime?: string;
  className?: string;
}

export function ThreadRow({
  to,
  title,
  categoryIcon,
  categoryLabel,
  flags,
  replies,
  votes,
  views,
  author,
  time,
  lastAvatar,
  lastRepliesLabel,
  lastTime,
  className,
}: ThreadRowProps) {
  const meta = [
    votes !== undefined ? <span key="votes">{votes} glasova</span> : null,
    views !== undefined ? <span key="views">{views} pregleda</span> : null,
    author ? <span key="author">{author}</span> : null,
    time ? <span key="time">{time}</span> : null,
  ].filter(Boolean);

  return (
    <Link to={to} className={cn('thread-row', className)}>
      <span className="thread-row-icon" aria-label={categoryLabel} title={categoryLabel}>
        {categoryIcon}
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {flags && <span className="flex items-center gap-1" aria-hidden="true">{flags}</span>}
          <span className="thread-row-title line-clamp-1 min-w-0">{title}</span>
        </div>
        {meta.length > 0 && (
          <div className="thread-meta mt-1 min-w-0">
            {meta.map((item, index) => (
              <span key={index} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {index > 0 && <span className="dot" aria-hidden="true">·</span>}
                {item}
              </span>
            ))}
          </div>
        )}
      </div>

      {/*
       * Brojač odgovora — CYAN zona foruma, mono. Stoji iznad meta reda da bi
       * bio skeniran prije autora i vremena (na mobilnom se meta skraćuje).
       */}
      {(replies !== undefined || lastAvatar || lastTime || lastRepliesLabel) && (
        <div className="thread-media">
          {replies !== undefined && (
            <span className="thread-replies" title={`${replies} odgovora`}>
              {replies} odg.
            </span>
          )}
          {lastAvatar}
          <div className="hidden flex-col items-end text-micro text-[var(--color-text-tertiary)] sm:flex">
            {lastRepliesLabel && <span>{lastRepliesLabel}</span>}
            {lastTime && <span>{lastTime}</span>}
          </div>
        </div>
      )}
    </Link>
  );
}
