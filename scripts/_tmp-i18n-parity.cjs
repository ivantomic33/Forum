// Finalna provera i18n rečnika (kao _tmp-i18n-check, ali ponovo upisana jer je obrisana).
const fs = require('fs');
const src = fs.readFileSync('src/lib/i18n.ts', 'utf8');
function section(name) {
  const start = src.indexOf(`${name}: {`);
  const after = src.indexOf('\n', start) + 1;
  const end = src.indexOf('\n  },', after);
  return src.slice(after, end);
}
function keys(block) {
  const found = [];
  const re = /'([a-z][a-zA-Z]*\.[a-zA-Z][\w]*)':/g;
  let m;
  while ((m = re.exec(block))) found.push(m[1]);
  return found;
}
const srKeys = keys(section('sr'));
const enKeys = keys(section('en'));
console.log('sr keys:', srKeys.length, 'en keys:', enKeys.length);
const srDup = [...new Set(srKeys.filter((k, i) => srKeys.indexOf(k) !== i))];
const enDup = [...new Set(enKeys.filter((k, i) => enKeys.indexOf(k) !== i))];
if (srDup.length || enDup.length) { console.error('DUP:', srDup, enDup); process.exit(1); }
const onlySr = srKeys.filter((k) => !enKeys.includes(k));
const onlyEn = enKeys.filter((k) => !srKeys.includes(k));
if (onlySr.length || onlyEn.length) {
  console.error('PARITY FAIL — only sr:', onlySr, 'only en:', onlyEn);
  process.exit(1);
}
console.log('OK: parity complete,', srKeys.length, 'keys');
