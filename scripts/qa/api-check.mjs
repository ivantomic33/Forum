/** QA: API konekcija — /api/health kroz Vite proxy i lista deal-ova. */
export default async function run(page) {
  const health = await page.request.get('http://localhost:5176/api/health');
  const deals = await page.request.get('http://localhost:5176/api/deals?limit=2');
  return {
    healthStatus: health.status(),
    health: await health.json().catch(() => null),
    dealsStatus: deals.status(),
    dealsCount: (await deals.json().catch(() => null))?.deals?.length ?? null,
  };
}
