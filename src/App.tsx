﻿import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MaintenanceGate from './components/MaintenanceGate';
import LazyToaster from './components/LazyToaster';
import { SkeletonCard } from './components/ui';
import { AppQueryProvider, queryClient } from './lib/queryClient';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { LeaderboardSkeleton } from './pages/LeaderboardSkeleton';

// Globalni klijent (singleton) živi u `lib/queryClient` — re-export za postojeće pozivaoce.
export { queryClient };

/**
 * Route-level code splitting: početna strana je u glavnom bundle-u,
 * teške stranice (editor, admin, profil) se učitavaju na zahtev.
 */
const HomePage = lazy(() => import('./pages/HomeMagazine'));
const ArticlePage = lazy(() => import('./pages/ArticlePage'));
// 2.13.0 — vremenska linija jednog događaja („Priča se razvija“).
const EventPage = lazy(() => import('./pages/EventPage'));
const ForumPage = lazy(() => import('./pages/ForumPage'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
// N-07 — SEO-vredna rang-lista: skelet je deo glavnog chunka, a sama stranica
// (i njen animirani deo) se učitava leno; `lazyWithRetry` ponovo pokušava ako
// chunk padne sa mreže (posle deploy-a stari heš više ne postoji).
export const LeaderboardPage = lazyWithRetry(() => import('./pages/LeaderboardPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const TermsPage = lazy(() => import('./pages/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const CategoryPage = lazy(() => import('./pages/CategoryPage'));
const AdminReportsPage = lazy(() => import('./pages/AdminReportsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const NewsletterConfirmPage = lazy(() => import('./pages/NewsletterConfirmPage'));
// 2.6.0 — Deals / Popusti + Game Pages
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealPage = lazy(() => import('./pages/DealPage'));
const GamesPage = lazy(() => import('./pages/GamesPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
// 2.8.0 - pojedinacni vodic.
const GuidePage = lazy(() => import('./pages/GuidePage'));
// F-5 — korisničke liste igara (javna SEO stranica `/collections/:slug`).
const CollectionsPage = lazy(() => import('./pages/CollectionsPage'));
const CollectionPage = lazy(() => import('./pages/CollectionPage'));
// F-7 — offline skela (service worker je servira kada mreža padne).
const OfflinePage = lazy(() => import('./pages/OfflinePage'));
// F-11 — kalkulator build-a (kategorija „Hardver“) + deljivi build.
const BuildPlannerPage = lazy(() => import('./pages/BuildPlannerPage'));
const SharedBuildPage = lazy(() =>
  import('./pages/BuildPlannerPage').then((module) => ({ default: module.SharedBuildPage })),
);
// F-34 — povratak sa OAuth provajdera i izbor korisničkog imena za nove naloge.
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'));
const OAuthCompleteSignupPage = lazy(() => import('./pages/OAuthCompleteSignupPage'));

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
    <AppQueryProvider>
      <BrowserRouter>
      <MaintenanceGate>
      <a href="#main-content" className="skip-link">Preskoči na sadržaj</a>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="article/:id" element={<ArticlePage />} />
          <Route path="event/:eventId" element={<EventPage />} />
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
          {/* 2.8.0 - vodic (javna SEO stranica). */}
          <Route path="games/:gameSlug/guides/:guideSlug" element={<GuidePage />} />
          {/* F-5 — kolekcije/liste igara */}
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="collections/:slug" element={<CollectionPage />} />
          <Route path="offline" element={<OfflinePage />} />
          {/* F-11 — kalkulator build-a */}
          <Route path="build-planner" element={<BuildPlannerPage />} />
          <Route path="build/:shareId" element={<SharedBuildPage />} />
          <Route path="profile/:username" element={<ProfilePage />} />
          {/* N-07 — skelet stranice (naslov, tabovi, podijum, tabela) je već u
              glavnom chunku; ovaj fallback se vidi samo prvi put dok stiže chunk. */}
          <Route
            path="leaderboard"
            element={
              <Suspense fallback={<LeaderboardSkeleton />}>
                <LeaderboardPage />
              </Suspense>
            }
          />
          {/* 2.6.2 — objedinjena pretraga (članci + forum + popusti) */}
          <Route path="search" element={<SearchPage />} />
          <Route path="admin" element={<AdminDashboard />} />
          <Route path="admin/reports" element={<AdminReportsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          {/* 2.11.0 — privatne poruke (lista + nit) */}
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:id" element={<MessagesPage />} />
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
      </MaintenanceGate>
      {/* Globalne notifikacije (Sonner) — tamna tema, donji desni ugao; leno
          (N-06: biblioteka ostaje u svom chunku, ne u glavnom). */}
      <LazyToaster />
    </BrowserRouter>
    </AppQueryProvider>
  );
}
