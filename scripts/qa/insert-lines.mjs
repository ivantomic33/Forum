import fs from 'node:fs';

/**
 * Umeće blok linija PRE linije koja sadrži marker (prvi pogodak).
 *
 * Zašto ne ručno u editoru: fajlovi u `src/` su CRLF + UTF-8 bez BOM, a
 * PowerShell `Set-Content` upisuje BOM (i time menja ceo diff). Ovaj alat
 * piše isti format kakav je zatekao.
 *
 *   node scripts/qa/insert-lines.mjs <fajl> "<marker>" <fajl-sa-blokom>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [target, marker, blockFile] = process.argv.slice(2);
if (!target || !marker || !blockFile) {
  console.error('upotreba: node scripts/qa/insert-lines.mjs <fajl> "<marker>" <fajl-sa-blokom>');
  process.exit(1);
}

const raw = readFileSync(target, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const block = readFileSync(blockFile, 'utf8').replace(/\r?\n$/, '').split(/\r?\n/);

const index = lines.findIndex((line) => line.includes(marker));
if (index < 0) {
  console.error(`[insert-lines] marker nije nađen: ${marker}`);
  process.exit(1);
}

lines.splice(index, 0, ...block);
writeFileSync(target, lines.join(eol), 'utf8');
console.log(`[insert-lines] ${block.length} linija pre reda ${index + 1}`);
