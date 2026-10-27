import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Bookmark, ListChecks, MessageSquare, Shield, SlidersHorizontal, TrendingUp, Trophy, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import {
  Button, Card, CardHeader, ErrorState, Modal, SkeletonRows, Tabs,
} from '../components/ui';
import { ProfileHeroSkeleton } from '../components/profile/constants';
import { ProfileHeader, LevelCard, ProfileQuickStats } from '../components/profile/ProfileHeader';
import { ConnectedAccounts } from '../components/profile/ConnectedAccounts';
import { ProfileBadges, AccountPrivacySection, ProfileSettingsForm, ProfileTabsContent } from '../components/profile/ProfileSections';
import { AccountSecuritySection } from '../components/profile/AccountSecurity';
import { SessionManagerSection } from '../components/profile/SessionManager';
import { PasskeysSection } from '../components/profile/PasskeysSection';
import { LoginStreakCard } from '../components/profile/LoginStreakCard';
import { ProfileGuestbook } from '../components/profile/ProfileGuestbook';
// F-7 — push je postojao ali nije bio montiran nigde; sada je uz mejl kanal.
import { PushNotificationsSection } from '../components/profile/PushNotificationsSection';
import { QuietHoursSection } from '../components/profile/QuietHoursSection';
import { ProfileTimeline } from '../components/profile/ProfileTimeline';
import { NewLoginAlertBanner } from '../components/profile/NewLoginAlertBanner';
import { NotificationEmailSection } from '../components/profile/NotificationEmailSection';

type ProfileTab = 'threads' | 'activity' | 'badges' | 'saved' | 'quests';

/** Pod-tabovi unutar "Uredi svoj profil" modala (#redizajn). */
type SettingsTab = 'profile' | 'security' | 'privacy';

const PROFILE_TABS: ProfileTab[] = ['threads', 'activity', 'badges', 'saved', 'quests'];

function tabFromSearch(value: string | null): ProfileTab | null {
  if (!value) return null;
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : null;
}

/**
 * ProfilePage — tanka orkestraciona komponenta.
 * UI je podeljen na components/profile/* (Header, Accounts, Badges, Settings, Tabs).
 */
