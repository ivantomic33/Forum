import {
  FileText,
  Users,
  MessageSquare,
  Plus,
  Mail,
  Flag,
  History,
  ExternalLink,
  Pencil,
  Trash2,
  Search,
  CheckCircle2,
  XCircle,
  Download,
  Copy,
  Pin,
  Lock,
  Unlock,
  Eye,
  ArrowRight,
  Shield,
  ShieldAlert,
  Sliders,
  Send,
  Award,
  MessageCircle,
  Radio,
  Zap,
  Image as ImageIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import CountUp from 'react-countup';
import { api } from '../lib/api';
import RichTextEditor from '../components/RichTextEditor';
import { ImageUpload } from '../components/ui';
import { useAuthStore } from '../store/authStore';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Feedback';
import { MediaGallery } from '../components/ui/MediaGallery';

type AdminTab = 'articles' | 'users' | 'forum' | 'comments' | 'reports' | 'audit' | 'newsletter' | 'media' | 'settings';

const ARTICLE_CATEGORIES = ['Vesti', 'Hardware', 'Najave', 'Recenzija', 'Lista', 'Specijal'];
const SUBFORUMS = [
  { id: 'all', name: 'Svi potforumi' },
  { id: 'pc-gaming', name: 'PC Gaming' },
  { id: 'consoles', name: 'Consoles' },
  { id: 'esports', name: 'Esports' },
  { id: 'hardware', name: 'Hardware' },
  { id: 'lfg', name: 'LFG' },
  { id: 'off-topic', name: 'Off-Topic' },
];

/** B-07 — kostur dok se `initSession()` završava (bez lažnog redirecta za admina). */
function AdminGuardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10" role="status" aria-label="Učitavanje administracije">
      <Skeleton className="h-9 w-56 rounded-md" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-lg" />
      <Skeleton className="mt-4 h-64 w-full rounded-lg" />
    </div>
  );
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('articles');
  const currentUser = useAuthStore((s) => s.user);
  // B-07 — dok `initSession()` ne završi, `user` je `null` i guard bi lažno
  // izbacio admina na /login (koji ga posle vraća na početnu).
  const authLoading = useAuthStore((s) => s.isLoading);
  // F-32 — guard na ruti: anonimni/non-staff ne vide ni kostur admin panela.
  const isStaff = currentUser?.role === 'admin' || currentUser?.role === 'moderator';
  const isAdmin = currentUser?.role === 'admin';

  const queryClient = useQueryClient();

  // Filteri
  const [articleSearch, setArticleSearch] = useState('');
  const [articleCategoryFilter, setArticleCategoryFilter] = useState('all');
  const [articleStatusFilter, setArticleStatusFilter] = useState('all');

  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');

  const [forumSearch, setForumSearch] = useState('');
  const [forumSubforumFilter, setForumSubforumFilter] = useState('all');
  const [forumStatusFilter, setForumStatusFilter] = useState('all');

  const [auditSearch, setAuditSearch] = useState('');
  const [subscriberSearch, setSubscriberSearch] = useState('');
  /** 2.6.2 — filter liste pretplatnika po segmentu (server filtrira). */
  const [subscriberSegment, setSubscriberSegment] = useState<'active' | 'pending' | 'unsubscribed' | 'all'>('active');
  /** 2.6.2 — email za koji se trenutno šalje ponovna potvrda. */
  const [resending, setResending] = useState<string | null>(null);
  const [commentSearch, setCommentSearch] = useState('');

  // Modal za kreiranje / izmenu članka
  const [articleModalOpen, setArticleModalOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<any | null>(null);
  const [articleTitle, setArticleTitle] = useState('');
  const [articleCategory, setArticleCategory] = useState('Vesti');
  const [articleCoverImage, setArticleCoverImage] = useState('');
  const [articleExcerpt, setArticleExcerpt] = useState('');
  const [articleContent, setArticleContent] = useState('');
  const [articleStatus, setArticleStatus] = useState<'published' | 'draft'>('published');
  const [articleIsFeatured, setArticleIsFeatured] = useState(false);
  // Review scorecard state
  const [articleReviewScore, setArticleReviewScore] = useState<string>('');
  const [articleReviewVerdict, setArticleReviewVerdict] = useState<string>('');
  const [articleReviewPros, setArticleReviewPros] = useState<string>('');
  const [articleReviewCons, setArticleReviewCons] = useState<string>('');

  // Modal za banovanje
  const [banTarget, setBanTarget] = useState<any>(null);
  const [banReason, setBanReason] = useState('');
  const [banDays, setBanDays] = useState<string>('7');
  const [banMuteHours, setBanMuteHours] = useState<string>('0');
  const [banSubmitting, setBanSubmitting] = useState(false);

  // Modal za dodelu bedža / nagrade
  const [awardTarget, setAwardTarget] = useState<any>(null);
  const [awardBadgeCode, setAwardBadgeCode] = useState('');
  const [awardXpBonus, setAwardXpBonus] = useState(100);
  const [awardSubmitting, setAwardSubmitting] = useState(false);

  // Newsletter broadcast modal
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  /** 2.6.2 — segment kampanje i opcioni „test sebi“ (jedan mejl). */
  const [broadcastSegment, setBroadcastSegment] = useState<'active' | 'pending' | 'all'>('active');
  const [broadcastTest, setBroadcastTest] = useState('');
  const [broadcastSubmitting, setBroadcastSubmitting] = useState(false);

  // Settings forma
  const [announcementActive, setAnnouncementActive] = useState(false);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementTone, setAnnouncementTone] = useState<'info' | 'warning' | 'danger'>('info');
  const [announcementLink, setAnnouncementLink] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // TanStack Query dohvat podataka
  const { data: statsData } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.admin.stats(),
    enabled: isStaff,
  });

  const { data: articlesData } = useQuery({
    queryKey: ['admin', 'articles'],
    queryFn: () => api.articles.list({ limit: 100 }),
    enabled: isStaff,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.users.listAll(),
    enabled: isStaff,
  });

  const { data: threadsData } = useQuery({
    queryKey: ['admin', 'threads'],
    queryFn: () => api.forum.listThreads('all'),
    enabled: isStaff,
  });

  const { data: reportsData } = useQuery({
    queryKey: ['admin', 'reports', 'pending'],
    queryFn: () => api.reports.list('pending'),
    enabled: isStaff,
    refetchInterval: 30_000,
  });

  const { data: auditData } = useQuery({
    queryKey: ['admin', 'audit-log'],
    queryFn: () => api.admin.auditLog(100),
    enabled: isStaff && isAdmin,
  });

  const { data: newsletterData } = useQuery({
    queryKey: ['admin', 'newsletter', subscriberSegment],
    queryFn: () => api.newsletter.subscribers({ segment: subscriberSegment, limit: 200 }),
    enabled: isStaff && isAdmin,
  });

  const { data: commentsData } = useQuery({
    queryKey: ['admin', 'comments'],
    queryFn: () => api.admin.listComments(50),
    enabled: isStaff,
  });

  const { data: settingsData } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const res = await api.admin.getSettings();
      if (!settingsLoaded && res.settings) {
        setAnnouncementActive(res.settings.announcement?.active || false);
        setAnnouncementMessage(res.settings.announcement?.message || '');
        setAnnouncementTone(res.settings.announcement?.tone || 'info');
        setAnnouncementLink(res.settings.announcement?.link || '');
        setRegistrationOpen(res.settings.registrationOpen !== false);
        setMaintenanceMode(res.settings.maintenanceMode || false);
        setSettingsLoaded(true);
      }
      return res;
    },
    enabled: isStaff && isAdmin,
  });

  // Mutacije
  const createArticleMutation = useMutation({
    mutationFn: (payload: { title: string; content: string; excerpt: string; category: string; coverImage?: string; status: 'published' | 'draft' }) =>
      api.articles.create(payload),
    onSuccess: () => {
      toast.success('Članak je uspešno objavljen!');
      closeArticleModal();
      queryClient.invalidateQueries({ queryKey: ['admin', 'articles'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri kreiranju članka.'),
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.articles.update(id, payload),
    onSuccess: () => {
      toast.success('Članak je uspešno ažuriran!');
      closeArticleModal();
      queryClient.invalidateQueries({ queryKey: ['admin', 'articles'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri ažuriranju članka.'),
  });

  const deleteArticleMutation = useMutation({
    mutationFn: (id: string) => api.articles.delete(id),
    onSuccess: () => {
      toast.success('Članak je obrisan.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'articles'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri brisanju članka.'),
  });

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => api.users.setRole(userId, role),
    onSuccess: () => {
      toast.success('Uloga korisnika je ažurirana.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri ažuriranju uloge.'),
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (id: string) => api.admin.deleteComment(id),
    onSuccess: () => {
      toast.success('Komentar je uspešno obrisan.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'comments'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri brisanju komentara.'),
  });

  const submitAward = async () => {
    if (!awardTarget) return;
    if (!awardBadgeCode && (!awardXpBonus || awardXpBonus <= 0)) {
      toast.error('Izaberite bedž ili unesite XP bonus.');
      return;
    }
    setAwardSubmitting(true);
    try {
      await api.admin.awardUser(awardTarget.id, {
        badgeCode: awardBadgeCode || undefined,
        xpBonus: awardXpBonus > 0 ? awardXpBonus : undefined,
      });
      toast.success(`Nagrada uspešno dodeljena korisniku ${awardTarget.username}!`);
      setAwardTarget(null);
      setAwardBadgeCode('');
      setAwardXpBonus(100);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (err: any) {
      toast.error(err?.message || 'Dodeljivanje nagrade nije uspelo.');
    } finally {
      setAwardSubmitting(false);
    }
  };

  const resendConfirmation = async (email: string) => {
    setResending(email);
    try {
      const res = await api.newsletter.resend(email);
      if (res.sent) toast.success(res.message || 'Potvrda je ponovo poslata.');
      else toast.error(res.message || 'Mejl nije poslat.');
    } catch (err: any) {
      toast.error(err?.message || 'Potvrda nije poslata.');
    } finally {
      setResending(null);
    }
  };

  const submitBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastSubject.trim() || !broadcastContent.trim()) {
      toast.error('Naslov i sadržaj biltena su obavezni.');
      return;
    }
    setBroadcastSubmitting(true);
    try {
      const res = await api.admin.broadcast({
        subject: broadcastSubject.trim(),
        content: broadcastContent.trim(),
        segment: broadcastSegment,
        ...(broadcastTest ? { testEmail: broadcastTest } : {}),
      });
      toast.success(res.message || 'Newsletter uspešno poslat!');
      if (!broadcastTest) {
        setBroadcastOpen(false);
        setBroadcastSubject('');
        setBroadcastContent('');
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (err: any) {
      toast.error(err?.message || 'Slanje biltena nije uspelo.');
    } finally {
      setBroadcastSubmitting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.admin.updateSettings({
        announcement: {
          active: announcementActive,
          message: announcementMessage,
          tone: announcementTone,
          link: announcementLink,
        },
        registrationOpen,
        maintenanceMode,
      });
      toast.success('Podešavanja sajta su uspešno sačuvana!');
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-settings'] });
    } catch (err: any) {
      toast.error(err?.message || 'Čuvanje podešavanja nije uspelo.');
    }
  };

  // Modal Handlers
  const openCreateArticleModal = () => {
    setEditingArticle(null);
    setArticleTitle('');
    setArticleCategory('Vesti');
    setArticleCoverImage('');
    setArticleExcerpt('');
    setArticleContent('');
    setArticleStatus('published');
    setArticleIsFeatured(false);
    setArticleReviewScore('');
    setArticleReviewVerdict('');
    setArticleReviewPros('');
    setArticleReviewCons('');
    setArticleModalOpen(true);
  };

  const openEditArticleModal = (art: any) => {
    setEditingArticle(art);
    setArticleTitle(art.title || '');
    setArticleCategory(art.category || 'Vesti');
    setArticleCoverImage(art.coverImage || '');
    setArticleExcerpt(art.excerpt || '');
    setArticleContent(art.content || '');
    setArticleStatus(art.status === 'draft' ? 'draft' : 'published');
    setArticleIsFeatured(Boolean(art.isFeatured));
    setArticleReviewScore(art.reviewScorecard?.score !== undefined ? String(art.reviewScorecard.score) : '');
    setArticleReviewVerdict(art.reviewScorecard?.verdict || '');
    setArticleReviewPros(Array.isArray(art.reviewScorecard?.pros) ? art.reviewScorecard.pros.join('\n') : '');
    setArticleReviewCons(Array.isArray(art.reviewScorecard?.cons) ? art.reviewScorecard.cons.join('\n') : '');
    setArticleModalOpen(true);
  };

  const closeArticleModal = () => {
    setArticleModalOpen(false);
    setEditingArticle(null);
  };

  const handleSubmitArticle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!articleTitle.trim()) {
      toast.error('Naslov članka je obavezan.');
      return;
    }
    if (!articleContent.trim() || articleContent.trim().length < 20) {
      toast.error('Sadržaj članka mora imati najmanje 20 karaktera.');
      return;
    }

    const pros = articleReviewPros
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);
    const cons = articleReviewCons
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean);
    const scoreNum = articleReviewScore ? parseFloat(articleReviewScore) : undefined;

    const reviewScorecard =
      scoreNum !== undefined || articleReviewVerdict.trim() || pros.length > 0 || cons.length > 0
        ? {
            score: scoreNum,
            verdict: articleReviewVerdict.trim() || undefined,
            pros: pros.length > 0 ? pros : undefined,
            cons: cons.length > 0 ? cons : undefined,
          }
        : null;

    const payload = {
      title: articleTitle.trim(),
      category: articleCategory,
      coverImage: articleCoverImage.trim() || undefined,
      excerpt: articleExcerpt.trim(),
      content: articleContent,
      status: articleStatus,
      isFeatured: articleIsFeatured,
      reviewScorecard,
    };

    if (editingArticle) {
      updateArticleMutation.mutate({ id: editingArticle.id, payload });
    } else {
      createArticleMutation.mutate(payload);
    }
  };

  const handleDeleteArticle = (id: string, title: string) => {
    if (!window.confirm(`Da li ste sigurni da želite da obrišete članak "${title}"?`)) return;
    deleteArticleMutation.mutate(id);
  };

  const handleRoleChange = (targetUser: any, newRole: string) => {
    if (targetUser.id === currentUser?.id) {
      toast.error('Ne možete promeniti sopstvenu ulogu.');
      return;
    }
    if (targetUser.role === 'admin' && !isAdmin) {
      toast.error('Samo administrator može menjati drugog administratora.');
      return;
    }
    setRoleMutation.mutate({ userId: targetUser.id, role: newRole });
  };

  const submitBan = async () => {
    if (!banTarget) return;
    setBanSubmitting(true);
    try {
      const muteH = Number(banMuteHours) || 0;
      if (muteH > 0) {
        // Samo mute
        await api.users.setRole(banTarget.id, undefined, undefined, undefined, undefined, muteH);
        toast.success(`${banTarget.username} je ućutkan (mute) na ${muteH}h.`);
      } else {
        // Ban
        if (banReason.trim().length < 3) {
          toast.error('Unesite razlog bana (najmanje 3 karaktera).');
          setBanSubmitting(false);
          return;
        }
        const days = banDays === 'permanent' ? null : Number(banDays);
        await api.users.setRole(banTarget.id, undefined, true, banReason.trim(), days);
        toast.success(`${banTarget.username} je banovan.`);
      }
      setBanTarget(null);
      setBanReason('');
      setBanMuteHours('0');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (error: any) {
      toast.error(error?.message || 'Akcija nije uspela.');
    } finally {
      setBanSubmitting(false);
    }
  };

  const unmute = async (user: any) => {
    try {
      await api.users.setRole(user.id, undefined, undefined, undefined, undefined, 0);
      toast.success(`Mute za ${user.username} je uklonjen.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (error: any) {
      toast.error(error?.message || 'Uklanjanje mute-a nije uspelo.');
    }
  };

  const unban = async (user: any) => {
    try {
      await api.users.setRole(user.id, undefined, false);
      toast.success(`${user.username} je odbanovan.`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (error: any) {
      toast.error(error?.message || 'Odban nije uspeo.');
    }
  };

  const moderateThreadMutation = useMutation({
    mutationFn: ({ threadId, body }: { threadId: string; body: Record<string, boolean | undefined> }) =>
      api.forum.moderate(threadId, body as Record<string, boolean>),
    onSuccess: () => {
      toast.success('Moderaciona akcija je primenjena.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'threads'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri moderaciji teme.'),
  });

  const handleModerateThread = (threadId: string, action: 'pin' | 'lock' | 'delete', current?: boolean) => {
    if (action === 'delete' && !window.confirm('Da li ste sigurni da želite da obrišete ovu temu?')) return;
    const body =
      action === 'delete' ? { deleteThread: true } : action === 'pin' ? { isPinned: !current } : { isLocked: !current };
    moderateThreadMutation.mutate({ threadId, body });
  };

  const resolveReport = async (id: string, nextStatus: 'resolved' | 'dismissed') => {
    try {
      await api.reports.resolve(id, { status: nextStatus });
      toast.success(nextStatus === 'resolved' ? 'Prijava je označena kao rešena.' : 'Prijava je odbačena.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] });
    } catch (err: any) {
      toast.error(err?.message || 'Greška pri rešavanju prijave.');
    }
  };

  // CSV export i copy za newsletter
  const exportSubscribersCsv = (list: any[]) => {
    if (!list || list.length === 0) {
      toast.error('Nema pretplatnika za izvoz.');
      return;
    }
    const headers = ['Email', 'Datum prijave', 'Status'];
    const rows = list.map((s) => [
      `"${(s.email || '').replace(/"/g, '""')}"`,
      `"${s.subscribedAt ? new Date(s.subscribedAt).toISOString() : ''}"`,
      `"${s.unsubscribedAt ? 'Odjavljen' : s.isActive ? 'Aktivan' : 'Na čekanju'}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `newsletter-pretplatnici-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Izvezeno ${list.length} pretplatnika.`);
  };

  const copyAllEmails = (list: any[]) => {
    if (!list || list.length === 0) {
      toast.error('Nema adresa za kopiranje.');
      return;
    }
    const emails = list.map((s) => s.email).filter(Boolean).join(', ');
    navigator.clipboard.writeText(emails);
    toast.success(`Kopirano ${list.length} email adresa u clipboard.`);
  };

  // Filtrirane liste
  const rawArticles = articlesData?.articles || [];
  const filteredArticles = useMemo(() => {
    return rawArticles.filter((art: any) => {
      const matchSearch =
        !articleSearch ||
        art.title?.toLowerCase().includes(articleSearch.toLowerCase()) ||
        art.author?.toLowerCase().includes(articleSearch.toLowerCase());
      const matchCat = articleCategoryFilter === 'all' || art.category === articleCategoryFilter;
      const matchStatus = articleStatusFilter === 'all' || art.status === articleStatusFilter;
      return matchSearch && matchCat && matchStatus;
    });
  }, [rawArticles, articleSearch, articleCategoryFilter, articleStatusFilter]);

  const rawUsers = usersData?.users || [];
  const filteredUsers = useMemo(() => {
    return rawUsers.filter((u: any) => {
      const matchSearch =
        !userSearch ||
        u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email?.toLowerCase().includes(userSearch.toLowerCase());
      const matchRole = userRoleFilter === 'all' || u.role === userRoleFilter;
      const matchStatus =
        userStatusFilter === 'all'
          ? true
          : userStatusFilter === 'banned'
            ? u.isBanned
            : !u.isBanned;
      return matchSearch && matchRole && matchStatus;
    });
  }, [rawUsers, userSearch, userRoleFilter, userStatusFilter]);

  const rawThreads = threadsData?.threads || [];
  const filteredThreads = useMemo(() => {
    return rawThreads.filter((thr: any) => {
      const matchSearch =
        !forumSearch ||
        thr.title?.toLowerCase().includes(forumSearch.toLowerCase()) ||
        thr.author?.toLowerCase().includes(forumSearch.toLowerCase());
      const matchSub = forumSubforumFilter === 'all' || thr.subforum === forumSubforumFilter;
      const matchStatus =
        forumStatusFilter === 'all'
          ? true
          : forumStatusFilter === 'pinned'
            ? thr.isPinned
            : forumStatusFilter === 'locked'
              ? thr.isLocked
              : true;
      return matchSearch && matchSub && matchStatus;
    });
  }, [rawThreads, forumSearch, forumSubforumFilter, forumStatusFilter]);

  const rawAuditEntries = auditData?.entries || [];
  const filteredAudit = useMemo(() => {
    return rawAuditEntries.filter((e: any) => {
      if (!auditSearch) return true;
      const q = auditSearch.toLowerCase();
      return (
        e.actorUsername?.toLowerCase().includes(q) ||
        e.targetUsername?.toLowerCase().includes(q) ||
        e.action?.toLowerCase().includes(q)
      );
    });
  }, [rawAuditEntries, auditSearch]);

  const rawSubscribers = newsletterData?.subscribers || [];
  // 2.6.2 — segmenti stižu sa servera (`counts`), pretraga ostaje lokalna nad
  // već učitаним segmentom; CSV ide sa servera (`/newsletter/export`).
  const subscriberCounts = newsletterData?.counts ?? { all: rawSubscribers.length, active: 0, pending: 0, unsubscribed: 0 };
  const filteredSubscribers = useMemo(() => {
    return rawSubscribers.filter((s: any) => {
      if (!subscriberSearch) return true;
      return s.email?.toLowerCase().includes(subscriberSearch.toLowerCase());
    });
  }, [rawSubscribers, subscriberSearch]);

  const rawComments = commentsData?.comments || [];
  const filteredComments = useMemo(() => {
    return rawComments.filter((c: any) => {
      if (!commentSearch) return true;
      const q = commentSearch.toLowerCase();
      return (
        c.author?.toLowerCase().includes(q) ||
        c.content?.toLowerCase().includes(q)
      );
    });
  }, [rawComments, commentSearch]);

  const pendingReportsCount = reportsData?.total ?? reportsData?.reports?.length ?? 0;

  // F-32 — guard: dok se sesija učitava ne odlučujemo ništa; anonimni → /login,
  // prijavljeni bez ovlašćenja → početna.
  if (authLoading) return <AdminGuardSkeleton />;
  if (!isStaff) {
    return <Navigate to={currentUser ? '/' : '/login?next=/admin'} replace />;
  }

  const stats = [
    { label: 'Ukupno članova', value: statsData?.totalUsers ?? 0, change: 'Korisnici', icon: Users, color: 'text-[var(--color-primary-fg)]' },
    { label: 'Članaka', value: statsData?.totalArticles ?? 0, change: `${statsData?.publishedArticles ?? 0} objavljeno`, icon: FileText, color: 'text-cyan-300' },
    { label: 'Forum tema', value: statsData?.totalThreads ?? 0, change: 'Diskusije', icon: MessageSquare, color: 'text-[var(--color-accent-green)]' },
    { label: 'Newsletter', value: statsData?.totalSubscribers ?? 0, change: 'Pretplate', icon: Mail, color: 'text-[var(--color-accent-amber)]' },
    { label: 'Ukupno pregleda', value: statsData?.totalViews ?? 0, change: 'Članci i teme', icon: Eye, color: 'text-purple-400' },
  ];

  const tabs: Array<{ id: AdminTab; label: string; icon: any; badge?: number }> = [
    { id: 'articles', label: 'Članci', icon: FileText },
    { id: 'users', label: 'Korisnici', icon: Users },
    { id: 'forum', label: 'Forum', icon: MessageSquare },
    { id: 'comments', label: 'Komentari', icon: MessageCircle, badge: rawComments.length },
    { id: 'reports', label: 'Prijave', icon: Flag, badge: pendingReportsCount },
    ...(isAdmin
      ? [
          { id: 'audit' as AdminTab, label: 'Revizorski log', icon: History },
          { id: 'newsletter' as AdminTab, label: 'Newsletter', icon: Mail },
          { id: 'media' as AdminTab, label: 'Mediji', icon: ImageIcon },
          { id: 'settings' as AdminTab, label: 'Podešavanja', icon: Sliders },
        ]
      : []),
  ];

  return (
    <div className="section">
      <div className="container">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="page-title mb-2">Admin Panel</h1>
            <p className="text-white/55">
              Upravljaj portalom, člancima, korisnicima i moderacijom zajednice{' '}
              {currentUser?.role === 'moderator' && (
                <span className="text-[var(--color-accent-amber)] font-medium">(Moderatorski pristup)</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/admin/reports"
              className="ui-btn br-secondary flex items-center gap-2 relative"
            >
              <Flag size={16} />
              <span>Moderacioni red</span>
              {pendingReportsCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold bg-[var(--color-accent-amber)] text-black rounded-full">
                  {pendingReportsCount}
                </span>
              )}
            </Link>
            <button onClick={openCreateArticleModal} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              Novi članak
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/[0.09] bg-surface-1 p-5 transition hover:border-white/[0.18]">
              <div className="flex items-start justify-between mb-4">
                <stat.icon className={stat.color} size={28} />
                <span className="text-xs text-[var(--color-accent-green)] font-semibold">{stat.change}</span>
              </div>
              <div className="text-3xl font-bold mb-1">
                <CountUp end={stat.value} duration={1.2} separator="." useEasing />
              </div>
              <div className="text-xs text-white/50">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Glavni Tabovi */}
        <div className="rounded-lg border border-white/[0.09] bg-surface-1 overflow-hidden">
          <div className="flex border-b border-white/10 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-semibold transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-[var(--color-primary-hover)] border-b-2 border-[var(--color-primary)] bg-white/[0.02]'
                    : 'text-white/55 hover:text-white'
                }`}
              >
                <tab.icon size={18} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="rounded-full bg-[var(--color-accent-amber)] px-2 py-0.5 text-xs font-bold text-black">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-6 md:p-8">
            {/* TAB: ČLANCI */}
            {activeTab === 'articles' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">Upravljanje člancima ({filteredArticles.length})</h2>
                    <p className="text-xs text-white/50 mt-1">Pregledaj, uređuj, objavljuj ili briši članke na portalu.</p>
                  </div>
                  <button onClick={openCreateArticleModal} className="btn-primary text-xs px-3 py-2 flex items-center gap-1.5">
                    <Plus size={14} /> Dodaj novi članak
                  </button>
                </div>

                {/* Filteri za članke */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži po naslovu ili autoru..."
                      value={articleSearch}
                      onChange={(e) => setArticleSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                  <select
                    value={articleCategoryFilter}
                    onChange={(e) => setArticleCategoryFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">Sve kategorije</option>
                    {ARTICLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select
                    value={articleStatusFilter}
                    onChange={(e) => setArticleStatusFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">Svi statusi</option>
                    <option value="published">Objavljeni</option>
                    <option value="draft">Draftovi</option>
                  </select>
                </div>

                {/* Lista članaka */}
                <div className="space-y-3">
                  {filteredArticles.length === 0 ? (
                    <div className="py-12 text-center text-white/40">Nema članaka koji odgovaraju pretrazi.</div>
                  ) : (
                    filteredArticles.map((art: any) => (
                      <div
                        key={art.id}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/[0.14] transition"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          {art.coverImage ? (
                            <img
                              src={art.coverImage}
                              alt={art.title}
                              className="w-16 h-16 rounded-lg object-cover flex-shrink-0 border border-white/10"
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0 border border-white/10 text-white/30">
                              <FileText size={24} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <h3 className="font-semibold text-white truncate max-w-xl mb-1">{art.title}</h3>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                              <span className="font-medium text-[var(--color-primary-fg)]">{art.category}</span>
                              <span>·</span>
                              <span>Autor: {art.author}</span>
                              <span>·</span>
                              <Badge tone={art.status === 'published' ? 'success' : 'warning'}>
                                {art.status === 'published' ? 'Objavljeno' : 'Draft'}
                              </Badge>
                              {art.isFeatured && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-accent-amber)] bg-[var(--color-accent-amber)]/10 px-1.5 py-0.5 rounded border border-[var(--color-accent-amber)]/30">
                                  ★ HERO
                                </span>
                              )}
                              {art.reviewScorecard?.score !== undefined && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-300 bg-purple-900/30 px-1.5 py-0.5 rounded border border-purple-500/30">
                                  Ocena: {art.reviewScorecard.score}/10
                                </span>
                              )}
                              <span>·</span>
                              <span>{art.views || 0} pregleda</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                          <Link
                            to={`/article/${art.slug || art.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn br-secondary ui-btn-sm flex items-center gap-1.5 text-white/80 hover:text-white"
                            title="Pogledaj na portalu"
                          >
                            <ExternalLink size={14} />
                            <span>Pogledaj</span>
                          </Link>
                          <button
                            onClick={() => openEditArticleModal(art)}
                            className="ui-btn br-secondary ui-btn-sm flex items-center gap-1.5 text-[var(--color-primary-fg)] hover:text-white"
                            title="Izmeni članak"
                          >
                            <Pencil size={14} />
                            <span>Izmeni</span>
                          </button>
                          <button
                            onClick={() => handleDeleteArticle(art.id, art.title)}
                            className="ui-btn br-secondary ui-btn-sm flex items-center gap-1.5 text-[var(--color-accent-red)] hover:bg-[var(--color-accent-red)]/10"
                            title="Obriši članak"
                          >
                            <Trash2 size={14} />
                            <span>Obriši</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: KORISNICI */}
            {activeTab === 'users' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Upravljanje korisnicima ({filteredUsers.length})</h2>
                  <p className="text-xs text-white/50 mt-1">Pregledaj registrovane članove, dodeljuj uloge i primenjuj privremene ili trajne banove.</p>
                </div>

                {/* Filteri za korisnike */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži po korisničkom imenu ili emailu..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                  <select
                    value={userRoleFilter}
                    onChange={(e) => setUserRoleFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">Sve uloge</option>
                    <option value="member">Članovi</option>
                    <option value="moderator">Moderatori</option>
                    <option value="admin">Administratori</option>
                  </select>
                  <select
                    value={userStatusFilter}
                    onChange={(e) => setUserStatusFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">Svi statusi</option>
                    <option value="active">Aktivni</option>
                    <option value="banned">Banovani</option>
                  </select>
                </div>

                {/* Lista korisnika */}
                <div className="space-y-3">
                  {filteredUsers.length === 0 ? (
                    <div className="py-12 text-center text-white/40">Nema korisnika koji odgovaraju pretrazi.</div>
                  ) : (
                    filteredUsers.map((u: any) => {
                      const isSelf = u.id === currentUser?.id;
                      const isTargetAdmin = u.role === 'admin';
                      const canChangeRole = isAdmin && !isSelf && (!isTargetAdmin || isSelf);

                      return (
                        <div
                          key={u.id}
                          className={`rounded-md border p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition ${
                            u.isBanned
                              ? 'border-[var(--color-error)]/30 bg-[var(--color-error)]/[0.03]'
                              : 'border-white/[0.07] bg-surface-1 hover:border-white/[0.14]'
                          }`}
                        >
                          <div className="flex items-center gap-4 min-w-0">
                            <img
                              src={u.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80'}
                              alt={u.username}
                              className="w-12 h-12 rounded-full border border-white/20 object-cover flex-shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <Link
                                  to={`/profile/${encodeURIComponent(u.username)}`}
                                  className="font-semibold text-white hover:text-[var(--color-primary-hover)] flex items-center gap-1"
                                >
                                  <span>{u.username}</span>
                                  <ExternalLink size={12} className="opacity-40" />
                                </Link>
                                <span className="text-xs text-white/40 truncate">({u.email})</span>
                                {isSelf && (
                                  <span className="text-[10px] bg-white/10 text-white/70 px-1.5 py-0.5 rounded">Vi</span>
                                )}
                                {u.isBanned && (
                                  <Badge tone="error">BANOVAN</Badge>
                                )}
                                {u.mutedUntil && new Date(u.mutedUntil).getTime() > Date.now() && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-300 bg-orange-950/50 px-1.5 py-0.5 rounded border border-orange-500/30">
                                    MUTED (do {new Date(u.mutedUntil).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })})
                                  </span>
                                )}
                                {u.isVerified ? (
                                  <span className="text-[11px] text-[var(--color-accent-green)] font-medium">✓ Verifikovan</span>
                                ) : (
                                  <span className="text-[11px] text-white/30">Neverifikovan</span>
                                )}
                              </div>
                              <div className="text-xs text-white/50 flex flex-wrap items-center gap-2">
                                <span>Level {u.level}</span>
                                <span>·</span>
                                <span>{u.karma} karme</span>
                                <span>·</span>
                                <span className="capitalize">Status: {u.status || 'offline'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u, e.target.value)}
                              disabled={!canChangeRole}
                              className="ui-field !w-auto !px-2.5 !py-1.5 !text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                              title={isSelf ? 'Ne možete menjati sopstvenu ulogu' : 'Izmeni ulogu'}
                            >
                              <option value="member">Član</option>
                              <option value="moderator">Moderator</option>
                              <option value="admin">Administrator</option>
                            </select>

                            {isAdmin && (
                              <button
                                onClick={() => {
                                  setAwardTarget(u);
                                  setAwardBadgeCode('');
                                  setAwardXpBonus(100);
                                }}
                                className="ui-btn br-secondary ui-btn-sm flex items-center gap-1 text-[var(--color-accent-amber)] hover:bg-[var(--color-accent-amber)]/10"
                                title="Dodeli bedž ili XP"
                              >
                                <Award size={14} />
                                <span>Nagradi</span>
                              </button>
                            )}

                            {u.mutedUntil && new Date(u.mutedUntil).getTime() > Date.now() ? (
                              <button
                                onClick={() => unmute(u)}
                                className="rounded-lg border border-orange-500/40 px-2.5 py-1.5 text-xs font-semibold text-orange-300 hover:bg-orange-500/10"
                                title="Skini mute"
                              >
                                Odmutuj
                              </button>
                            ) : null}

                            {u.isBanned ? (
                              <button
                                onClick={() => unban(u)}
                                disabled={!isAdmin}
                                className="rounded-lg border border-[var(--color-success)]/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-[var(--color-success)]/10 disabled:opacity-40"
                              >
                                Odbanuj
                              </button>
                            ) : (
                              <button
                                onClick={() => setBanTarget(u)}
                                disabled={isSelf || (isTargetAdmin && !isAdmin) || u.role === 'admin'}
                                className="rounded-lg border border-[var(--color-error)]/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-[var(--color-error)]/10 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Banuj
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB: FORUM */}
            {activeTab === 'forum' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Moderacija foruma ({filteredThreads.length})</h2>
                  <p className="text-xs text-white/50 mt-1">Zakači važne teme, zaključaj rasprave ili ukloni teme koje krše pravila.</p>
                </div>

                {/* Filteri za forum */}
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži teme po naslovu ili autoru..."
                      value={forumSearch}
                      onChange={(e) => setForumSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                  <select
                    value={forumSubforumFilter}
                    onChange={(e) => setForumSubforumFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    {SUBFORUMS.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <select
                    value={forumStatusFilter}
                    onChange={(e) => setForumStatusFilter(e.target.value)}
                    className="ui-field !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">Sve teme</option>
                    <option value="pinned">Samo pinovane</option>
                    <option value="locked">Samo zaključane</option>
                  </select>
                </div>

                {/* Lista tema */}
                <div className="space-y-3">
                  {filteredThreads.length === 0 ? (
                    <div className="py-12 text-center text-white/40">Nema tema koje odgovaraju pretrazi.</div>
                  ) : (
                    filteredThreads.map((thr: any) => (
                      <div
                        key={thr.id}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-4 hover:border-white/[0.14] transition"
                      >
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold mb-1 flex items-center gap-2 flex-wrap">
                              {thr.isPinned && (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-amber)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-amber)] border border-[var(--color-accent-amber)]/30">
                                  <Pin size={12} /> Zakačeno
                                </span>
                              )}
                              {thr.isLocked && (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-red)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-red)] border border-[var(--color-accent-red)]/30">
                                  <Lock size={12} /> Zaključano
                                </span>
                              )}
                              <Link
                                to={`/thread/${thr.id}`}
                                className="text-white hover:text-[var(--color-primary-hover)] transition"
                              >
                                {thr.title}
                              </Link>
                            </h3>
                            <div className="text-xs text-white/50 flex flex-wrap items-center gap-2 mt-1">
                              <span className="text-[var(--color-primary-fg)] font-medium uppercase tracking-wider">{thr.subforum}</span>
                              <span>·</span>
                              <span>Autor: {thr.author}</span>
                              <span>·</span>
                              <span>{thr.karma} karme</span>
                              <span>·</span>
                              <span>{thr.replies || 0} odgovora</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => handleModerateThread(thr.id, 'pin', thr.isPinned)}
                              className={`ui-btn br-secondary ui-btn-sm flex items-center gap-1 ${
                                thr.isPinned ? 'text-[var(--color-accent-amber)]' : ''
                              }`}
                              title={thr.isPinned ? 'Otkači temu' : 'Zakači temu na vrh'}
                            >
                              <Pin size={14} />
                              <span>{thr.isPinned ? 'Otkači' : 'Zakači'}</span>
                            </button>
                            <button
                              onClick={() => handleModerateThread(thr.id, 'lock', thr.isLocked)}
                              className={`ui-btn br-secondary ui-btn-sm flex items-center gap-1 ${
                                thr.isLocked ? 'text-[var(--color-accent-red)]' : ''
                              }`}
                              title={thr.isLocked ? 'Otključaj temu' : 'Zaključaj temu'}
                            >
                              {thr.isLocked ? <Unlock size={14} /> : <Lock size={14} />}
                              <span>{thr.isLocked ? 'Otključaj' : 'Zaključaj'}</span>
                            </button>
                            <button
                              onClick={() => handleModerateThread(thr.id, 'delete')}
                              className="ui-btn br-secondary ui-btn-sm text-[var(--color-accent-red)] hover:bg-[var(--color-accent-red)]/10 flex items-center gap-1"
                              title="Obriši temu"
                            >
                              <Trash2 size={14} />
                              <span>Obriši</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: KOMENTARI NA ČLANCIMA */}
            {activeTab === 'comments' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Komentari na člancima ({filteredComments.length})</h2>
                  <p className="text-xs text-white/50 mt-1">Pregledaj sve komentare ostavljene na člancima magazina i ukloni neželjen sadržaj.</p>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži komentare po autoru ili sadržaju..."
                      value={commentSearch}
                      onChange={(e) => setCommentSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredComments.length === 0 ? (
                    <div className="py-12 text-center text-white/40">Nema komentara koji odgovaraju pretrazi.</div>
                  ) : (
                    filteredComments.map((com: any) => (
                      <div
                        key={com.id}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 hover:border-white/[0.14] transition"
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {com.authorAvatar ? (
                            <img
                              src={com.authorAvatar}
                              alt={com.author}
                              className="w-10 h-10 rounded-full border border-white/20 object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 border border-white/10 text-white/50 text-xs font-bold">
                              {com.author?.slice(0, 2).toUpperCase() || 'U'}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1 text-xs">
                              <span className="font-semibold text-white">{com.author}</span>
                              <span className="text-white/40">·</span>
                              <span className="text-white/40">{new Date(com.createdAt).toLocaleString('sr-Latn-RS')}</span>
                              <Link
                                to={`/article/${com.articleId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--color-primary-fg)] hover:underline flex items-center gap-1 text-[11px]"
                              >
                                <span>Članak #{com.articleId.slice(0, 8)}</span>
                                <ExternalLink size={10} />
                              </Link>
                            </div>
                            <div
                              className="text-sm text-white/85 line-clamp-3 leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: com.content }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                          <button
                            onClick={() => {
                              if (window.confirm('Da li ste sigurni da želite da obrišete ovaj komentar?')) {
                                deleteCommentMutation.mutate(com.id);
                              }
                            }}
                            className="ui-btn br-secondary ui-btn-sm text-[var(--color-accent-red)] hover:bg-[var(--color-accent-red)]/10 flex items-center gap-1"
                          >
                            <Trash2 size={14} />
                            <span>Obriši</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: PRIJAVE (REPORTS) */}
            {activeTab === 'reports' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold flex items-center gap-2">
                      <span>Moderacioni red</span>
                      {pendingReportsCount > 0 && (
                        <Badge tone="warning">{pendingReportsCount} na čekanju</Badge>
                      )}
                    </h2>
                    <p className="text-xs text-white/50 mt-1">Prijave neprimerenog sadržaja poslate od strane članova zajednice.</p>
                  </div>
                  <Link
                    to="/admin/reports"
                    className="ui-btn br-secondary text-xs px-3 py-2 flex items-center gap-1.5 text-white/90"
                  >
                    <span>Kompletan red prijava</span>
                    <ArrowRight size={14} />
                  </Link>
                </div>

                <div className="space-y-3">
                  {(!reportsData?.reports || reportsData.reports.length === 0) ? (
                    <div className="rounded-lg border border-white/[0.07] bg-white/[0.01] p-12 text-center">
                      <CheckCircle2 size={36} className="mx-auto text-[var(--color-accent-green)] opacity-80 mb-3" />
                      <h4 className="font-semibold text-white">Nema prijava na čekanju</h4>
                      <p className="text-xs text-white/50 mt-1">Sve prijave su trenutno rešene ili odbačene.</p>
                    </div>
                  ) : (
                    reportsData.reports.map((report: any) => (
                      <div
                        key={report.id}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-4 flex flex-col md:flex-row md:items-start justify-between gap-4 hover:border-white/[0.14] transition"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
                            <Badge tone="neutral">{report.targetType}</Badge>
                            <Badge tone="warning">Na čekanju</Badge>
                            <span className="text-white/40">
                              {new Date(report.createdAt).toLocaleString('sr-Latn-RS')}
                            </span>
                          </div>
                          <p className="text-sm text-white/90 font-medium mb-1.5">{report.reason}</p>
                          <p className="font-mono text-[11px] text-white/40">
                            Meta ID: {report.targetId} · Prijavio: {report.reporterId}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => resolveReport(report.id, 'resolved')}
                            className="ui-btn br-primary ui-btn-sm flex items-center gap-1.5"
                          >
                            <CheckCircle2 size={14} />
                            <span>Reši</span>
                          </button>
                          <button
                            onClick={() => resolveReport(report.id, 'dismissed')}
                            className="ui-btn br-secondary ui-btn-sm flex items-center gap-1.5 text-white/70"
                          >
                            <XCircle size={14} />
                            <span>Odbaci</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: REVIZORSKI LOG (AUDIT LOG - ADMIN ONLY) */}
            {activeTab === 'audit' && isAdmin && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Revizorski log akcija ({filteredAudit.length})</h2>
                  <p className="text-xs text-white/50 mt-1">Bezbednosni trag promena uloga i primenjenih banova sa tačnim vremenom i akterom.</p>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži revizorski trag po administratoru, meti ili tipu akcije..."
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredAudit.length === 0 ? (
                    <div className="py-12 text-center text-white/40">Nema zapisa u revizorskom logu.</div>
                  ) : (
                    filteredAudit.map((entry: any) => {
                      const actionTone =
                        entry.action === 'ban'
                          ? 'error'
                          : entry.action === 'unban'
                            ? 'success'
                            : 'warning';
                      const actionLabel =
                        entry.action === 'ban'
                          ? 'Ban'
                          : entry.action === 'unban'
                            ? 'Odbanovanje'
                            : 'Promena uloge';

                      return (
                        <div
                          key={entry.id}
                          className="rounded-md border border-white/[0.07] bg-surface-1 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-sm hover:border-white/[0.14] transition"
                        >
                          <div className="flex items-center gap-3">
                            <Badge tone={actionTone}>{actionLabel}</Badge>
                            <div>
                              <div className="font-semibold text-white">
                                <span className="text-[var(--color-primary-fg)]">{entry.actorUsername || entry.actorId}</span>
                                {' → '}
                                <span className="text-white/90">{entry.targetUsername || entry.targetId}</span>
                              </div>
                              <div className="text-xs text-white/50 mt-0.5">
                                {entry.action === 'role_change' && (
                                  <span>Prethodna uloga: {entry.from?.role || '—'} → Nova uloga: {entry.to?.role || '—'}</span>
                                )}
                                {entry.action === 'ban' && (
                                  <span>
                                    Razlog: {entry.to?.banReason || 'Nije naveden'}{' '}
                                    ({entry.to?.banExpiresAt ? `Do: ${new Date(entry.to.banExpiresAt).toLocaleDateString('sr-Latn-RS')}` : 'Trajno'})
                                  </span>
                                )}
                                {entry.action === 'unban' && (
                                  <span>Korisnik je ponovo aktiviran</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-white/40 font-mono">
                            {new Date(entry.at).toLocaleString('sr-Latn-RS')}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* TAB: NEWSLETTER (ADMIN ONLY) */}
            {activeTab === 'newsletter' && isAdmin && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">Pretplatnici newslettera ({filteredSubscribers.length})</h2>
                    <p className="text-xs text-white/50 mt-1">Lista korisnika prijavljenih na portal newsletter sa datumima i statusom aktivacije.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={subscriberSegment}
                      onChange={(e) => setSubscriberSegment(e.target.value as 'active' | 'pending' | 'unsubscribed' | 'all')}
                      className="ui-field !w-auto !py-1.5 !text-xs"
                      aria-label="Segment pretplatnika"
                    >
                      <option value="active">Potvrđeni ({subscriberCounts.active})</option>
                      <option value="pending">Na čekanju ({subscriberCounts.pending})</option>
                      <option value="unsubscribed">Odjavljeni ({subscriberCounts.unsubscribed})</option>
                      <option value="all">Svi ({subscriberCounts.all})</option>
                    </select>
                    <button
                      onClick={() => setBroadcastOpen(true)}
                      className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <Send size={14} /> Pošalji bilten
                    </button>
                    <button
                      onClick={() => copyAllEmails(filteredSubscribers)}
                      className="ui-btn br-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <Copy size={14} /> Kopiraj adrese
                    </button>
                    <button
                      onClick={() => exportSubscribersCsv(filteredSubscribers)}
                      className="ui-btn br-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                    >
                      <Download size={14} /> Izvezi u CSV
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                    <input
                      type="text"
                      placeholder="Pretraži pretplatnike po email adresi..."
                      value={subscriberSearch}
                      onChange={(e) => setSubscriberSearch(e.target.value)}
                      className="ui-field !pl-9 !py-1.5 !text-xs w-full"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {filteredSubscribers.length === 0 ? (
                    <div className="text-white/50 py-12 text-center">Nema pretplatnika koji odgovaraju pretrazi.</div>
                  ) : (
                    filteredSubscribers.map((sub: any) => (
                      <div
                        key={sub.id}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-3 flex items-center justify-between text-sm hover:border-white/[0.14] transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-white/90">{sub.email}</span>
                          <Badge tone={sub.unsubscribedAt ? 'neutral' : sub.isActive ? 'success' : 'warning'}>
                            {sub.unsubscribedAt ? 'Odjavljen' : sub.isActive ? 'Aktivan' : 'Na čekanju'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* 2.6.2 — ponovna potvrda samo za „na čekanju“ */}
                          {!sub.isActive && !sub.unsubscribedAt && (
                            <button
                              type="button"
                              onClick={() => void resendConfirmation(sub.email)}
                              disabled={resending === sub.email}
                              className="ui-btn br-secondary text-[11px] px-2 py-1 disabled:opacity-50"
                            >
                              {resending === sub.email ? 'Šaljem…' : 'Pošalji potvrdu'}
                            </button>
                          )}
                          <span className="text-xs text-white/40">
                            {new Date(sub.subscribedAt).toLocaleDateString('sr-Latn-RS')}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB: MEDIJSKA GALERIJA (2.6.3) */}
            {activeTab === 'media' && isAdmin && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-white">Medijska galerija</h2>
                    <p className="text-sm text-[var(--color-text-tertiary)]">
                      Sve slike iz Storage bucketa — avatari, korice, dokazi i slike članaka.
                    </p>
                  </div>
                </div>
                <MediaGallery />
              </div>
            )}

            {/* TAB: PODEŠAVANJA SAJTA (ADMIN ONLY) */}
            {activeTab === 'settings' && isAdmin && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Podešavanja portala i foruma</h2>
                  <p className="text-xs text-white/50 mt-1">
                    Upravljaj globalnim obaveštenjem (Announcement Banner), prijemom novih korisnika i režimom održavanja.
                  </p>
                </div>

                <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
                  {/* Announcement Banner */}
                  <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Radio size={20} className="text-[var(--color-primary-fg)]" />
                        <h3 className="font-bold text-lg text-white">Globalno obaveštenje (Announcement Banner)</h3>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={announcementActive}
                          onChange={(e) => setAnnouncementActive(e.target.checked)}
                          className="w-4 h-4 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                        <span className={announcementActive ? 'text-[var(--color-accent-green)] font-semibold' : 'text-white/40'}>
                          {announcementActive ? 'Aktivno' : 'Isključeno'}
                        </span>
                      </label>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Tekst obaveštenja</label>
                        <input
                          type="text"
                          value={announcementMessage}
                          onChange={(e) => setAnnouncementMessage(e.target.value)}
                          placeholder="npr. U toku je server održavanje od 02:00h do 03:00h..."
                          className="ui-field w-full"
                          maxLength={300}
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Tip obaveštenja (Ton)</label>
                          <select
                            value={announcementTone}
                            onChange={(e) => setAnnouncementTone(e.target.value as any)}
                            className="ui-field w-full"
                          >
                            <option value="info">Info (Plavo)</option>
                            <option value="warning">Upozorenje (Žuto)</option>
                            <option value="danger">Kritično (Crveno)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Link dugmeta (Opciono)</label>
                          <input
                            type="text"
                            value={announcementLink}
                            onChange={(e) => setAnnouncementLink(e.target.value)}
                            placeholder="npr. /rules ili https://..."
                            className="ui-field w-full"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bezbednost i Registracija */}
                  <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <Shield size={20} className="text-[var(--color-accent-amber)]" />
                      <span>Bezbednost i pristup</span>
                    </h3>

                    <div className="space-y-3">
                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Dozvoli registraciju novih korisnika</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Kada je isključeno, novi nalozi se ne mogu kreirati (odbrana od spam botova).
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={registrationOpen}
                          onChange={(e) => setRegistrationOpen(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>

                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Režim održavanja (Maintenance Mode)</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Oznaka sistema za privremene radove na serveru.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={maintenanceMode}
                          onChange={(e) => setMaintenanceMode(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary flex items-center gap-2 px-6">
                      <CheckCircle2 size={16} />
                      <span>Sačuvaj podešavanja</span>
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* MODAL ZA KREIRANJE / IZMENU ČLANKA */}
        {articleModalOpen && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 p-6 max-w-2xl w-full animate-fade-in max-h-[90vh] overflow-y-auto">
              <h3 className="text-2xl font-bold mb-4">
                {editingArticle ? `Izmeni članak: ${editingArticle.title}` : 'Novi članak za Portal'}
              </h3>
              <form
                key={editingArticle ? editingArticle.id : 'new-article'}
                onSubmit={handleSubmitArticle}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-semibold mb-1">Naslov članka</label>
                  <input
                    type="text"
                    value={articleTitle}
                    onChange={(e) => setArticleTitle(e.target.value)}
                    required
                    placeholder="Naslov članka..."
                    className="ui-field w-full"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-1">Kategorija</label>
                    <select
                      value={articleCategory}
                      onChange={(e) => setArticleCategory(e.target.value)}
                      className="ui-field w-full"
                    >
                      {ARTICLE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1">Status objave</label>
                    <select
                      value={articleStatus}
                      onChange={(e) => setArticleStatus(e.target.value as 'published' | 'draft')}
                      className="ui-field w-full"
                    >
                      <option value="published">Objavljeno (javno vidljivo)</option>
                      <option value="draft">Draft (radna verzija)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1">Naslovna slika (Cover URL)</label>
                  <input
                    type="url"
                    value={articleCoverImage}
                    onChange={(e) => setArticleCoverImage(e.target.value)}
                    placeholder="https://images.unsplash.com/photo-..."
                    className="ui-field w-full"
                  />
                  {/* 2.6.2 — cover sa uređaja ide u Supabase Storage; server ga smanjuje na 600×800 (WebP). */}
                  <div className="mt-2">
                    <ImageUpload
                      kind="cover"
                      onUploaded={setArticleCoverImage}
                      label="Ili otpremi naslovnu sliku"
                    />
                  </div>
                  {articleCoverImage && (
                    <div className="mt-2 relative h-32 rounded-md overflow-hidden border border-white/10 bg-black/30">
                      <img
                        src={articleCoverImage}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
                  <input
                    type="checkbox"
                    id="articleFeatured"
                    checked={articleIsFeatured}
                    onChange={(e) => setArticleIsFeatured(e.target.checked)}
                    className="w-4 h-4 rounded border-white/20 bg-surface-1 text-[var(--color-primary)] cursor-pointer"
                  />
                  <label htmlFor="articleFeatured" className="text-sm font-semibold text-white flex items-center gap-1.5 cursor-pointer">
                    <span className="text-[var(--color-accent-amber)]">★</span>
                    <span>Postavi kao Glavnu Vest na Naslovnoj (Featured Hero)</span>
                  </label>
                </div>

                {/* Sekcija za Recenzije (IGN Scorecard) */}
                <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-purple-300">
                    <Award size={18} />
                    <span>Recenzija Igre — Ocena i Presuda (Opciono za recenzije)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-white/70">Konačna ocena (od 1 do 10)</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        step="0.1"
                        value={articleReviewScore}
                        onChange={(e) => setArticleReviewScore(e.target.value)}
                        placeholder="npr. 9.5"
                        className="ui-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-white/70">Kratka presuda (Verdict)</label>
                      <input
                        type="text"
                        value={articleReviewVerdict}
                        onChange={(e) => setArticleReviewVerdict(e.target.value)}
                        placeholder="npr. Remek-delo modernog gejminga..."
                        className="ui-field w-full"
                        maxLength={500}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-[var(--color-accent-green)]">
                        Dobre strane (+) — po jedna u novom redu
                      </label>
                      <textarea
                        rows={3}
                        value={articleReviewPros}
                        onChange={(e) => setArticleReviewPros(e.target.value)}
                        placeholder="Vrhunska grafika&#10;Odlična priča&#10;Fantastičan saundtrek"
                        className="ui-field w-full resize-none text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-[var(--color-accent-red)]">
                        Loše strane (-) — po jedna u novom redu
                      </label>
                      <textarea
                        rows={3}
                        value={articleReviewCons}
                        onChange={(e) => setArticleReviewCons(e.target.value)}
                        placeholder="Bagovi pri lansiranju&#10;Kratka kampanja"
                        className="ui-field w-full resize-none text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1">Kratak opis (Excerpt)</label>
                  <input
                    type="text"
                    value={articleExcerpt}
                    onChange={(e) => setArticleExcerpt(e.target.value)}
                    placeholder="Jedna do dve rečenice sažetka..."
                    className="ui-field w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1">Sadržaj članka</label>
                  <RichTextEditor
                    content={articleContent}
                    onChange={setArticleContent}
                    placeholder="Kompletan tekst članka — koristi toolbar za formatiranje..."
                  />
                </div>

                <div className="flex gap-3 justify-end pt-3 border-t border-white/10">
                  <button type="button" onClick={closeArticleModal} className="btn-secondary">
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={createArticleMutation.isPending || updateArticleMutation.isPending}
                  >
                    {createArticleMutation.isPending || updateArticleMutation.isPending
                      ? 'Čuvanje...'
                      : editingArticle
                        ? 'Sačuvaj izmene'
                        : 'Objavi članak'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL ZA BAN KORISNIKA */}
        {banTarget && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 w-full max-w-md animate-fade-in p-6">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-accent-red)]">
                <ShieldAlert size={20} />
                <h3 className="text-xl font-bold">Banuj korisnika: {banTarget.username}</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                Razlog se trajno čuva u revizorskom logu. Ban stupa na snagu odmah.
              </p>

              <div className="space-y-4">
                {/* Opcija: Mute (Prigušivanje) */}
                <div className="p-3 rounded-lg border border-orange-500/30 bg-orange-950/20">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-orange-300">
                      Privremeni Mute / Timeout (Umesto bana):
                    </span>
                    <select
                      value={banMuteHours}
                      onChange={(e) => setBanMuteHours(e.target.value)}
                      className="ui-field w-full text-xs"
                    >
                      <option value="0">— Ne primenjuj Mute (Idi na Ban) —</option>
                      <option value="1">Ućutkaj na 1 sat (1h)</option>
                      <option value="6">Ućutkaj na 6 sati (6h)</option>
                      <option value="24">Ućutkaj na 24 sata (1 dan)</option>
                      <option value="72">Ućutkaj na 72 sata (3 dana)</option>
                    </select>
                  </label>
                  <p className="text-[11px] text-white/40 mt-1">
                    Korisnik može čitati forum, ali ne može ostavljati komentare niti odgovore.
                  </p>
                </div>

                {Number(banMuteHours) === 0 && (
                  <>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-semibold">Razlog bana *</span>
                      <textarea
                        value={banReason}
                        onChange={(e) => setBanReason(e.target.value.slice(0, 500))}
                        rows={3}
                        maxLength={500}
                        placeholder="npr. Spam, govor mržnje ili višestruko kršenje pravila foruma..."
                        className="ui-field resize-none w-full"
                      />
                    </label>

                    <label className="block space-y-1.5">
                      <span className="text-sm font-semibold">Trajanje bana</span>
                      <select
                        value={banDays}
                        onChange={(e) => setBanDays(e.target.value)}
                        className="ui-field w-full"
                      >
                        <option value="1">1 dan</option>
                        <option value="7">7 dana</option>
                        <option value="30">30 dana</option>
                        <option value="permanent">Trajno</option>
                      </select>
                    </label>
                  </>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setBanTarget(null)}
                  className="btn-secondary"
                  disabled={banSubmitting}
                >
                  Otkaži
                </button>
                <button
                  type="button"
                  onClick={submitBan}
                  className={`rounded-md px-4 py-2 font-semibold text-white hover:opacity-90 disabled:opacity-50 ${
                    Number(banMuteHours) > 0 ? 'bg-orange-600' : 'bg-[var(--color-accent-red)]'
                  }`}
                  disabled={banSubmitting}
                >
                  {banSubmitting
                    ? 'Primenjujem...'
                    : Number(banMuteHours) > 0
                      ? 'Primeni Mute'
                      : 'Potvrdi ban'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL ZA DODELU NAGRADE / BEDŽA */}
        {awardTarget && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 w-full max-w-md animate-fade-in p-6">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-accent-amber)]">
                <Award size={22} />
                <h3 className="text-xl font-bold">Nagradi: {awardTarget.username}</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                Dodeli poseban bedž ili XP bonus na profil ovog korisnika.
              </p>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold">Izaberi bedž</span>
                  <select
                    value={awardBadgeCode}
                    onChange={(e) => setAwardBadgeCode(e.target.value)}
                    className="ui-field w-full"
                  >
                    <option value="">— Bez novog bedža —</option>
                    <option value="beta-tester">Beta Tester (Rano testiranje)</option>
                    <option value="tournament-winner">Šampion turnira (Esports)</option>
                    <option value="vip-supporter">VIP Donator zajednice</option>
                    <option value="content-creator">Kreator sadržaja</option>
                    <option value="community-mvp">MVP Zajednice</option>
                    <option value="hardware-guru">Hardver Guru</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold">XP Bonus (Iskustvo)</span>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="50"
                    value={awardXpBonus}
                    onChange={(e) => setAwardXpBonus(Number(e.target.value))}
                    className="ui-field w-full"
                  />
                  <span className="text-[11px] text-white/40">Dodatni XP koji utiče na nivo i rang listu.</span>
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAwardTarget(null)}
                  className="btn-secondary"
                  disabled={awardSubmitting}
                >
                  Otkaži
                </button>
                <button
                  type="button"
                  onClick={submitAward}
                  className="btn-primary flex items-center gap-1.5"
                  disabled={awardSubmitting}
                >
                  <Zap size={14} />
                  <span>{awardSubmitting ? 'Dodeljujem...' : 'Dodeli nagradu'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL ZA NEWSLETTER BROADCAST EMAIL */}
        {broadcastOpen && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 w-full max-w-xl animate-fade-in p-6">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-primary-fg)]">
                <Send size={22} />
                <h3 className="text-xl font-bold">Pošalji Newsletter Bilten</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                {broadcastTest
                  ? `Test režim: jedan mejl ide na ${broadcastTest} — kampanja se ne pokreće.`
                  : `Ide na segment „${broadcastSegment === 'active' ? 'potvrđeni' : broadcastSegment === 'pending' ? 'na čekanju' : 'svi'}“ (${subscriberCounts[broadcastSegment] ?? 0} adresa). Odjavljeni se nikad ne kontaktiraju.`}
              </p>

              <form onSubmit={submitBroadcast} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">Segment</span>
                    <select
                      value={broadcastSegment}
                      onChange={(e) => setBroadcastSegment(e.target.value as 'active' | 'pending' | 'all')}
                      className="ui-field w-full"
                    >
                      <option value="active">Potvrđeni pretplatnici</option>
                      <option value="pending">Samo na čekanju (podsetnik)</option>
                      <option value="all">Svi osim odjavljenih</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">Test mejl (opciono)</span>
                    <input
                      type="email"
                      value={broadcastTest}
                      onChange={(e) => setBroadcastTest(e.target.value)}
                      placeholder="tvoj@email.com"
                      className="ui-field w-full"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1">Naslov emaila (Subject) *</label>
                  <input
                    type="text"
                    value={broadcastSubject}
                    onChange={(e) => setBroadcastSubject(e.target.value)}
                    required
                    placeholder="npr. NEXUS Nedeljni pregled: Najveće gejming vesti i recenzije..."
                    className="ui-field w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1">Sadržaj poruke (HTML / Tekst) *</label>
                  <textarea
                    value={broadcastContent}
                    onChange={(e) => setBroadcastContent(e.target.value)}
                    required
                    rows={8}
                    placeholder="Unesite kompletan tekst newslettera..."
                    className="ui-field w-full resize-none font-sans"
                  />
                </div>

                <div className="mt-6 flex justify-end gap-3 border-t border-white/10 pt-4">
                  <button
                    type="button"
                    onClick={() => setBroadcastOpen(false)}
                    className="btn-secondary"
                    disabled={broadcastSubmitting}
                  >
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex items-center gap-1.5"
                    disabled={broadcastSubmitting}
                  >
                    <Send size={14} />
                    <span>{broadcastSubmitting ? 'Slanje...' : broadcastTest ? 'Pošalji test' : 'Pošalji pretplatnicima'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
