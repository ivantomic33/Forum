import { Check, X } from 'lucide-react';
import { getPasswordChecks } from '../lib/passwordRules';

interface PasswordRequirementsProps {
  password: string;
  showAlways?: boolean;
}

/**
 * Prikazuje zahteve lozinke ispod inputa (min 8 karaktera, slovo, broj, nije česta).
 * Svaki zahtev dobija ✓ (zeleno) kada je ispunjen, ✗ (crveno) kada nije.
 */
export default function PasswordRequirements({ password, showAlways = true }: PasswordRequirementsProps) {
  if (!password && !showAlways) return null;

  return (
    <ul className="auth-requirements" aria-label="Zahtevi za lozinku">
      {getPasswordChecks(password).map((check) => (
        <li key={check.rule} className={check.ok ? 'is-ok' : 'is-bad'}>
          {check.ok ? <Check size={13} /> : <X size={13} />}
          <span>{check.label}</span>
        </li>
      ))}
    </ul>
  );
}
