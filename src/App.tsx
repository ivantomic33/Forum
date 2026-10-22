import { Suspense, lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import Layout from './components/Layout';
import { SkeletonCard } from './components/ui';

/**
 * Route-level code splitting: početna strana je u glavnom bundle-u,
 * teške stranice (editor, admin, profil) se učitavaju na zahtev.
 */
const HomePage = lazy(() => import('./pages/HomeMagazine'));
const ArticlePage = lazy(() => import('./pages/ArticlePage'));
const ForumPage = lazy(() => import('./pages/ForumPage'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const CategoryPage = lazy(() => import('./pages/CategoryPage'));
const AdminReportsPage = lazy(() => import('./pages/AdminReportsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const NewsletterConfirmPage = lazy(() => import('./pages/NewsletterConfirmPage'));
// 2.6.0 — Deals / Popusti + Game Pages
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealPage = lazy(() => import('./pages/DealPage'));
const GamesPage = lazy(() => import('./pages/GamesPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
// F-34 — povratak sa OAuth provajdera i izbor korisničkog imena za nove naloge.
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'));
const OAuthCompleteSignupPage = lazy(() => import('./pages/OAuthCompleteSignupPage'));

/**
 * Globalni QueryClient — keširanje, deduplikacija i refetch server state-a.
 * staleTime: 60s (podaci sveži minut — nema refetcha na svakom mount-u),
 * retry: 1, refetchOnWindowFocus: false.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Skeletonski fallback dok se lena ruta učitava. */
function RouteFallback() {
  return (
    <div className="section">
      <div className="container" aria-busy="true">
        <span className="sr-only">Učitavanje stranice…</span>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <SkeletonCard key={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <a href="#main-content" className="skip-link">Preskoči na sadržaj</a>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="article/:id" element={<ArticlePage />} />
          <Route path="forum" element={<ForumPage />} />
          <Route path="category/:name" element={<CategoryPage />} />
          <Route path="forum/:subforum" element={<ForumPage />} />
          <Route path="thread/:id" element={<ThreadPage />} />
          {/* 2.6.0 — Deals / Popusti (javni URL je /deals; /popusti je alias) */}
          <Route path="deals" element={<DealsPage />} />
          <Route path="popusti" element={<DealsPage />} />
          <Route path="deals/:id" element={<DealPage />} />
          <Route path="games" element={<GamesPage />} />
          <Route path="games/:slug" element={<GamePage />} />
          <Route path="profile/:username" element={<ProfilePage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          {/* 2.6.2 — objedinjena pretraga (članci + forum + popusti) */}
          <Route path="search" element={<SearchPage />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="admin/reports" element={<AdminReportsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          {/* Tokeni stižu mejlom — ove rute moraju da postoje (F-03) */}
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset" element={<ResetPasswordPage />} />
          <Route path="verify" element={<VerifyEmailPage />} />
          <Route path="newsletter/confirm" element={<NewsletterConfirmPage />} />
          <Route path="auth/callback" element={<OAuthCallbackPage />} />
          <Route path="auth/complete-signup" element={<OAuthCompleteSignupPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      </Suspense>
      {/* Globalne notifikacije (Sonner) — tamna tema, donji desni ugao */}
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
    </BrowserRouter>
    </QueryClientProvider>
  );
}
