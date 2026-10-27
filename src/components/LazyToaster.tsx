/**
 * TOASTER (N-06)
 * --------------
 * `sonner` (~67 kB) je u svom chunku — uvozi ga dvadesetak stranica preko
 * `toast()`. Glavni chunk ga ne sme uvući samo zato što `App` renderuje
 * `<Toaster />`, pa je on ovde u lenom modulu.
 *
 * Dok chunk ne stigne nema toastera (prvi toast biće izgubljen samo u tom
 * prozoru); `undefined` se ne renderuje, a globalne stilske klase
 * (`[data-sonner-toast]`) već su u `styles/components/utilities.css`.
 */
import { lazy, Suspense } from 'react';

/**
 * `modulepreload` u `index.html` ovaj chunk učitava paralelno, pa toaster
 * realno stigne pre prvog toasta, a ne odlaže prvo iscrtavanje.
 */
const Toaster = lazy(() =>
  import('sonner').then((module) => ({ default: module.Toaster })),
);

export default function LazyToaster() {
  return (
    <Suspense fallback={null}>
      <Toaster
        position="bottom-right"
        theme="dark"
        richColors
        toastOptions={{
          style: {
            background: '#1a1e27',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            color: '#f0f2f5',
          },
        }}
      />
    </Suspense>
  );
}