export default function ProfilePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const logout = useAuthStore((state) => state.logout);

  const targetUsername = username || currentUser?.username || '';
  const isOwner = Boolean(currentUser && targetUsername && currentUser.username.toLowerCase() === targetUsername.toLowerCase());

  // `?tab=quests` / `?tab=badges` — na ove tabove vode notifikacije (kvest/bedž).
  // Ranije je link bio `/profile?tab=quests`, ruta bez korisničkog imena (404).
  const requestedTab = tabFromSearch(searchParams.get('tab'));
  const [activeTab, setActiveTab] = useState<ProfileTab>(requestedTab ?? 'threads');
  // Bez korisničkog imena u URL-u profil vodi na sebe (npr. link iz notifikacije
  // je nekad bio `/profile?tab=quests` — ruta bez `:username`, zato 404).
  useEffect(() => {
    if (!username && currentUser?.username) {
      const params = searchParams.toString();
      navigate(`/profile/${encodeURIComponent(currentUser.username)}${params ? `?${params}` : ''}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, currentUser?.username]);
  const [connectPlatform, setConnectPlatform] = useState<string | null>(null);
  const [connectValue, setConnectValue] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');

  // 6.x — link `?settings=security` (iz notifikacije „nova prijava“) otvara
  // modal direktno na Bezbednosti, gde je dugme „Odjavi sve uređaje“.
  useEffect(() => {
    const requested = searchParams.get('settings');
    if (!requested || !['profile', 'security', 'privacy'].includes(requested)) return;
    setSettingsTab(requested as SettingsTab);
    setSettingsOpen(true);
    const params = new URLSearchParams(searchParams);
    params.delete('settings');
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [editBio, setEditBio] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editCover, setEditCover] = useState('violet');
  const [savingSettings, setSavingSettings] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['profile', targetUsername],
    queryFn: () => api.users.get(targetUsername),
    enabled: Boolean(targetUsername),
    retry: 1,
  });

  const threadsQuery = useQuery({
    queryKey: ['profile-threads', targetUsername],
    queryFn: () => api.users.getUserThreads(targetUsername),
    enabled: Boolean(profileQuery.data),
  });

  const activityQuery = useQuery({
    queryKey: ['profile-activity', targetUsername],
    queryFn: () => api.users.getUserActivity(targetUsername),
    enabled: Boolean(profileQuery.data),
  });

  const repliesQuery = useQuery({
    queryKey: ['profile-replies', targetUsername],
    queryFn: () => api.users.getUserReplies(targetUsername),
    enabled: Boolean(profileQuery.data),
  });

  // Sačuvani članci i teme dolaze sa servera (`article_bookmarks` / `forum_bookmarks`).
  // localStorage ostaje samo kao fallback za goste (bez naloga).
  const savedQuery = useQuery({
    queryKey: ['profile-saved', targetUsername],
    queryFn: () => api.users.getSaved(targetUsername),
    enabled: isOwner && Boolean(profileQuery.data),
  });

  const questsQuery = useQuery({
    queryKey: ['profile-quests', targetUsername],
    queryFn: () => api.users.getQuests(targetUsername),
    enabled: isOwner && Boolean(profileQuery.data),
  });

  const profile = profileQuery.data;
  const ownProfile = profile ?? (isOwner ? currentUser : null);

  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) setActiveTab(requestedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedTab]);

  useEffect(() => {
    if (profile) {
      setEditBio(profile.bio || '');
      setEditAvatar(profile.avatar || '');
      setEditCover((profile as { coverPreset?: string | null }).coverPreset || 'violet');
    }
  }, [profile]);

  if (!targetUsername) {
    return (
      <ErrorState
        className="section container"
        title="Profil nije pronađen"
        message="Prijavi se ili otvori profil člana zajednice."
      />
    );
  }

  if (profileQuery.isLoading) {
    return (
      <div className="section" aria-busy="true">
        <div className="container max-w-6xl space-y-6">
          <ProfileHeroSkeleton />
          <SkeletonRows rows={3} />
        </div>
      </div>
    );
  }

  if (profileQuery.isError || !ownProfile) {
    return (
      <div className="section">
        <div className="container max-w-6xl">
          <ErrorState
            title="Profil nije dostupan"
            message="Korisnik nije pronađen ili profil trenutno ne može da se učita. Pokušaj ponovo."
            onRetry={() => profileQuery.refetch()}
          >
            <Link to="/forum" className="ui-btn br-secondary ui-btn-sm">
              Nazad na forum
            </Link>
          </ErrorState>
        </div>
      </div>
    );
  }

  const connectedAccounts: Record<string, string> = ownProfile.connectedAccounts || {};
  const userThreads: any[] = threadsQuery.data?.threads ?? [];
  const userActivities: any[] = activityQuery.data?.activities ?? [];
  const userReplies: any[] = repliesQuery.data?.replies ?? [];
  const savedArticles: any[] = savedQuery.data?.savedArticles ?? [];
  const savedThreads: any[] = savedQuery.data?.savedThreads ?? [];
  const quests: any[] = questsQuery.data?.quests ?? [];
  const badges: string[] = Array.isArray(ownProfile.badges) ? ownProfile.badges : [];
  const replyCount = Number.isFinite((ownProfile as any).replies) ? (ownProfile as any).replies : userReplies.length;
  const savedTabAvailable = isOwner;

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connectPlatform) return;
    const value = connectValue.trim();
    if (!value) {
      toast.error('Unesi korisničko ime ili ID naloga.');
      return;
    }
    setConnecting(true);
    try {
      const result = await api.users.connectAccount(connectPlatform, value);
      if (result.connectedAccounts) updateUser({ connectedAccounts: result.connectedAccounts });
      if (result.verifiedPlatforms) updateUser({ verifiedPlatforms: result.verifiedPlatforms } as any);
      // B-03 — poruka razlikuje verifikovan nalog (i +25 XP) od samo sačuvanog handle-a.
      const xp = result.awarded?.xp ? ` +${result.awarded.xp} XP` : '';
      if (result.verified === false) toast.warning(result.message);
      else toast.success(`${result.message}${xp}`);
      // 8 — konfete za nove bedževe / level-up (server javlja u `awarded`).
      if (result.awarded?.levelUp) {
        const { celebrateLevelUp } = await import('../lib/celebrate');
        celebrateLevelUp();
      } else if (result.awarded?.newBadges?.length) {
        const { celebrateBadge } = await import('../lib/celebrate');
        celebrateBadge(result.awarded.newBadges);
      }
      setConnectPlatform(null);
      setConnectValue('');
      profileQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || `Nalog za ${connectPlatform} nije mogao biti povezan.`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (platform: string) => {
    try {
      const result = await api.users.disconnectAccount(platform);
      if (result.connectedAccounts) updateUser({ connectedAccounts: result.connectedAccounts });
      toast.info(`Nalog za ${platform} je otkačen.`);
      profileQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || 'Nalog nije mogao biti otkačen.');
    }
  };

  // F-09 — posle brisanja naloga: odjavi lokalnu sesiju i vrati na početnu.
  const handleAccountDeleted = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleSaveSettings = async (event: React.FormEvent) => {    event.preventDefault();
    setSavingSettings(true);
    try {
      await api.users.updateProfile({ bio: editBio.trim(), avatar: editAvatar.trim(), coverPreset: editCover });
      updateUser({ bio: editBio.trim(), avatar: editAvatar.trim(), coverPreset: editCover } as any);
      setSettingsOpen(false);
      toast.success('Profil je uspešno ažuriran!');
      profileQuery.refetch();
    } catch (error: any) {
      toast.error(error?.message || 'Greška pri čuvanju profila.');
    } finally {
      setSavingSettings(false);
    }
  };

  const tabItems = [
    { id: 'threads' as const, label: 'Teme', icon: <MessageSquare size={14} />, count: userThreads.length },
    { id: 'activity' as const, label: 'Aktivnost', icon: <TrendingUp size={14} /> },
    {
      id: 'badges' as const,
      label: 'Bedževi',
      icon: <Award size={14} />,
      count: badges.length,
    },
    ...(savedTabAvailable
      ? [
          {
            id: 'saved' as const,
            label: 'Sačuvano',
            icon: <Bookmark size={14} />,
            count: savedArticles.length + savedThreads.length,
          },
          {
            id: 'quests' as const,
            label: 'Kvestovi',
            icon: <Trophy size={14} />,
            count: quests.filter((q) => q.completed).length,
          },
        ]
      : []),
  ];

  const changeTab = (value: string) => {
    const next = value as ProfileTab;
    setActiveTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'threads') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="section min-h-[92vh] pb-16" aria-labelledby="profile-name">
      <div className="container max-w-6xl space-y-5">
        <ProfileHeader
          user={{ ...ownProfile, badges }}
          isOwner={isOwner}
          connectedCount={Object.keys(connectedAccounts).length}
          threadCount={userThreads.length}
          replyCount={replyCount}
          onEdit={() => setSettingsOpen(true)}
        />

        {/* Nivo/XP/desktop rail je već u gaming kartici (PlayerCard) — leva
            kolona ostaje samo na ≥ lg, da se progress ne prikazuje dvaput. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="hidden space-y-5 lg:sticky lg:top-24 lg:block lg:self-start">
            <LevelCard user={ownProfile} />
            <ProfileQuickStats
              karma={Number(ownProfile.karma || 0)}
              solved={Number(ownProfile.solvedAnswers || 0)}
              badges={badges.length}
              threads={userThreads.length}
            />
          </div>

          <div className="space-y-5 lg:col-span-2">
            <ConnectedAccounts
              accounts={connectedAccounts}
              isOwner={isOwner}
              onConnect={(platformId) => {
                setConnectPlatform(platformId);
                setConnectValue('');
              }}
              onDisconnect={handleDisconnect}
            />

            {/* 6.x — poslednjih 5 poteza (puni spisak je u tabu „Aktivnost“). */}
            <ProfileTimeline
              activities={userActivities}
              username={targetUsername}
              onOpenAll={() => changeTab('activity')}
            />

            <ProfileGuestbook username={targetUsername} />

            <Card variant="static">
              <CardHeader
                title="Sadržaj profila"
                icon={<TrendingUp size={15} className="text-white/35" aria-hidden="true" />}
              />
              <Tabs
                ariaLabel="Sadržaj profila"
                variant="underline"
                value={activeTab}
                onChange={changeTab}
                items={tabItems}
              />
              <div className="pt-4">
                <ProfileTabsContent
                  activeTab={activeTab}
                  loading={threadsQuery.isLoading || activityQuery.isLoading || savedQuery.isLoading || questsQuery.isLoading}
                  threads={userThreads}
                  activities={userActivities}
                  savedArticles={savedArticles}
                  savedThreads={savedThreads}
                  quests={quests}
                  badges={badges}
                  isOwner={isOwner}
                  availableTabs={tabItems.map((item) => item.id)}
                />
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Povezivanje naloga */}
      <Modal
        open={Boolean(connectPlatform)}
        onClose={() => setConnectPlatform(null)}
        title={`Poveži ${connectPlatform ?? ''}`}
        description="Unesi korisničko ime, gamertag ili ID naloga za prikaz na profilu."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConnectPlatform(null)}>
              Otkaži
            </Button>
            <Button size="sm" type="submit" form="connect-account-form" loading={connecting}>
              Sačuvaj nalog
            </Button>
          </>
        }
      >
        <form id="connect-account-form" onSubmit={handleConnect}>
          <label htmlFor="connect-platform-username" className="mb-1 block text-sm font-semibold text-white/85">
            Korisničko ime naloga
          </label>
          <input
            id="connect-platform-username"
            type="text"
            value={connectValue}
            onChange={(event) => setConnectValue(event.target.value)}
            placeholder="npr. NexusGamer#1337"
            autoFocus
            className="ui-field"
          />
        </form>
      </Modal>

      {/* Uređivanje profila — pod-tabovi: Profil / Bezbednost / Privatnost */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Uredi svoj profil"
        description="Prilagodi svoj gaming avatar i biografiju, upravljaj bezbednošću naloga."
        size="2xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(false)}>
              Otkaži
            </Button>
            {settingsTab === 'profile' && (
              <Button size="sm" type="submit" form="profile-settings-form" loading={savingSettings}>
                Sačuvaj izmene
              </Button>
            )}
          </>
        }
      >
        <Tabs
          ariaLabel="Sekcije podešavanja"
          variant="pills"
          value={settingsTab}
          onChange={(value) => setSettingsTab(value as SettingsTab)}
          items={[
            { id: 'profile', label: 'Profil', icon: <User size={14} /> },
            { id: 'security', label: 'Bezbednost', icon: <Shield size={14} /> },
            { id: 'privacy', label: 'Privatnost', icon: <SlidersHorizontal size={14} /> },
          ]}
          className="mb-5 w-fit"
        />

        {settingsTab === 'profile' && (
          <ProfileSettingsForm
            avatar={editAvatar}
            bio={editBio}
            coverPreset={editCover}
            onAvatarChange={setEditAvatar}
            onBioChange={setEditBio}
            onCoverChange={setEditCover}
            onSubmit={handleSaveSettings}
          />
        )}

        {settingsTab === 'security' && (
          <div className="space-y-6">
            {/* 6.x — „nova prijava“ notifikacija vodi ovde sa CTA-om „Nisam ja“ */}
            <NewLoginAlertBanner />
            {/* F-33 — 2FA (TOTP) + recovery kodovi */}
            <AccountSecuritySection />
            {/* 5.2 — passkeys (WebAuthn) kao drugi faktor bez lozinke */}
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <PasskeysSection />
            </div>
            {/* 5.1 — aktivne sesije na svim uređajima */}
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <SessionManagerSection />
            </div>
          </div>
        )}

        {settingsTab === 'privacy' && (
          <div className="space-y-6">
            {/* 5.3 — dnevni login streak */}
            <LoginStreakCard />
            {/* 2.11.0 — mejl kanal + push: ovde korisnik odlučuje ŠTA i KAKO ga obaveštava */}
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <NotificationEmailSection />
            </div>
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <PushNotificationsSection />
            </div>
            {/* 6.x — tiši sati + tipovi za koje uređaj ne zvoni (inbox ostaje) */}
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <QuietHoursSection />
            </div>
            {/* F-09 — izvoz podataka i brisanje naloga (GDPR/ZZPL) */}
            <div className="border-t border-[var(--color-border-subtle)] pt-5">
              <AccountPrivacySection onLogout={handleAccountDeleted} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
