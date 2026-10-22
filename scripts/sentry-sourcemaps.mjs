import { execFile } from 'node:child_process';

/**
 * SENTRY SOURCE MAPS (analiza §7.7 — „ostaje upload source mapa“)
 * --------------------------------------------------------------
 * Produkcijski stack iz Sentry-ja pokazuje samo `index-3f9a.js:1:48213` jer se
 * build pravi sa `sourcemap: false`. Ovaj plugin:
 *
 *  1. uključi izvorne mape SAMO kada je upload moguć (`SENTRY_AUTH_TOKEN` +
 *     `SENTRY_ORG` + `SENTRY_PROJECT`) — lokalni build ostaje bez `.map` fajlova;
 *  2. posle `closeBundle` pozove `sentry-cli sourcemaps upload`, pa obriše
 *     `.map` fajlove iz `dist/` da se javno ne serviraju (učitavanje koda
 *     napadaču nije potrebno).
 *
 * Bez tokena plugin je potpuno inertan (nula promena u ponašanju build-a).
 * U CI-ju se argumenti mogu podesiti i preko env-a, a CLI se dobija sa
 * `SENTRY_CLI_PATH` ili sistemski instaliranim `sentry-cli`.
 */
export function sentrySourceMaps() {
  let enabled = false;

  return {
    name: 'nexus-sentry-sourcemaps',
    apply: 'build',

    config() {
      enabled = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);
      if (!enabled) return;
      return { build: { sourcemap: 'hidden' } };
    },

    closeBundle() {
      if (!enabled) return;
      const cli = process.env.SENTRY_CLI_PATH || 'sentry-cli';
      const org = process.env.SENTRY_ORG || '';
      const project = process.env.SENTRY_PROJECT || '';
      const args = [
        'sourcemaps',
        'upload',
        '--org',
        org,
        '--project',
        project,
        '--release',
        process.env.SENTRY_RELEASE || `nexus@${process.env.npm_package_version || 'dev'}`,
        '--url-prefix',
        '~/',
        '--validate',
        'dist',
      ];

      execFile(cli, args, { env: process.env }, (error, stdout, stderr) => {
        if (error) {
          // Build ne sme da padne zbog monitoringa, ali mora da bude vidljivo.
          console.warn('[sentry] source map upload nije uspeo:', stderr || error.message);
          return;
        }
        console.log('[sentry] source maps uploadovane:', stdout.trim().split('\n').slice(-1)[0]);
        // Bezbednost: mape su sada na Sentry-ju, ne u javnom `dist/`.
        void import('node:fs/promises').then(({ readdir, rm }) =>
          readdir('dist', { recursive: true, withFileTypes: true }).then((entries) =>
            Promise.all(
              entries
                .filter((entry) => entry.isFile() && entry.name.endsWith('.map'))
                .map((entry) => rm(`${entry.parentPath ?? entry.path}/${entry.name}`, { force: true })),
            ),
          ),
        );
      });
    },
  };
}
