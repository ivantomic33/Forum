import { getPasswordChecks } from '../lib/passwordRules';

interface PasswordRequirementsProps {
  password: string;
  showAlways?: boolean;
}

/**
 * 5.0 TERMINAL — zahtevi lozinke u jednom kompaktnom mono redu.
 *
 * Ranije je svako pravilo bilo zaseban red sa ikonom (4 reda visine). Sada su
 * svi zahtevi u jednom inline redu: `<8 · slovo · broj · nije česta`, a status
 * nosi `✓`/`✕` prefix (isto kao terminal output). Ispunjeno pravilo više ne
 * “skače” u visini, pa se forma ne pomera dok korisnik kuca.
 *
 * Pristupačno: `role="list"` + `aria-label` po stavci, a boja nikad nije jedini
 * signal (prefix je ASCII karakter).
 */
export default function PasswordRequirements({ password, showAlways = true }: PasswordRequirementsProps) {
  if (!password && !showAlways) return null;

  const checks = getPasswordChecks(password);
  const okCount = checks.filter((check) => check.ok).length;

  return (
    <div className="auth-rules" role="group" aria-label="Zahtevi za lozinku">
      <ul className="auth-rules-list" role="list">
        {checks.map((check) => (
          <li
            key={check.rule}
            className={`auth-rule ${check.ok ? 'is-ok' : 'is-bad'}`}
            aria-label={`${check.label}: ${check.ok ? 'ispunjeno' : 'nije ispunjeno'}`}
          >
            <span className="auth-rule-mark" aria-hidden="true">
              {check.ok ? '✓' : '✕'}
            </span>
            {check.label}
          </li>
        ))}
      </ul>
      <span className="auth-rules-count" aria-hidden="true">
        [{String(okCount).padStart(2, '0')}/{String(checks.length).padStart(2, '0')}]
      </span>
    </div>
  );
}
