import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, Bookmark, ListChecks, MessageSquare, TrendingUp, Trophy, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import {
  Button, Card, CardHeader, ErrorState, Modal, SkeletonRows, Tabs,
} from '../components/ui';
import { ProfileHeroSkeleton } from '../components/profile/constants';
import { ProfileHeader, LevelCard } from '../components/profile/ProfileHeader';
import { ConnectedAccounts } from '../components/profile/ConnectedAccounts';
import { ProfileBadges, AccountPrivacySection, ProfileSettingsForm, ProfileTabsContent } from '../components/profile/ProfileSections';
import { AccountSecuritySection } from '../components/profile/AccountSecurity';

type ProfileTab = 'threads' | 'activity' | 'badges' | 'saved' | 'quests';

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
  const [editBio, setEditBio] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
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
      await api.users.updateProfile({ bio: editBio.trim(), avatar: editAvatar.trim() });
      updateUser({ bio: editBio.trim(), avatar: editAvatar.trim() });
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
          user={ownProfile}
          isOwner={isOwner}
          connectedCount={Object.keys(connectedAccounts).length}
          threadCount={userThreads.length}
          replyCount={replyCount}
          onEdit={() => setSettingsOpen(true)}
        />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <LevelCard user={ownProfile} />
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

            <ProfileBadges badges={badges} />

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

      {/* Uređivanje profila */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Uredi svoj profil"
        description="Prilagodi svoj gaming avatar i biografiju, upravljaj bezbednošću naloga."
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(false)}>
              Otkaži
            </Button>
            <Button size="sm" type="submit" form="profile-settings-form" loading={savingSettings}>
              Sačuvaj izmene
            </Button>
          </>
        }
      >
        <ProfileSettingsForm
          avatar={editAvatar}
          bio={editBio}
          onAvatarChange={setEditAvatar}
          onBioChange={setEditBio}
          onSubmit={handleSaveSettings}
        />
        {/* F-33 — 2FA (TOTP) + recovery kodovi */}
        <AccountSecuritySection />
        {/* F-09 — izvoz podataka i brisanje naloga (GDPR/ZZPL) */}
        <AccountPrivacySection onLogout={handleAccountDeleted} />
      </Modal>
    </div>
  );
}
