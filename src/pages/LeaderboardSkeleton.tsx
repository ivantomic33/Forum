/**
 * RANG-LISTA — SKELET STRANICE (N-07)
 * -----------------------------------
 * Rang-lista je javna i SEO-vredna, pa se skelet renderuje **odmah** sa
 * glavnim chunkom: bez spinnera, bez „layout shift“-a i sa pravim `<h1>`-om
 * koji crawler vidi i pre nego što se `LeaderboardPage` (i framer-motion)
 * uopšte preuzme. Isti skelet koristi i `Suspense` fallback i sama strana
 * dok traje prvi `useQuery`.
 *
 * Klasе su identične pravim elementima stranice, da prelaz ne „skače“.
 */

export function LeaderboardSkeleton() {
  return (
    <div className="section">
      <div className="container max-w-5xl">
        <header className="mb-10 border-b border-white/[0.07] pb-8 text-center">
          <span className="eyebrow mb-4 justify-center">NEXUS Hall of Fame</span>
          <h1 className="page-title mx-auto">Rang-lista zajednice</h1>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-white/50">
            Najaktivniji članovi, veterani i kreatori sadržaja rangirani po zarađenoj karmi, osvojenim bedževima i nivoima reputacije.
          </p>
          <div className="ui-tabs ui-tabs-pills mx-auto mt-7" aria-label="Kriterijum rangiranja">
            <span className="ui-tab">Po karmi</span>
            <span className="ui-tab">Po nivou (XP)</span>
          </div>
        </header>

        {/* Podijum — isti raspored i visine kao pravi top 3. */}
        <div className="mb-10 grid grid-cols-1 items-end gap-4 md:grid-cols-3" aria-busy="true" aria-label="Učitavanje rang-liste">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="ui-card-static flex flex-col items-center gap-4 !p-6"
              style={{ minHeight: item === 1 ? 260 : 230 }}
            >
              <div className="ui-skeleton h-3 w-24" />
              <div className="ui-skeleton rounded-full" style={{ width: item === 1 ? 88 : 72, height: item === 1 ? 88 : 72 }} />
              <div className="ui-skeleton h-5 w-32" />
              <div className="ui-skeleton h-3 w-20" />
              <div className="ui-skeleton mt-2 h-4 w-24" />
            </div>
          ))}
        </div>

        {/* Tabela — zaglavlje i osam redova. */}
        <div className="overflow-hidden rounded-lg border border-white/[0.09] bg-surface-1 shadow-[var(--shadow-level-1)]">
          <div className="flex items-center justify-between border-b border-white/[0.07] bg-surface-2/60 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-tertiary)] sm:px-6">
            <div className="flex items-center gap-5 sm:gap-6">
              <span className="w-8 text-center">Rang</span>
              <span>Korisnik</span>
            </div>
            <div className="flex items-center gap-6 sm:gap-8">
              <span className="hidden sm:inline">Nivo</span>
              <span className="w-20 text-right sm:w-24">Karma</span>
            </div>
          </div>
          <div className="divide-y divide-white/[0.05]" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <div key={row} className="flex items-center justify-between px-4 py-4 sm:px-6">
                <div className="flex items-center gap-5 sm:gap-6">
                  <div className="ui-skeleton h-7 w-8 rounded-[4px]" />
                  <div className="ui-skeleton h-10 w-10 rounded-full" />
                  <div className="space-y-2">
                    <div className="ui-skeleton h-3 w-32" />
                    <div className="ui-skeleton h-2.5 w-16" />
                  </div>
                </div>
                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="ui-skeleton hidden h-5 w-12 rounded-[4px] sm:block" />
                  <div className="ui-skeleton h-4 w-14 sm:w-20" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default LeaderboardSkeleton;
