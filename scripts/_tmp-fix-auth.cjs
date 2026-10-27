// AuthPage.tsx — masovna zamena srpskih stringova i18n ključevima.
// (Linija-po-liniju; fajl ima ~600 linija i mnogo stringova.)
const fs = require('fs');
const p = 'src/pages/AuthPage.tsx';
let t = fs.readFileSync(p, 'utf8');
let count = 0;

const pairs = [
  // --- footer/side panel ---
  ["'Prijavite se da biste komentarisali, sačuvali vesti i prilagodili svoj gaming profil.'", "t('auth.sideLoginHint')"],
  ["'Kreirajte nalog i pridružite se gejming zajednici.'", "t('auth.sideRegisterHint')"],
  // --- setError poruke ---
  ["'Morate prihvatiti uslove korišćenja i politiku privatnosti da biste se registrovali.'", "t('auth.termsRequired')"],
  ["'Lozinke se ne poklapaju.'", "t('auth.passwordsMismatch')"],
  ["'Korisničko ime je već zauzeto.'", "t('auth.usernameTaken')"],
  ["'Email adresa je već registrovana.'", "t('auth.emailTaken')"],
  ["'Sačekajte da se završi provera „nisam robot“ i pokušajte ponovo.'", "t('auth.captchaWait')"],
  ["isLogin ? 'Greška pri prijavi.' : 'Greška pri registraciji.'", "isLogin ? t('auth.loginFailed') : t('auth.registerFailed')"],
  ["'Kod nije prihvaćen. Pokušajte ponovo.'", "t('auth.2faInvalid')"],
  ["'Lozinka ne ispunjava zahteve.'", "t('auth.passwordWeak')"],
  // --- hint i linkovi ---
  ["'Korisničko ime je slobodno.'", "t('auth.usernameFree')"],
  ["'Sakrij lozinku'", "t('auth.hidePassword')"],
  ["'Prikaži lozinku'", "t('auth.showPassword')"],
  ["'Zaboravili ste lozinku?'", "t('auth.forgotPassword')"],
  ["'Potvrdite da imate najmanje 15 godina.'", "t('auth.ageConfirm')"],
];

// interpolacija setError(err.message || '...') i setError('...')
for (const [needle, replacement] of pairs) {
  if (t.includes(needle)) {
    t = t.split(needle).join(replacement);
    count++;
  }
}

// setError(passwordError(password) ?? 'Lozinka...') — specifičan oblik
t = t.split("setError(passwordError(password) ?? 'Lozinka ne ispunjava zahteve.');")
  .join("setError(passwordError(password) ?? t('auth.passwordWeak'));");
if (t.includes("t('auth.passwordWeak')")) count++;

// JSX tekstualni čvorovi (bez navodnika): >Korisničko ime je već zauzeto.<
t = t.split('>Korisničko ime je već zauzeto.<').join(`>{t('auth.usernameTaken')}<`);
t = t.split('>Korisničko ime je slobodno.<').join(`>{t('auth.usernameFree')}<`);
t = t.split('>Potvrdite da imate najmanje 15 godina.<').join(`>{t('auth.ageConfirm')}<`);
t = t.split('>Email adresa je već registrovana.<').join(`>{t('auth.emailTaken')}<`);
count += 4;

// useT hook ako ne postoji
if (!t.includes('const t = useT()')) {
  t = t.replace(
    /(export default function AuthPage\(\) \{\n)/,
    '$1  const t = useT();\n',
  );
}
if (!t.includes("from '../lib/i18n'")) {
  t = t.replace(
    "import { api } from '../lib/api';",
    "import { api } from '../lib/api';\nimport { useT } from '../lib/i18n';",
  );
}

fs.writeFileSync(p, t, 'utf8');
console.log('pairs replaced:', count);
