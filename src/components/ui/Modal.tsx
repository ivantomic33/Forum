import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Širina panela; podrazumevano `md`. `2xl` je za dug forms (profile settings). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const SIZE: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

/**
 * Modal — focus trap, ESC za zatvaranje, vraćanje fokusa na trigger,
 * scroll lock i role="dialog"/aria-modal.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', className }: ModalProps) {
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
      // Uvek prvo `<body>`, pa panel: ako je fokus već unutra (korisnik je kliknuo
      // polje odmah po otvaranju), ne prekidaj kucanje; i ako focus render ne
      // dođe (`TTI` zakasni), panel sigurno nije `body` pa fokus ipak uđe u modal.
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
    // `onClose` se NE stavlja u zavisnosti: `Modal` se koristi sa inline strelicama
    // (`onClose={() => setX(false)}`), pa bi se efekat pokretao pri svakom renderu
    // roditelja — vraćao fokus na trigger i vadio ga iz polja posle prvog slova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn('ui-modal-panel', SIZE[size], className)}
      >
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-4">
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
            <button type="button" onClick={onClose} aria-label="Zatvori dijalog" className="ui-icon-btn shrink-0">
              <X size={18} />
            </button>
          </div>
          <div className="overflow-y-auto py-4">{children}</div>
          {footer && (
            <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--color-border-subtle)] pt-4">{footer}</div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
