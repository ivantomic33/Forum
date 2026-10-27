import { cn } from './cn';

/**
 * AvatarStack — preklopljeni avatari učesnika u temi/deal-u + „+N“.
 * Bela/tamna 2px ivica odvaja avatare od podloge (`--color-surface-0`).
 */
export interface AvatarStackItem {
  src?: string | null;
  alt?: string;
}

export interface AvatarStackProps {
  users: AvatarStackItem[];
  max?: number;
  size?: number;
  className?: string;
}

export function AvatarStack({ users, max = 3, size = 28, className }: AvatarStackProps) {
  const visible = users.slice(0, max);
  const rest = Math.max(0, users.length - visible.length);
  const style = { width: size, height: size };

  return (
    <span className={cn('avatar-stack', className)} aria-label={`${users.length} učesnika`}>
      {visible.map((user, index) => (
        <img
          key={index}
          src={user.src || undefined}
          alt={user.alt || ''}
          loading="lazy"
          style={style}
          className="object-cover"
        />
      ))}
      {rest > 0 && (
        <span className="avatar-stack-more" style={{ height: size, minWidth: size }} aria-hidden="true">
          +{rest}
        </span>
      )}
    </span>
  );
}
