/**
 * 5.0 TERMINAL — checkbox koji izgleda kao `[ ]` / `[x]`.
 *
 * Native `<input type="checkbox">` ostaje u DOM-u (tastatura, form asocijacija,
 * screen reader, `form` submit) — samo je vizuelno sakriven, a stanje prikazuju
 * dva mono span-a sa `data-checked`. Violet boja je akcent, a `x` je ASCII
 * signal, pa stanje nije preneto samo bojom.
 *
 * `onClick` može da spreči `preventDefault()` (npr. uslove korišćenja koji
 * otvaraju modal) — vidi `AuthPage`.
 */
export function TerminalCheckbox({
  checked,
  onChange,
  onClick,
  disabled,
  label,
  className = '',
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  onClick?: (event: React.MouseEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /** Tekst desno od `[ ]` (može biti JSX za linkove). */
  label: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <label className={`auth-checkbox ${className}`.trim()}>
      <input
        id={id}
        type="checkbox"
        className="auth-checkbox-input"
        checked={checked}
        disabled={disabled}
        onClick={onClick}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="auth-checkbox-box" aria-hidden="true">
        <span className="auth-checkbox-bracket">[</span>
        <span className="auth-checkbox-mark" data-checked={checked ? 'true' : 'false'}>
          {checked ? 'x' : '\u00a0'}
        </span>
        <span className="auth-checkbox-bracket">]</span>
      </span>
      <span className="auth-checkbox-label">{label}</span>
    </label>
  );
}
