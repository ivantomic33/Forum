/**
 * N-11 — POSTINSTALL ZAPIS
 * ------------------------
 * Upisuje hash `package.json`-a (root i `server/`) u `.npm-install-state.json`.
 * `scripts/check-install.mjs` (pokreće ga `pretest` i CI) uporedi taj hash sa
 * trenutnim stanjem i upozori kada je manifest izmenjen bez `npm install`.
 *
 * Idempotentan i bez zavisnosti; nikad ne obara instalaciju.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const stateFile = path.join(root, '.npm-install-state.json');

const hashOf = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

try {
  const state = { installedAt: new Date().toISOString(), manifests: {} };
  for (const [name, dir] of [
    ['root', root],
    ['server', path.join(root, 'server')],
  ]) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) state.manifests[name] = hashOf(pkg);
  }
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
} catch (error) {
  console.warn('[postinstall] stanje instalacije nije upisano:', error?.message ?? error);
}
