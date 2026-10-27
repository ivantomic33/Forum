// Skeniranje AuthPage.tsx: kandidati za i18n (srpski stringovi u JSX-u i JS-u).
const fs = require('fs');
const t = fs.readFileSync('src/pages/AuthPage.tsx', 'utf8');
const lines = t.split('\n');
console.log('lines:', lines.length);
lines.forEach((l, i) => {
  const trimmed = l.trim();
  // tekst unutra JSX tekstualnih čvorova: >tekst<
  const jsx = trimmed.match(/>([^<>{}"]{4,})</);
  if (jsx && /[a-zčćšđž]{3,}/i.test(jsx[1]) && !jsx[1].match(/^[A-Z0-9_\-.:\/ ]+$/)) {
    console.log(i + 1, 'JSX |', jsx[1].slice(0, 90));
  }
  // string literal sa srpskim rečima (toast, label, placeholder)
  const lit = trimmed.match(/['"`]([^'"`]{6,})['"`]/);
  if (lit && /[čćšđž]|lozink|Prijava|Registracija|Nalog|Mejl|uspe|neuspe|Dobrodo|verifik/i.test(lit[1]) && !l.includes('className') && !l.includes('import ')) {
    console.log(i + 1, 'STR |', lit[1].slice(0, 90));
  }
  // placeholder=/aria-label=/title=
  const attr = trimmed.match(/(placeholder|aria-label|title)=["'{]([^"'}]{4,})/);
  if (attr && /[čćšđž]/i.test(attr[2])) {
    console.log(i + 1, 'ATTR |', attr[1], '=', attr[2].slice(0, 80));
  }
});
