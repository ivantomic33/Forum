import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';

/**
 * Drawer — bočni panel (desno) sa istim ponašanjem kao Modal:
 * focus trap, ESC zatvara, vraća fokus, `role="dialog"`/`aria-modal`,
 * scroll lock. Ispod 640 px postaje bottom-sheet koji se vuče do 85vh.
 *
 * Koristi se za filtere popusta (< 1024 px) i detalje u adminu.
 */
export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Id tela panela (za `aria-controls` dugmeta koje ga otvara). */
  id?: string;
}

export function Drawer({ open, onClose, title, description, children, footer, className, id }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // Isto kao `Modal`: fokus samo ako već nije unutra — efekat se ne sme
      // pokretati pri renderu roditelja (inline `onClose`).
      const active = document.activeElement;
      if (active instanceof Node && panel.contains(active) && active !== panel) return;
      panel.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusFirst);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
    // `onClose` namerno nije zavisnost — vidi `Modal.tsx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="ui-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn('ui-drawer', className)}
      >
        <div className="ui-drawer-header">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 text-[var(--color-text-primary)]">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-meta text-[var(--color-text-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Zatvori panel" className="ui-icon-btn shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="ui-drawer-body">{children}</div>
        {footer && <div className="ui-drawer-footer flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}
