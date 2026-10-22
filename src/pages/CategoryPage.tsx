import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye, Newspaper } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, ErrorState, SkeletonCard, categoryTone } from '../components/ui';

/**
 * /category/:name — ranije je footer vodio na nepostojeću rutu (#15).
 * Sada je prava stranica koja koristi postojeći API filter po kategoriji.
 */
const KNOWN_CATEGORIES: Record<string, string> = {
  hardware: 'Hardware',
  hardver: 'Hardware',
  recenzije: 'Recenzija',
  recenzija: 'Recenzija',
  najave: 'Najave',
  vesti: 'Vesti',
  liste: 'Lista',
};

export default function CategoryPage() {
  const { name = '' } = useParams();
  const decoded = decodeURIComponent(name);
  const category = KNOWN_CATEGORIES[decoded.toLowerCase()] ?? decoded;

  const query = useQuery({
    queryKey: ['category-articles', category],
    queryFn: () => api.articles.list({ category, limit: 24 }),
  });

  const articles = query.data?.articles ?? [];

  return (
    <div className="section">
      <div className="container">
        <nav className="crumbs mb-6" aria-label="Putanja">
          <Link to="/">Početna</Link>
          <span className="sep" aria-hidden="true">/</span>
          <span className="text-white/80">{category}</span>
        </nav>

        <header className="mb-8 border-b border-white/[0.07] pb-6">
          <div className="mb-3 flex items-center gap-2.5">
            <Badge tone={categoryTone(category)}>{category}</Badge>
            <span className="font-mono text-xs text-white/50">{(query.data?.total ?? 0).toLocaleString('sr-Latn-RS')} objava</span>
          </div>
          <h1 className="page-title">{category}</h1>
        </header>

        {query.isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <SkeletonCard key={item} />
            ))}
          </div>
        ) : query.isError ? (
          <ErrorState title="Kategorija nije dostupna" onRetry={() => query.refetch()} />
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<Newspaper size={22} />}
            title={`Nema objava u kategoriji "${category}"`}
            message="Kada redakcija objavi tekst u ovoj kategoriji, pojaviće se ovde."
            action={
              <Link to="/" className="ui-btn br-primary ui-btn-sm">
                Sve vesti
              </Link>
            }
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article: any) => (
              <Card key={article.id} flush interactive className="group flex flex-col">
                <div className="relative aspect-[16/10] overflow-hidden bg-surface-0">
                  <img
                    src={article.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900&q=80'}
                    alt={article.title}
                    width={600}
                    height={375}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <Badge tone={categoryTone(article.category)} className="mb-2 self-start">
                    {article.category}
                  </Badge>
                  <Link to={`/article/${article.slug || article.id}`}>
                    <h2 className="card-title-link mb-2 line-clamp-2 font-display text-base font-semibold leading-snug">
                      {article.title}
                    </h2>
                  </Link>
                  <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-white/55">{article.excerpt}</p>
                  <span className="mt-auto flex items-center gap-1.5 font-mono text-xs text-white/45">
                    <Eye size={12} aria-hidden="true" /> {(article.views || 0).toLocaleString('sr-Latn-RS')} pregleda
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
