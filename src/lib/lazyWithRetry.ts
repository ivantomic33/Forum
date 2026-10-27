/**
 * POUZDANO LENO UČITAVANJE (N-06 / N-07)
 * --------------------------------------
 * `React.lazy` pamti odbijeni import zauvek: ako mreža padne (ili se posle
 * deploy-a traži stari chunk sa hešom koji više ne postoji), ruta ostaje
 * trajno slomljena do punog reload-a. Za SEO-vredne rute (rang-lista) to je
 * nedopustivo — ovde se odbijeni import zaboravlja, pa sledeći render (ili
 * „Pokušaj ponovo“) pokušava ponovo.
 */
import { lazy, type ComponentType } from 'react';

export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(() =>
    factory().catch((error: unknown) => {
      // Sledeći pokušaj mora da napravi novi `import()`, a ne da vrati isti
      // odbijeni Promise iz module mape.
      const reason = error instanceof Error ? error : new Error('Chunk se nije učitao');
      console.warn('[lazy] chunk nije dostupan, sledeći pokušaj ponovo', reason);
      // Kratka pauza da „Pokušaj ponovo“ ne udari u isti mrežni problem.
      return new Promise<{ default: T }>((resolve) => {
        window.setTimeout(() => resolve(factory()), 400);
      });
    }),
  );
}
