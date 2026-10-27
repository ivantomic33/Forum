import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Globalni QueryClient — keširanje, deduplikacija i refetch server state-a.
 * staleTime: 60s (podaci sveži minut — nema refetcha na svakom mount-u),
 * retry: 1, refetchOnWindowFocus: false.
 *
 * Živi u sopstvenom modulu (ne u `App.tsx`) da ga store-ovi mogu importovati
 * bez kružne zavisnosti (`App` → `Layout` → `authStore` → `App`).
 */
export const queryClientConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
};

export const queryClient = new QueryClient(queryClientConfig);

/**
 * N-06 — `QueryClientProvider` kao posebna komponenta.
 *
 * `@tanstack/react-query` (~57 kB) je u svom chunku; kada ga `App` uvozi
 * **direktno**, Rollup ga uvuče u glavni chunk. Ovim je provider izdvojen u
 * metod (modul koji uvoz samo `index`), pa glavni chunk ne nosi biblioteku i
 * `query-vendor` se preuzima paralelno preko `modulepreload`-a.
 */
export function AppQueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
