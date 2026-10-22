import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `pills` = segmenti (filteri), `underline` = tabovi sekcije. */
  variant?: 'pills' | 'underline';
  ariaLabel: string;
  className?: string;
}

/**
 * Tabs — pristupačan tablist (strelica levo/desno, Home/End),
 * jedan izvor stilova za sve tabove u aplikaciji.
 */
export function Tabs<T extends string = string>({ items, value, onChange, variant = 'pills', ariaLabel, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = buttons.length - 1;
    buttons[nextIndex]?.focus();
    onChange(items[nextIndex].id);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn('ui-tabs', variant === 'underline' ? 'ui-tabs-underline' : 'ui-tabs-pills', className)}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn('ui-tab', active && 'is-active')}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count !== undefined && <span className="ui-tab-count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
