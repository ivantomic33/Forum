import {
  FileText,
  Users,
  MessageSquare,
  Globe,
  LayoutGrid,
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
  Sparkles,
  Undo2,
  Server,
  Activity,
  ShieldCheck,
  FileDown,
  ServerCrash,
} from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import CountUp from 'react-countup';
import { api } from '../lib/api';
// N10 — tipovi iz ugovora sa serverom (umesto `any` u admin tabelama).
import type { Article, ArticleInput, OwnerUser, Subscriber, AdminHealth } from '../../contracts/index';
import RichTextEditor from '../components/RichTextEditor';
import { Button, ImageUpload } from '../components/ui';
import { BadgeChip } from '../components/ui/BadgeChip';
import { BADGES } from '../lib/badges';
import { useAuthStore } from '../store/authStore';
import { useT } from '../lib/i18n';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Feedback';
import { MediaGallery } from '../components/ui/MediaGallery';
import { AdminAnalytics } from '../components/admin/AdminAnalytics';
import { AdminNewsSources } from '../components/admin/AdminNewsSources';

type AdminTab = 'articles' | 'users' | 'forum' | 'categories' | 'comments' | 'reports' | 'audit' | 'newsletter' | 'media' | 'system' | 'settings';

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

/**
 * TAB: SISTEM — rate limiti (pregled), IP ban lista (CRUD) i CSV export.
 * Zasebna komponenta: drži sopstveni state, ne opterećuje glavni dashboard.
 */
function SystemTab() {
  const queryClient = useQueryClient();

  // Health dijagnostika (baza, Storage, Email, uptime, memorija)
  const { data: healthData, isLoading: healthLoading } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => api.admin.health(),
    refetchInterval: 30_000,
  });

  // Rate limiti (read-only pregled — izvor istine su env varijable na serveru)
  const { data: rateData, isLoading: rateLoading } = useQuery({
    queryKey: ['admin', 'rate-limits'],
    queryFn: () => api.admin.rateLimits(),
  });

  // IP ban lista
  const { data: ipData, isLoading: ipLoading } = useQuery({
    queryKey: ['admin', 'ip-bans'],
    queryFn: () => api.admin.ipBans(),
  });
  const [ipInput, setIpInput] = useState('');
  const [ipReason, setIpReason] = useState('');
  const [ipSubmitting, setIpSubmitting] = useState(false);

  const addIpBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipInput.trim()) {
      toast.error('Unesi IP adresu.');
      return;
    }
    setIpSubmitting(true);
    try {
      const res = await api.admin.addIpBan(ipInput.trim(), ipReason.trim() || 'Ručni ban');
      toast.success(res.message);
      setIpInput('');
      setIpReason('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'ip-bans'] });
    } catch (err: any) {
      toast.error(err?.message || 'Ban IP adrese nije uspeo.');
    } finally {
      setIpSubmitting(false);
    }
  };

  const removeIpBan = async (ip: string) => {
    try {
      const res = await api.admin.removeIpBan(ip);
      toast.success(res.message);
      queryClient.invalidateQueries({ queryKey: ['admin', 'ip-bans'] });
    } catch (err: any) {
      toast.error(err?.message || 'Uklanjanje bana nije uspelo.');
    }
  };

  const EXPORTS: Array<{ dataset: 'users' | 'subscribers' | 'reports' | 'audit'; label: string; icon: any; description: string }> = [
    { dataset: 'users', label: 'Korisnici', icon: Users, description: 'Username, email, uloga, XP, nivo, ban status' },
    { dataset: 'subscribers', label: 'Pretplatnici', icon: Mail, description: 'Newsletter lista sa statusima potvrde' },
    { dataset: 'reports', label: 'Prijave', icon: Flag, description: 'Sve prijave sadržaja sa statusima' },
    { dataset: 'audit', label: 'Revizorski log', icon: History, description: 'Poslednjih 500 admin akcija' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Sistem</h2>
        <p className="text-xs text-white/50 mt-1">Rate limiti, IP ban lista, health i CSV export — operativni pregled bez diranja koda.</p>
      </div>

      {/* HEALTH */}
      <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ServerCrash size={20} className="text-[var(--color-primary-fg)]" />
          <h3 className="font-bold text-lg text-white">Health</h3>
        </div>
        {healthLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : healthData ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Status</div>
              <div className={`mt-1 font-bold ${healthData.status === 'ok' ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-warning)]'}`}>
                {healthData.status === 'ok' ? '✓ OK' : '⚠ Degraded'}
              </div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Baza ({healthData.db.mode})</div>
              <div className={`mt-1 font-bold ${healthData.db.ok ? 'text-[var(--color-accent-green)]' : 'text-[var(--color-error)]'}`}>
                {healthData.db.ok ? `✓ ${healthData.db.latencyMs} ms` : '✗ Ne odgovara'}
              </div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Memorija (RSS)</div>
              <div className="mt-1 font-bold text-white">{healthData.memory.rssMb} MB</div>
              <div className="text-xs text-white/40">Heap: {healthData.memory.heapMb} MB</div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Email provajder</div>
              <div className="mt-1 font-bold text-white">
                {healthData.email.configured ? healthData.email.provider : '— nije podešen'}
              </div>
              {/* 6.x — politika: mejl je SAMO verifikacija + reset lozinke. */}
              <div className="mt-1 text-xs text-white/45">
                {healthData.email.configured
                  ? '✓ samo verifikacija i reset lozinke'
                  : '⚠ bez provajdera nema verifikacionog mejla'}
              </div>
            </div>
            {/* 6.x — kanali notifikacija: inbox uvek, push/realtime po env-u. */}
            {healthData.notifications && (
              <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
                <div className="text-xs text-white/40 uppercase tracking-wide">Notifikacije</div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  <li className="text-white/70">Inbox/zvonce: <span className="font-semibold text-[var(--color-accent-green)]">✓ uvek</span></li>
                  <li className={healthData.notifications.realtime ? 'text-white/70' : 'text-white/40'}>
                    Realtime: {healthData.notifications.realtime ? '✓' : '— polling fallback'}
                  </li>
                  <li className={healthData.notifications.push ? 'text-white/70' : 'text-white/40'}>
                    Push: {healthData.notifications.push ? '✓' : '— isključen (VAPID)'}
                  </li>
                  <li className="text-white/40">Tiši sati: {healthData.notifications.quietHoursSupported ? '✓ podržani' : '—'}</li>
                </ul>
              </div>
            )}
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Uptime</div>
              <div className="mt-1 font-bold text-white">
                {Math.floor(healthData.uptimeSeconds / 3600)}h {Math.floor((healthData.uptimeSeconds % 3600) / 60)}m
              </div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Storage</div>
              <div className={`mt-1 font-bold ${healthData.storage.configured ? 'text-[var(--color-accent-green)]' : 'text-white/40'}`}>
                {healthData.storage.configured ? `✓ ${healthData.storage.bucket}` : '— nije podešen'}
              </div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Verzija / Node</div>
              <div className="mt-1 font-bold text-white">{healthData.version}</div>
              <div className="text-xs text-white/40">{healthData.node}</div>
            </div>
            <div className="rounded-md border border-white/[0.07] bg-surface-1 p-4">
              <div className="text-xs text-white/40 uppercase tracking-wide">Steam sync</div>
              <div className={`mt-1 font-bold ${healthData.steamSync.enabled ? 'text-[var(--color-accent-green)]' : 'text-white/40'}`}>
                {healthData.steamSync.enabled ? '✓ aktivan' : '— isključen'}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-white/40">Health podaci nisu dostupni.</div>
        )}
      </div>

      {/* RATE LIMITI */}
      <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={20} className="text-[var(--color-primary-fg)]" />
          <h3 className="font-bold text-lg text-white">Rate limiti (aktivni)</h3>
        </div>
        {rateLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-white/40 uppercase tracking-wide">
                  <th className="pb-2 pr-4">Endpoint</th>
                  <th className="pb-2 pr-4">Limit</th>
                  <th className="pb-2 pr-4">Prozor</th>
                  <th className="pb-2">Env varijabla</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(rateData?.limits ?? []).map((limit) => (
                  <tr key={limit.name}>
                    <td className="py-2 pr-4 font-medium text-white">{limit.label}</td>
                    <td className="py-2 pr-4 text-[var(--color-accent-green)] font-mono">{limit.max}</td>
                    <td className="py-2 pr-4 text-white/60">{limit.window}</td>
                    <td className="py-2 text-white/40 font-mono text-xs">{(limit as { env?: string }).env ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-white/40 mt-3">{rateData?.note}</p>
          </div>
        )}
      </div>

      {/* IP BAN LISTA */}
      <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-[var(--color-error)]" />
          <h3 className="font-bold text-lg text-white">Ban lista IP adresa</h3>
        </div>
        <p className="text-xs text-white/50">
          Banovan IP ne vidi API (osim health check-a). Lista je keširana 60 s — promena se primenjuje najkasnije za minut.
        </p>

        <form onSubmit={addIpBan} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold mb-1 text-white/70">IP adresa (IPv4 ili IPv6)</label>
            <input
              type="text"
              value={ipInput}
              onChange={(e) => setIpInput(e.target.value)}
              placeholder="npr. 203.0.113.7"
              className="ui-field w-full font-mono"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold mb-1 text-white/70">Razlog</label>
            <input
              type="text"
              value={ipReason}
              onChange={(e) => setIpReason(e.target.value)}
              placeholder="npr. Spam bot farm"
              className="ui-field w-full"
              maxLength={200}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={ipSubmitting}>
            <ShieldCheck size={16} />
            <span>{ipSubmitting ? 'Banujem...' : 'Banuj IP'}</span>
          </button>
        </form>

        {ipLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-2">
            {(ipData?.bans ?? []).map((ban) => (
              <div
                key={ban.ip}
                className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-error)]/20 bg-[var(--color-error)]/[0.04] p-3"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-white">{ban.ip}</div>
                  <div className="text-xs text-white/50 truncate">
                    {ban.reason || 'bez razloga'} · od {ban.bannedBy || 'sistem'} · {new Date(ban.createdAt).toLocaleDateString('sr-Latn-RS')}
                  </div>
                </div>
                <button
                  onClick={() => removeIpBan(ban.ip)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/5 flex-shrink-0"
                >
                  Ukloni
                </button>
              </div>
            ))}
            {(ipData?.bans ?? []).length === 0 && (
              <div className="text-sm text-white/40 py-2">Ban lista je prazna.</div>
            )}
          </div>
        )}
      </div>

      {/* CSV EXPORT */}
      <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileDown size={20} className="text-[var(--color-accent-green)]" />
          <h3 className="font-bold text-lg text-white">CSV export (GDPR / analiza)</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {EXPORTS.map((item) => (
            <a
              key={item.dataset}
              href={api.admin.exportCsvUrl(item.dataset)}
              className="rounded-md border border-white/[0.07] bg-surface-1 p-4 hover:border-white/[0.14] transition block"
            >
              <div className="flex items-center gap-2 mb-1">
                <item.icon size={16} className="text-[var(--color-primary-fg)]" />
                <span className="font-semibold text-sm text-white">{item.label}</span>
                <Download size={14} className="ml-auto text-white/40" />
              </div>
              <div className="text-xs text-white/50">{item.description}</div>
            </a>
          ))}
        </div>
        <p className="text-xs text-white/40 mt-3">
          Svaki export se beleži u revizorski log. Fajl ide kao download sa UTF-8 BOM-om (Excel kompatibilno).
        </p>
      </div>
    </div>
  );
}

/**
 * 3.0.0 — bedževi koje admin sme RUČNO da dodeli. Lista se sada izvodi iz
 * kataloga (`src/lib/badges.ts`), a ne iz hardkodovanih `<option>`-a: ranije su
 * nedostajale definicije, pa je dodeljeni bedž nestajao sa profila.
 */
const MANUAL_BADGE_IDS = new Set([
  'founder',
  'legend',
  'beta-tester',
  'tournament-winner',
  'vip-supporter',
  'content-creator',
  'community-mvp',
  'hardware-guru',
]);
const SYSTEM_BADGES = BADGES.filter((badge) => MANUAL_BADGE_IDS.has(badge.id));

export default function AdminDashboard() {
  const t = useT();
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
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [articleTitle, setArticleTitle] = useState('');
  const [articleCategory, setArticleCategory] = useState('Vesti');
  const [articleCoverImage, setArticleCoverImage] = useState('');
  const [articleExcerpt, setArticleExcerpt] = useState('');
  const [articleContent, setArticleContent] = useState('');
  /** 2.10.0 — 'scheduled': objava čeka `scheduledFor` (zakazani trenutak). */
  const [articleStatus, setArticleStatus] = useState<'published' | 'draft' | 'scheduled'>('published');
  /** datetime-local vrednost (lokalna zona); u payload ide kao ISO UTC. */
  const [articleScheduledFor, setArticleScheduledFor] = useState('');
  const [articleIsFeatured, setArticleIsFeatured] = useState(false);
  // Review scorecard state
  const [articleReviewScore, setArticleReviewScore] = useState<string>('');
  const [articleReviewVerdict, setArticleReviewVerdict] = useState<string>('');
  const [articleReviewPros, setArticleReviewPros] = useState<string>('');
  const [articleReviewCons, setArticleReviewCons] = useState<string>('');

  // Modal za banovanje
  const [banTarget, setBanTarget] = useState<OwnerUser | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banDays, setBanDays] = useState<string>('7');
  const [banMuteHours, setBanMuteHours] = useState<string>('0');
  const [banSubmitting, setBanSubmitting] = useState(false);

  // F-10 — modal za upozorenje (korak pre bana)
  const [warnTarget, setWarnTarget] = useState<OwnerUser | null>(null);
  const [warnReason, setWarnReason] = useState('');
  const [warnDays, setWarnDays] = useState<string>('30');
  const [warnSubmitting, setWarnSubmitting] = useState(false);

  // Modal za dodelu bedža / nagrade
  const [awardTarget, setAwardTarget] = useState<OwnerUser | null>(null);
  const [awardBadgeCode, setAwardBadgeCode] = useState('');
  const [awardXpBonus, setAwardXpBonus] = useState(100);
  /** 3.0.0 — razlog ide u revizorski log i u notifikaciju korisniku. */
  const [awardReason, setAwardReason] = useState('');
  const [awardSubmitting, setAwardSubmitting] = useState(false);

  // Newsletter broadcast modal
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  /** 2.6.2 — segment kampanje i opcioni „test sebi“ (jedan mejl). */
  const [broadcastSegment, setBroadcastSegment] = useState<'active' | 'pending' | 'all'>('active');
  const [broadcastTest, setBroadcastTest] = useState('');
  /** A/B test: naslov B za polovinu liste (deterministički po adresi). */
  const [broadcastSubjectB, setBroadcastSubjectB] = useState('');
  /** Zakazivanje: `datetime-local` vrednost; prazno → šalje odmah. */
  const [broadcastScheduledAt, setBroadcastScheduledAt] = useState('');
  const [broadcastSubmitting, setBroadcastSubmitting] = useState(false);

  // Settings forma
  const [announcementActive, setAnnouncementActive] = useState(false);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementTone, setAnnouncementTone] = useState<'info' | 'warning' | 'danger'>('info');
  const [announcementLink, setAnnouncementLink] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [requireContentApproval, setRequireContentApproval] = useState(false);
  const [pendingNotice, setPendingNotice] = useState('');
  const [disableNewThreads, setDisableNewThreads] = useState(false);
  const [readOnlyForum, setReadOnlyForum] = useState(false);
  const [allowedEmailDomains, setAllowedEmailDomains] = useState('');
  const [blockedEmailDomains, setBlockedEmailDomains] = useState('');
  const [signatureMaxLength, setSignatureMaxLength] = useState(200);
  const [attachmentsPerPost, setAttachmentsPerPost] = useState(4);
  const [dmMaxThreadsPerUser, setDmMaxThreadsPerUser] = useState(25);
  const [threadsPerDay, setThreadsPerDay] = useState(0);
  const [postsPerDay, setPostsPerDay] = useState(0);
  const [minXpToPost, setMinXpToPost] = useState(0);
  const [maintenanceMessage, setMaintenanceMessage] = useState('Portal je trenutno u režimu održavanja. Vratite se uskoro!');
  const [dmDisabled, setDmDisabled] = useState(false);
  const [seoMetaTitle, setSeoMetaTitle] = useState('');
  const [seoMetaDescription, setSeoMetaDescription] = useState('');
  const [seoOgImage, setSeoOgImage] = useState('');
  const [analyticsId, setAnalyticsId] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Bulk akcije nad korisnicima (checkboxovi u listi)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'ban' | 'unban' | 'mute'>('ban');
  type BulkAction = 'ban' | 'unban' | 'mute';

  // XP korekcija modal (nagradi/kazni)
  const [xpTarget, setXpTarget] = useState<OwnerUser | null>(null);
  const [xpAmount, setXpAmount] = useState(100);
  const [xpReason, setXpReason] = useState('');
  const [xpSubmitting, setXpSubmitting] = useState(false);

  // Editor kategorija/subforuma
  interface AdminCategory {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    color?: string;
    threads?: number;
    posts?: number;
  }
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [catSlug, setCatSlug] = useState('');
  const [catName, setCatName] = useState('');
  const [catIcon, setCatIcon] = useState('💬');
  const [catDescription, setCatDescription] = useState('');
  const [catColor, setCatColor] = useState('');
  const [catEditing, setCatEditing] = useState(false);
  const [catSubmitting, setCatSubmitting] = useState(false);
  const [catLoading, setCatLoading] = useState(false);

  const loadCategories = async () => {
    setCatLoading(true);
    try {
      const res = await api.admin.listCategories();
      setCategories(res.categories ?? []);
    } catch {
      toast.error('Ne mogu da učitam kategorije.');
    } finally {
      setCatLoading(false);
    }
  };

  // Učitaj kategorije jednom kad se otvori tab (admin-only)
  useEffect(() => {
    if (activeTab === 'categories' && isAdmin && !categories.length) {
      void loadCategories();
    }
  }, [activeTab, isAdmin]);

  const startEditCategory = (cat: AdminCategory) => {
    setCatEditing(true);
    setCatSlug(cat.slug);
    setCatName(cat.name);
    setCatIcon(cat.icon || '💬');
    setCatDescription(cat.description || '');
    setCatColor(cat.color || '');
  };

  const resetCategoryForm = () => {
    setCatEditing(false);
    setCatSlug('');
    setCatName('');
    setCatIcon('💬');
    setCatDescription('');
    setCatColor('');
  };

  const submitCategory = async () => {
    if (!catName.trim()) {
      toast.error('Naziv kategorije je obavezan.');
      return;
    }
    setCatSubmitting(true);
    try {
      await api.admin.saveCategory({
        slug: catSlug || catName,
        name: catName.trim(),
        icon: catIcon || '💬',
        description: catDescription.trim(),
        color: catColor.trim() || undefined,
      });
      toast.success(catEditing ? 'Kategorija je izmenjena.' : 'Kategorija je kreirana.');
      resetCategoryForm();
      await loadCategories();
    } catch (err: any) {
      toast.error(err?.message ?? 'Ne mogu da sačuvam kategoriju.');
    } finally {
      setCatSubmitting(false);
    }
  };

  const deleteCategory = async (cat: AdminCategory) => {
    if (!window.confirm(`Obrisati kategoriju "${cat.name}"? Ovo je soft-delete — teme ostaju.`)) return;
    try {
      await api.admin.deleteCategory(cat.slug);
      toast.success('Kategorija je obrisana.');
      await loadCategories();
    } catch (err: any) {
      toast.error(err?.message ?? 'Ne mogu da obrišem kategoriju.');
    }
  };

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
        setMaintenanceMessage(res.settings.maintenanceMessage || '');
        setDisableNewThreads(res.settings.disableNewThreads || false);
        setReadOnlyForum(res.settings.readOnlyForum || false);
        setAllowedEmailDomains((res.settings.allowedEmailDomains || []).join(', '));
        setBlockedEmailDomains((res.settings.blockedEmailDomains || []).join(', '));
        setSignatureMaxLength(res.settings.signatureMaxLength ?? 200);
        setAttachmentsPerPost(res.settings.attachmentsPerPost ?? 4);
        setDmMaxThreadsPerUser(res.settings.dmMaxThreadsPerUser ?? 25);
        setThreadsPerDay(res.settings.threadsPerDay ?? 0);
        setPostsPerDay(res.settings.postsPerDay ?? 0);
        setMinXpToPost(res.settings.minXpToPost ?? 0);
        setDmDisabled(res.settings.dmDisabled || false);
        setSeoMetaTitle(res.settings.seoMetaTitle || '');
        setSeoMetaDescription(res.settings.seoMetaDescription || '');
        setSeoOgImage(res.settings.seoOgImage || '');
        setAnalyticsId(res.settings.analyticsId || '');
        setSettingsLoaded(true);
      }
      return res;
    },
    enabled: isStaff && isAdmin,
  });

  // Mutacije
  const createArticleMutation = useMutation({
    mutationFn: (payload: ArticleInput) => api.articles.create(payload),
    onSuccess: (_data, payload) => {
      toast.success(payload?.status === 'scheduled' ? 'Članak je zakazan za objavu!' : 'Članak je uspešno objavljen!');
      closeArticleModal();
      queryClient.invalidateQueries({ queryKey: ['admin', 'articles'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Greška pri kreiranju članka.'),
  });

  const updateArticleMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ArticleInput }) => api.articles.update(id, payload),
    onSuccess: (_data, vars) => {
      toast.success(vars?.payload?.status === 'scheduled' ? 'Objava članka je zakazana!' : 'Članak je uspešno ažuriran!');
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

  const submitXpAdjust = async () => {
    if (!xpTarget) return;
    if (!xpAmount || xpAmount === 0) {
      toast.error('Količina XP-a ne sme biti 0.');
      return;
    }
    if (!xpReason.trim()) {
      toast.error('Razlog XP korekcije je obavezan.');
      return;
    }
    setXpSubmitting(true);
    try {
      const res = await api.admin.adjustXp(xpTarget.id, { amount: xpAmount, reason: xpReason.trim() });
      toast.success(res.message || 'XP korekcija sačuvana.');
      setXpTarget(null);
      setXpAmount(100);
      setXpReason('');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (err: any) {
      toast.error(err?.message || 'XP korekcija nije uspela.');
    } finally {
      setXpSubmitting(false);
    }
  };

  const submitAward = async () => {
    if (!awardTarget) return;
    if (!awardBadgeCode && (!awardXpBonus || awardXpBonus <= 0)) {
      toast.error('Izaberite bedž ili unesite XP bonus (bar jedno polje).');
      return;
    }
    setAwardSubmitting(true);
    try {
      await api.admin.awardUser(awardTarget.id, {
        badgeCode: awardBadgeCode || undefined,
        xpBonus: awardXpBonus > 0 ? awardXpBonus : undefined,
        reason: awardReason.trim() || undefined,
      });
      toast.success(`Nagrada uspešno dodeljena korisniku ${awardTarget.username}!`);
      setAwardTarget(null);
      setAwardBadgeCode('');
      setAwardXpBonus(100);
      setAwardReason('');
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
        ...(broadcastSubjectB.trim() ? { subjectB: broadcastSubjectB.trim() } : {}),
        // Zakazivanje: samo kada nije test mejl (test uvek ide odmah).
        ...(broadcastScheduledAt && !broadcastTest
          ? { scheduledAt: new Date(broadcastScheduledAt).toISOString() }
          : {}),
        ...(broadcastTest ? { testEmail: broadcastTest } : {}),
      });
      toast.success(res.message || 'Newsletter uspešno poslat!');
      if (!broadcastTest) {
        setBroadcastOpen(false);
        setBroadcastSubject('');
        setBroadcastSubjectB('');
        setBroadcastScheduledAt('');
        setBroadcastContent('');
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'newsletter', 'scheduled'] });
    } catch (err: any) {
      toast.error(err?.message || 'Slanje biltena nije uspelo.');
    } finally {
      setBroadcastSubmitting(false);
    }
  };

  /** Red zakazanih kampanja — učitava se kad se modal otvori. */
  const { data: scheduledData } = useQuery({
    queryKey: ['admin', 'newsletter', 'scheduled'],
    queryFn: () => api.admin.scheduledCampaigns(),
    enabled: broadcastOpen,
  });

  const cancelScheduledCampaign = async (id: string) => {
    try {
      await api.admin.cancelScheduledCampaign(id);
      toast.success('Kampanja je otkazana.');
      queryClient.invalidateQueries({ queryKey: ['admin', 'newsletter', 'scheduled'] });
    } catch (err: any) {
      toast.error(err?.message || 'Otkazivanje nije uspelo.');
    }
  };

  const runBulkAction = async () => {
    if (!selectedUserIds.length) return;
    try {
      const res = await api.admin.bulkUsers({ ids: selectedUserIds, action: bulkAction });
      toast.success(res.message);
      setSelectedUserIds([]);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-log'] });
    } catch (err: any) {
      toast.error(err?.message || 'Bulk akcija nije uspela.');
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
        maintenanceMessage,
        requireContentApproval,
        pendingNotice,
        disableNewThreads,
        readOnlyForum,
        allowedEmailDomains: allowedEmailDomains.split(',').map((d) => d.trim()).filter(Boolean),
        blockedEmailDomains: blockedEmailDomains.split(',').map((d) => d.trim()).filter(Boolean),
        signatureMaxLength: Number(signatureMaxLength) || 0,
        attachmentsPerPost: Number(attachmentsPerPost) || 0,
        dmMaxThreadsPerUser: Number(dmMaxThreadsPerUser) || 0,
        threadsPerDay: Number(threadsPerDay) || 0,
        postsPerDay: Number(postsPerDay) || 0,
        minXpToPost: Number(minXpToPost) || 0,
        dmDisabled,
        seoMetaTitle,
        seoMetaDescription,
        seoOgImage,
        analyticsId,
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
    setArticleScheduledFor('');
    setArticleIsFeatured(false);
    setArticleReviewScore('');
    setArticleReviewVerdict('');
    setArticleReviewPros('');
    setArticleReviewCons('');
    setArticleModalOpen(true);
  };

  const openEditArticleModal = (art: Article) => {
    setEditingArticle(art);
    setArticleTitle(art.title || '');
    setArticleCategory(art.category || 'Vesti');
    setArticleCoverImage(art.coverImage || '');
    setArticleExcerpt(art.excerpt || '');
    setArticleContent(art.content || '');
    setArticleStatus(art.status === 'draft' ? 'draft' : art.status === 'scheduled' ? 'scheduled' : 'published');
    // 2.10.0 — zakazani trenutak nazad u datetime-local format (lokalna zona korisnika).
    setArticleScheduledFor(
      art.status === 'scheduled' && art.publishedAt
        ? new Date(new Date(art.publishedAt).getTime() - new Date(art.publishedAt).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
        : '',
    );
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

    /** 2.10.0 — validacija zakazivanja na klijentu (≥5 min u budućnosti). */
    const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;
    let scheduledFor: string | undefined;
    if (articleStatus === 'scheduled') {
      if (!articleScheduledFor) {
        toast.error('Zakazani članak zahteva datum i vreme objave.');
        return;
      }
      const when = new Date(articleScheduledFor);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) {
        toast.error('Zakazano vreme mora biti najmanje 5 minuta u budućnosti.');
        return;
      }
      // Timezone konzistentnost: server prima uvek ISO UTC.
      scheduledFor = when.toISOString();
    }

    /** Potvrda: objavljen članak se ne vraća u 'scheduled' bez eksplicitne potvrde. */
    if (editingArticle && editingArticle.status === 'published' && articleStatus === 'scheduled') {
      if (!window.confirm(`Članak je već objavljen. Da li sigurno želite da zakazete njegovu ponovnu objavu za ${new Date(scheduledFor ?? '').toLocaleString('sr-RS')}?`)) {
        return;
      }
    }

    const payload: ArticleInput = {
      title: articleTitle.trim(),
      category: articleCategory,
      coverImage: articleCoverImage.trim() || undefined,
      excerpt: articleExcerpt.trim(),
      content: articleContent,
      status: articleStatus,
      scheduledFor,
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

  const handleRoleChange = (targetUser: OwnerUser, newRole: string) => {
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

  const handleModerateThread = (threadId: string, action: 'pin' | 'lock' | 'delete' | 'restore', current?: boolean) => {
    if (action === 'delete' && !window.confirm('Da li ste sigurni da želite da obrišete ovu temu?')) return;
    const body =
      action === 'delete'
        ? { deleteThread: true }
        : action === 'restore'
          ? { restoreThread: true }
          : action === 'pin'
            ? { isPinned: !current }
            : { isLocked: !current };
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
  const exportSubscribersCsv = (list: Subscriber[]) => {
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

  const copyAllEmails = (list: Subscriber[]) => {
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
    return rawAuditEntries.filter((e) => {
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
    return rawSubscribers.filter((s) => {
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

  // B-13 — samo „pending“ prijave; ne koristimo `total` iz `/api/reports` kao
  // primarni izvor (lista se paginuje), a `pendingCount` dolazi sa servera.
  const pendingReportsCount = statsData?.pendingCount ?? reportsData?.counts?.pending ?? reportsData?.reports?.length ?? 0;

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
    { label: 'Newsletter', value: statsData?.totalSubscribers ?? 0, change: 'Pretplate', icon: Mail, color: 'text-[var(--color-warning)]' },
    { label: 'Ukupno pregleda', value: statsData?.totalViews ?? 0, change: 'Članci i teme', icon: Eye, color: 'text-purple-400' },
  ];

  const tabs: Array<{ id: AdminTab; label: string; icon: any; badge?: number }> = [
    { id: 'articles', label: 'Članci', icon: FileText },
    { id: 'categories', label: 'Kategorije', icon: LayoutGrid },
    { id: 'users', label: 'Korisnici', icon: Users },
    { id: 'forum', label: 'Forum', icon: MessageSquare },
    { id: 'comments', label: 'Komentari', icon: MessageCircle, badge: rawComments.length },
    { id: 'reports', label: 'Prijave', icon: Flag, badge: pendingReportsCount },
    ...(isAdmin
      ? [
          { id: 'audit' as AdminTab, label: 'Revizorski log', icon: History },
          { id: 'newsletter' as AdminTab, label: 'Newsletter', icon: Mail },
          { id: 'media' as AdminTab, label: 'Mediji', icon: ImageIcon },
          { id: 'system' as AdminTab, label: 'Sistem', icon: Server },
          { id: 'settings' as AdminTab, label: 'Podešavanja', icon: Sliders },
        ]
      : []),
  ];

  return (
    <div className="section">
      <div className="container">
        {/* U-15 — ADMIN SHELL
            Ranije: horizontalni tabovi, veliki header i admin unos je izgledao
            kao druga aplikacija. Sada je navigacija u fiksnoj levoj koloni
            (sticky na 13" laptopu), metrike su jedan red, a
            statusi violet/rose — admin izgleda kao deo NEXUS brenda. */}
        <div className="mb-6 flex-wrap items-end justify-between gap-4 border-b-[var(--color-border-subtle)] pb-5">
          <div>
            <span className="eyebrow mb-2">Operacije</span>
            <h1 className="page-title">Admin</h1>
            <p className="text-lead mt-2">
              Sadržaj, članovi, moderacija i sistem — na jednom mestu.
              {currentUser?.role === 'moderator' && (
                <span className="ml-2 text-[var(--color-text-tertiary)]">Moderatorski pristup.</span>
              )}
            </p>
          </div>
          <div className="flex-wrap items-center gap-2">
            <Link to="/admin/reports" className="ui-btn br-secondary ui-btn-sm">
              <Flag size={14} />
              Prijave
              {pendingReportsCount > 0 && (
                <span className="ml-1 rounded-full bg-[var(--color-tertiary)] px-1.5 font-mono text-micro font-semibold text-[var(--color-on-solid)]">
                  {pendingReportsCount}
                </span>
              )}
            </Link>
            <button type="button" onClick={openCreateArticleModal} className="ui-btn br-primary ui-btn-sm">
              <Plus size={14} />
              Novi članak
            </button>
          </div>
        </div>

        {/* Metrike: jedan red, mono brojevi (isti jezik kao profil/deals) */}
        <div className="mb-6 grid-cols-2 border-t-[var(--color-border-subtle)] lg:grid-cols-5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-2.5 border-l-[var(--color-border-subtle)] py-3.5 pl-4 first:border-l-0 first:pl-0"
            >
              <stat.icon className={stat.color} size={18} aria-hidden="true" />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="font-mono text-[1.375rem] font-semibold tabular-nums text-[var(--color-text-primary)]">
                  <CountUp end={stat.value} duration={1.2} separator="." useEasing />
                </span>
                <span className="text-label truncate">{stat.label}</span>
                <span className="text-micro truncate">{stat.change}</span>
              </div>
            </div>
          ))}
        </div>

        {/* F-7b — analitički grafikoni (pregledi po danu, top članci, distribucija) */}
        <AdminAnalytics />

        {/* 2.13.2 — odakle dolaze vesti i kakav je kvalitet poslednjih uvoza */}
        <AdminNewsSources />

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
          {/* Sidebar navigacija — vertikalna, sticky, čitljiva na 13" */}
          <nav
            className="rail-panel lg:col-span-3 lg:sticky lg:top-24"
            aria-label="Admin sekcije"
          >
            <p className="rail-title mb-2">Sekcije</p>
            <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'flex flex-none items-center gap-2 rounded-md px-3 py-2.5 text-left text-[0.9375rem] font-medium transition lg:w-full ' +
                      (active
                        ? 'bg-[var(--color-primary-subtle)] text-[var(--color-primary-fg)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]')
                    }
                  >
                    <tab.icon size={16} aria-hidden="true" />
                    <span className="whitespace-nowrap">{tab.label}</span>
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span className="ml-auto rounded-sm bg-[var(--color-surface-2)] px-1.5 font-mono text-micro tabular-nums text-[var(--color-text-secondary)]">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0 rounded-xl border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-4 md:p-6 lg:col-span-9">
            {/* TAB: ČLANCI */}
            {activeTab === 'articles' && (
              <div className="space-y-5">
                <div className="flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-h2">Članci</h2>
                    <p className="text-meta mt-1">
                      {filteredArticles.length} od {rawArticles.length} — pretraga, status i kategorija filtriraju listu.
                    </p>
                  </div>
                  <button type="button" onClick={openCreateArticleModal} className="ui-btn br-primary ui-btn-sm">
                    <Plus size={14} /> Novi članak
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-4">
                  <div className="relative min-w-[200px] flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Pretraži po naslovu ili autoru…"
                      value={articleSearch}
                      onChange={(e) => setArticleSearch(e.target.value)}
                      className="ui-field !py-1.5 !pl-9 !text-sm"
                    />
                  </div>
                  <select value={articleCategoryFilter} onChange={(e) => setArticleCategoryFilter(e.target.value)} className="ui-field !w-auto !py-1.5 !text-sm" aria-label="Kategorija">
                    <option value="all">Sve kategorije</option>
                    {ARTICLE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <select value={articleStatusFilter} onChange={(e) => setArticleStatusFilter(e.target.value)} className="ui-field !w-auto !py-1.5 !text-sm" aria-label="Status">
                    <option value="all">Svi statusi</option>
                    <option value="published">Objavljeni</option>
                    <option value="scheduled">Zakazani</option>
                    <option value="draft">Draftovi</option>
                  </select>
                </div>

                {filteredArticles.length === 0 ? (
                  <p className="py-12 text-center text-meta">Nema članaka koji odgovaraju pretrazi.</p>
                ) : (
                  <ul className="border-t border-[var(--color-border-default)]">
                    {filteredArticles.map((art: any) => (
                      <li
                        key={art.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--color-border-subtle)] px-1 py-3 transition hover:bg-[var(--color-surface-2)]"
                      >
                        {art.coverImage ? (
                          <img src={art.coverImage} alt="" loading="lazy" className="hidden h-11 w-16 flex-shrink-0 rounded-md border-[var(--color-border-default)] object-cover sm:block" />
                        ) : (
                          <span className="hidden h-11 w-16 flex-shrink-0 place-items-center rounded-md bg-[var(--color-surface-2)] text-[var(--color-text-muted)] sm:grid">
                            <FileText size={18} />
                          </span>
                        )}

                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/article/${art.slug || art.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-1 text-[0.9375rem] font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary-fg)]"
                          >
                            {art.title}
                          </Link>
                          <div className="meta-row mt-0.5">
                            <span className="text-[var(--color-primary-fg)]">{art.category}</span>
                            <span>{art.author}</span>
                            <span className="font-mono">{art.views || 0} pregleda</span>
                            {art.reviewScorecard?.score !== undefined && (
                              <span className="font-mono">{art.reviewScorecard.score}/10</span>
                            )}
                          </div>
                        </div>

                        <div className="flex w-full items-center gap-2 sm:w-auto">
                          {/* 2.10.0 — bedž sa statusom i zakazanim datumom. */}
                          <Badge
                            tone={art.status === 'published' ? 'success' : art.status === 'scheduled' ? 'warning' : 'neutral'}
                            title={art.status === 'scheduled' && art.publishedAt ? `Zakazano za ${new Date(art.publishedAt).toLocaleString('sr-RS')}` : undefined}
                          >
                            {art.status === 'published'
                              ? 'Objavljeno'
                              : art.status === 'scheduled'
                                ? (<>🕐 {art.publishedAt ? new Date(art.publishedAt).toLocaleString('sr-RS') : 'Zakazano'}</>)
                                : 'Draft'}
                          </Badge>
                          {art.isFeatured && (
                            <Badge tone="primary" title="Glavna priča (HERO)">
                              <Sparkles size={11} /> HERO
                            </Badge>
                          )}
                          <div className="ml-auto flex items-center gap-0.5">
                            <Link
                              to={`/article/${art.slug || art.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-icon-btn !h-8 !w-8"
                              title="Pogledaj na portalu"
                              aria-label={`Pogledaj: ${art.title}`}
                            >
                              <ExternalLink size={14} />
                            </Link>
                            <button type="button" onClick={() => openEditArticleModal(art)} className="ui-icon-btn !h-8 !w-8" title="Izmeni članak" aria-label={`Izmeni: ${art.title}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" onClick={() => handleDeleteArticle(art.id, art.title)} className="ui-icon-btn !h-8 !w-8 hover:!text-[var(--color-error)]" title="Obriši članak" aria-label={`Obriši: ${art.title}`}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
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
                  {isAdmin && selectedUserIds.length > 0 && (
                    <>
                      <span className="text-xs font-semibold text-white/60">
                        Izabrano: {selectedUserIds.length}
                      </span>
                      <select
                        value={bulkAction}
                        onChange={(e) => setBulkAction(e.target.value as BulkAction)}
                        className="ui-field !w-auto !py-1.5 !text-xs"
                      >
                        <option value="ban">Banuj</option>
                        <option value="unban">Odbanuj</option>
                        <option value="mute">Mute (24h)</option>
                      </select>
                      <button
                        onClick={runBulkAction}
                        className="ui-btn br-secondary ui-btn-sm text-[var(--color-warning)]"
                      >
                        Izvrši nad {selectedUserIds.length}
                      </button>
                      <button
                        onClick={() => setSelectedUserIds([])}
                        className="ui-btn br-secondary ui-btn-sm"
                      >
                        Otkaži
                      </button>
                    </>
                  )}
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
                            {isAdmin && !isSelf && u.role !== 'admin' && (
                              <input
                                type="checkbox"
                                checked={selectedUserIds.includes(u.id)}
                                onChange={(e) => {
                                  setSelectedUserIds((prev) =>
                                    e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                                  );
                                }}
                                className="w-4 h-4 rounded border-white/20 bg-surface-1 text-[var(--color-primary)] flex-shrink-0"
                                title="Izaberi za bulk akciju"
                              />
                            )}
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
                                  setAwardReason('');
                                }}
                                className="ui-btn br-secondary ui-btn-sm flex items-center gap-1 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
                                title="Dodeli bedž ili XP"
                              >
                                <Award size={14} />
                                <span>Nagradi</span>
                              </button>
                            )}

                            {isAdmin && (
                              <button
                                onClick={() => {
                                  setXpTarget(u);
                                  setXpAmount(100);
                                  setXpReason('');
                                }}
                                className="ui-btn br-secondary ui-btn-sm flex items-center gap-1 text-[var(--color-primary-fg)]"
                                title="Ručna XP korekcija (nagradi ili kazni)"
                              >
                                <Zap size={14} />
                                <span>XP</span>
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

                            {!u.isBanned && u.role !== 'admin' && (
                              /* F-10 — upozorenje PRE bana; ban ostaje poslednja mera. */
                              <button
                                onClick={() => setWarnTarget(u)}
                                className="rounded-lg border-[var(--color-warning)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-fg)] hover:bg-[var(--color-warning)]/10"
                                title="Upozori korisnika (razlog + rok) — pre bana"
                              >
                                Upozori
                              </button>
                            )}

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

            {/* TAB: KATEGORIJE (ADMIN ONLY) */}
            {activeTab === 'categories' && isAdmin && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold">Kategorije i subforumi</h2>
                  <p className="text-xs text-white/50 mt-1">Kreiraj, izmeni ili sakrij subforume. Brisanje je soft-delete — postojeće teme ostaju.</p>
                </div>

                {/* Forma za kreiranje/izmenu */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitCategory();
                  }}
                  className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4"
                >
                  <h3 className="font-bold text-lg text-white">
                    {catEditing ? `Izmeni: ${catName}` : 'Nova kategorija'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-white/70">Naziv *</label>
                      <input
                        type="text"
                        value={catName}
                        onChange={(e) => setCatName(e.target.value)}
                        className="ui-field w-full"
                        maxLength={60}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-white/70">Slug (URL)</label>
                      <input
                        type="text"
                        value={catSlug}
                        onChange={(e) => setCatSlug(e.target.value)}
                        className="ui-field w-full"
                        placeholder="auto iz naziva"
                        maxLength={60}
                        disabled={catEditing}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1 text-white/70">Ikonica (emoji)</label>
                      <input
                        type="text"
                        value={catIcon}
                        onChange={(e) => setCatIcon(e.target.value)}
                        className="ui-field w-full"
                        maxLength={8}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1 text-white/70">Opis</label>
                    <textarea
                      value={catDescription}
                      onChange={(e) => setCatDescription(e.target.value)}
                      className="ui-field w-full"
                      rows={2}
                      maxLength={200}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    {catEditing && (
                      <button type="button" onClick={resetCategoryForm} className="btn-secondary">
                        Otkaži izmenu
                      </button>
                    )}
                    <button type="submit" className="btn-primary" disabled={catSubmitting}>
                      {catSubmitting ? 'Čuvam...' : catEditing ? 'Sačuvaj izmene' : 'Kreiraj kategoriju'}
                    </button>
                  </div>
                </form>

                {/* Lista postojećih */}
                {catLoading ? (
                  <div className="text-white/40 text-sm">Učitavam...</div>
                ) : (
                  <div className="space-y-2">
                    {categories.map((cat) => (
                      <div
                        key={cat.slug}
                        className="rounded-md border border-white/[0.07] bg-surface-1 p-4 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xl">{cat.icon || '💬'}</span>
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">{cat.name}</div>
                            <div className="text-xs text-white/50 truncate">/{cat.slug} · {cat.threads ?? 0} tema</div>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            onClick={() => startEditCategory(cat)}
                            className="ui-btn br-secondary ui-btn-sm"
                          >
                            Izmeni
                          </button>
                          <button
                            onClick={() => deleteCategory(cat)}
                            className="rounded-lg border border-[var(--color-error)]/40 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-[var(--color-error)]/10"
                          >
                            Obriši
                          </button>
                        </div>
                      </div>
                    ))}
                    {categories.length === 0 && <div className="text-white/40 text-sm">Nema kategorija.</div>}
                  </div>
                )}
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
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--color-warning)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--color-warning)] border border-[var(--color-warning)]/30">
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
                                thr.isPinned ? 'text-[var(--color-warning)]' : ''
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
                            {/* F-10 — poništi soft-delete (ranije samo kroz bazu). */}
                            {thr.isDeleted && (
                              <button
                                onClick={() => handleModerateThread(thr.id, 'restore')}
                                className="ui-btn br-secondary ui-btn-sm flex items-center gap-1 text-[var(--color-success-fg)]"
                                title="Vrati obrisanu temu"
                              >
                                <Undo2 size={14} />
                                <span>Vrati</span>
                              </button>
                            )}
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
                    reportsData.reports.map((report) => (
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
                    filteredSubscribers.map((sub) => (
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

            {/* TAB: SISTEM (ADMIN ONLY) — rate limiti, IP banovi, CSV export */}
            {activeTab === 'system' && isAdmin && <SystemTab />}

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
                      <Shield size={20} className="text-[var(--color-warning)]" />
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

                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Poruka na ekranu za održavanje</label>
                        <input
                          type="text"
                          value={maintenanceMessage}
                          onChange={(e) => setMaintenanceMessage(e.target.value)}
                          placeholder="npr. Portal je trenutno u režimu održavanja. Vratite se uskoro!"
                          className="ui-field w-full"
                          maxLength={300}
                        />
                      </div>

                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Moderacija: sadržaj čeka odobrenje</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Nove teme i odgovori su vidljivi samo adminima dok ih moderator ne odobri.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={requireContentApproval}
                          onChange={(e) => setRequireContentApproval(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>

                      {requireContentApproval && (
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Poruka dok sadržaj čeka odobrenje</label>
                          <input
                            type="text"
                            value={pendingNotice}
                            onChange={(e) => setPendingNotice(e.target.value)}
                            placeholder="Vaš doprinos čeka odobrenje administratora."
                            className="ui-field w-full"
                            maxLength={200}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Forum i sadržaj */}
                  <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <MessageSquare size={20} className="text-[var(--color-primary-fg)]" />
                      <span>Forum i sadržaj</span>
                    </h3>

                    <div className="space-y-3">
                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Zatvori otvaranje novih tema</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Odgovori u postojećim temama ostaju dozvoljeni.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={disableNewThreads}
                          onChange={(e) => setDisableNewThreads(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>

                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Forum samo za čitanje</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Korisnici ne mogu ni da odgovaraju — samo da čitaju. Admin/moderator izuzet.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={readOnlyForum}
                          onChange={(e) => setReadOnlyForum(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Maksimalna dužina potpisa (znakovа, 0 = isključen)</label>
                          <input
                            type="number"
                            min={0}
                            max={500}
                            value={signatureMaxLength}
                            onChange={(e) => setSignatureMaxLength(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Maksimalan broj priloga u postu (0 = bez priloga)</label>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={attachmentsPerPost}
                            onChange={(e) => setAttachmentsPerPost(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Maksimalan broj DM razgovora (0 = DM isključen)</label>
                          <input
                            type="number"
                            min={0}
                            max={200}
                            value={dmMaxThreadsPerUser}
                            onChange={(e) => setDmMaxThreadsPerUser(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Najmanji XP za otvaranje teme (0 = svi mogu)</label>
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            value={minXpToPost}
                            onChange={(e) => setMinXpToPost(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Maksimalan broj tema po korisniku dnevno (0 = bez limita)</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={threadsPerDay}
                            onChange={(e) => setThreadsPerDay(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1 text-white/70">Maksimalan broj odgovora po korisniku dnevno (0 = bez limita)</label>
                          <input
                            type="number"
                            min={0}
                            max={500}
                            value={postsPerDay}
                            onChange={(e) => setPostsPerDay(Number(e.target.value))}
                            className="ui-field w-full"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Registracija i domeni */}
                  <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <Shield size={20} className="text-[var(--color-warning)]" />
                      <span>Registracija i email domeni</span>
                    </h3>

                    <div className="space-y-3">
                      <label className="flex items-center justify-between p-3 rounded-md border border-white/5 bg-surface-1 cursor-pointer hover:border-white/10 transition">
                        <div>
                          <div className="font-semibold text-sm text-white">Isključi privatne poruke (DM)</div>
                          <div className="text-xs text-white/50 mt-0.5">
                            Korisnici ne mogu da otvaraju nove razgovore (admin/moderator izuzet).
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={dmDisabled}
                          onChange={(e) => setDmDisabled(e.target.checked)}
                          className="w-5 h-5 rounded border-white/20 bg-surface-1 text-[var(--color-primary)]"
                        />
                      </label>

                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">
                          Dozvoljeni email domeni (allowlist, razdvojeni zarezom — prazno = svi domeni)
                        </label>
                        <input
                          type="text"
                          value={allowedEmailDomains}
                          onChange={(e) => setAllowedEmailDomains(e.target.value)}
                          placeholder="npr. gmail.com, outlook.com"
                          className="ui-field w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">
                          Blokirani email domeni (blocklist, razdvojeni zarezom — ima prednost)
                        </label>
                        <input
                          type="text"
                          value={blockedEmailDomains}
                          onChange={(e) => setBlockedEmailDomains(e.target.value)}
                          placeholder="npr. spam.com, tempmail.com"
                          className="ui-field w-full"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SEO i analitika */}
                  <div className="rounded-lg border border-white/[0.09] bg-surface-2 p-6 space-y-4">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                      <Globe size={20} className="text-[var(--color-primary-fg)]" />
                      <span>SEO i analitika</span>
                    </h3>

                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Default meta naslov (SEO)</label>
                        <input
                          type="text"
                          value={seoMetaTitle}
                          onChange={(e) => setSeoMetaTitle(e.target.value)}
                          placeholder="npr. Vanguard Gaming Portal — vesti, forum i popusti"
                          className="ui-field w-full"
                          maxLength={120}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Default meta opis (SEO)</label>
                        <textarea
                          value={seoMetaDescription}
                          onChange={(e) => setSeoMetaDescription(e.target.value)}
                          placeholder="npr. Najveća gaming zajednica u regionu — najnovije vesti, forum i popusti na igre."
                          className="ui-field w-full"
                          rows={2}
                          maxLength={200}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Default OG slika (URL)</label>
                        <input
                          type="text"
                          value={seoOgImage}
                          onChange={(e) => setSeoOgImage(e.target.value)}
                          placeholder="https://..."
                          className="ui-field w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1 text-white/70">Google Analytics / Plausible ID</label>
                        <input
                          type="text"
                          value={analyticsId}
                          onChange={(e) => setAnalyticsId(e.target.value)}
                          placeholder="npr. G-XXXXXXXXXX"
                          className="ui-field w-full"
                          maxLength={40}
                        />
                      </div>
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
                      onChange={(e) => setArticleStatus(e.target.value as 'published' | 'draft' | 'scheduled')}
                      className="ui-field w-full"
                    >
                      <option value="published">Objavi odmah (javno vidljivo)</option>
                      <option value="scheduled">Zakaži objavu (posle tačnog trenutka)</option>
                      <option value="draft">Draft (radna verzija)</option>
                    </select>
                  </div>
                </div>

                {/* 2.10.0 — DateTimePicker za zakazanu objavu (lokalna zona korisnika). */}
                {articleStatus === 'scheduled' && (
                  <div>
                    <label className="block text-sm font-semibold mb-1">Datum i vreme objave</label>
                    <input
                      type="datetime-local"
                      value={articleScheduledFor}
                      onChange={(e) => setArticleScheduledFor(e.target.value)}
                      className="ui-field w-full"
                      required
                    />
                    <p className="text-meta mt-1">
                      Prikazuje se u tvojoj lokalnoj vremenskoj zoni; serveru se šalje UTC.
                      Minimum 5 minuta u budućnosti.
                    </p>
                  </div>
                )}

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
                    <span className="text-[var(--color-warning)]">★</span>
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

        {/* F-10 — MODAL ZA UPOZORENJE (korak PRE bana) */}
        {warnTarget && (
          <div className="ui-modal-backdrop">
            <form
              className="w-full max-w-md animate-fade-in rounded-lg border-white/[0.14] bg-surface-2 p-6"
              onSubmit={async (event) => {
                event.preventDefault();
                if (warnReason.trim().length < 5) {
                  toast.error("Razlog upozorenja je prekratak.");
                  return;
                }
                setWarnSubmitting(true);
                try {
                  const result = await api.users.warn(warnTarget.id, {
                    reason: warnReason.trim(),
                    expiresInDays: warnDays === "none" ? null : Number(warnDays),
                  });
                  toast.success(
                    result.suggestBan
                      ? `Upozorenje je poslato (${result.activeCount} aktivnih) — razmislite o banu.`
                      : "Upozorenje je poslato.",
                  );
                  setWarnTarget(null);
                  setWarnReason("");
                } catch (error: any) {
                  toast.error(error?.message || "Upozorenje nije poslato.");
                } finally {
                  setWarnSubmitting(false);
                }
              }}
            >
              <div className="mb-2 flex items-center gap-2 text-[var(--color-warning-fg)]">
                <ShieldAlert size={20} />
                <h3 className="text-xl font-bold">Upozori: {warnTarget.username}</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                Upozorenje se čuva u revizorskom logu i korisnik ga vidi na profilu do potvrde.
                Ban je poslednja mera — tri aktivna upozorenja su signal da je vreme za njega.
              </p>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Razlog (vidi korisnik)</span>
                <textarea
                  value={warnReason}
                  onChange={(event) => setWarnReason(event.target.value)}
                  className="ui-field min-h-[88px] w-full text-sm"
                  maxLength={500}
                  placeholder="npr. Vređanje u temi „Najbolji RPG 2026“ — pravilo 3.2"
                  required
                />
              </label>

              <label className="mt-4 block space-y-1.5">
                <span className="text-xs font-semibold text-white/70">Važi</span>
                <select value={warnDays} onChange={(event) => setWarnDays(event.target.value)} className="ui-field w-full text-sm">
                  <option value="7">7 dana</option>
                  <option value="30">30 dana</option>
                  <option value="90">90 dana</option>
                  <option value="none">Bez roka (opoziva se ručno)</option>
                </select>
              </label>

              <div className="mt-6 flex justify-end gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setWarnTarget(null)}>
                  Otkaži
                </Button>
                <Button size="sm" type="submit" loading={warnSubmitting}>
                  Pošalji upozorenje
                </Button>
              </div>
            </form>
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
              <div className="flex items-center gap-2 mb-2 text-[var(--color-warning)]">
                <Award size={22} />
                <h3 className="text-xl font-bold">Nagradi: {awardTarget.username}</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                Dodeli poseban bedž ili XP bonus. Korisnik dobija poruku u notifikacijama, a akcija ide u
                revizorski log.
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
                    {SYSTEM_BADGES.map((badge) => {
                      const owned = (awardTarget.badges ?? []).includes(badge.id);
                      return (
                        <option key={badge.id} value={badge.id} disabled={owned}>
                          {badge.name} — {badge.desc}
                          {owned ? ' (već poseduje)' : ''}
                        </option>
                      );
                    })}
                  </select>
                  {awardBadgeCode && (
                    <span className="inline-flex pt-1">
                      <BadgeChip id={awardBadgeCode} size="xs" showRarity />
                    </span>
                  )}
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold">XP Bonus (iskustvo)</span>
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    step="50"
                    value={awardXpBonus}
                    onChange={(e) => setAwardXpBonus(Number(e.target.value))}
                    className="ui-field w-full"
                  />
                  <span className="text-[11px] text-white/40">
                    {awardXpBonus > 0
                      ? `${awardTarget.xp} XP → ${awardTarget.xp + awardXpBonus} XP. Nivo i rang lista se osvežavaju automatski.`
                      : '0 = bez XP bonusa (možeš dodeliti samo bedž).'}
                  </span>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-semibold">
                    Razlog <span className="font-normal text-white/40">(opciono — vidi ga korisnik)</span>
                  </span>
                  <input
                    type="text"
                    value={awardReason}
                    onChange={(e) => setAwardReason(e.target.value)}
                    placeholder="npr. Zahvalnost za 10 prijavljenih bagova u beta testu"
                    className="ui-field w-full"
                    maxLength={200}
                  />
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAwardTarget(null);
                    setAwardBadgeCode('');
                    setAwardXpBonus(100);
                    setAwardReason('');
                  }}
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

        {/* MODAL ZA XP KOREKCIJU (nagradi/kazni) */}
        {xpTarget && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 w-full max-w-md animate-fade-in p-6">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-primary-fg)]">
                <Zap size={22} />
                <h3 className="text-xl font-bold">XP korekcija: {xpTarget.username}</h3>
              </div>
              <p className="mb-4 text-sm text-white/50">
                Trenutno: {xpTarget.xp} XP, nivo {xpTarget.level}. Negativan broj oduzima XP (nikad ispod 0).
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitXpAdjust();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-semibold mb-1">Količina XP (može biti negativna)</label>
                  <input
                    type="number"
                    value={xpAmount}
                    onChange={(e) => setXpAmount(Number(e.target.value))}
                    className="ui-field w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Razlog (obavezno, ide u revizorski log)</label>
                  <input
                    type="text"
                    value={xpReason}
                    onChange={(e) => setXpReason(e.target.value)}
                    placeholder="npr. Pobeda u turniru / kazna za spam"
                    className="ui-field w-full"
                    maxLength={200}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setXpTarget(null)} className="btn-secondary">
                    Otkaži
                  </button>
                  <button type="submit" className="btn-primary" disabled={xpSubmitting}>
                    <Zap size={14} />
                    <span>{xpSubmitting ? 'Čuvam...' : 'Sačuvaj'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL ZA NEWSLETTER BROADCAST EMAIL */}
        {broadcastOpen && (
          <div className="ui-modal-backdrop">
            <div className="rounded-lg border border-white/[0.14] bg-surface-2 w-full max-w-xl animate-fade-in p-6">
              <div className="flex items-center gap-2 mb-2 text-[var(--color-primary-fg)]">
                <Send size={22} />
                <h3 className="text-xl font-bold">Newsletter Bilten</h3>
              </div>
              <p className="mb-4 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-sm text-white/70">
                Slanje mejlom je ugašeno — mejl se šalje samo za verifikaciju adrese i reset lozinke. Zakazivanje i dalje upisuje kampanju u red, ali nijedan mejl ne odlazi.
              </p>
              <p className="mb-4 text-sm text-white/50">
                {broadcastTest
                  ? `Test režim: jedan mejl ide na ${broadcastTest} — ne šalje se (kanal je ugašen).`
                  : `Segment „${broadcastSegment === 'active' ? 'potvrđeni' : broadcastSegment === 'pending' ? 'na čekanju' : 'svi'}“ (${subscriberCounts[broadcastSegment] ?? 0} adresa).`}
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

                {/* A/B test: druga varijanta naslova ide polovini liste. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">{t('newsletter.subjectB')}</span>
                    <input
                      type="text"
                      value={broadcastSubjectB}
                      onChange={(e) => setBroadcastSubjectB(e.target.value)}
                      placeholder="Drugačiji naslov za polovinu liste"
                      className="ui-field w-full"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">{t('newsletter.schedule')}</span>
                    <input
                      type="datetime-local"
                      value={broadcastScheduledAt}
                      onChange={(e) => setBroadcastScheduledAt(e.target.value)}
                      disabled={Boolean(broadcastTest)}
                      className="ui-field w-full"
                    />
                  </label>
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
                    <span>{broadcastSubmitting ? 'Slanje...' : broadcastTest ? 'Pošalji test' : broadcastScheduledAt ? 'Zakaži kampanju' : 'Pošalji pretplatnicima'}</span>
                  </button>
                </div>
              </form>

              {/* Red zakazanih kampanja: `scheduledAt` + status (poslato/propušteno). */}
              {(scheduledData?.campaigns?.length ?? 0) > 0 && (
                <div className="mt-6 border-t border-white/10 pt-4">
                  <h4 className="mb-2 text-sm font-bold">{t('newsletter.scheduled')}</h4>
                  <ul className="space-y-2">
                    {scheduledData!.campaigns.slice(-10).reverse().map((campaign) => (
                      <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-2 rounded border-white/10 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white/85">{campaign.subject}</p>
                          <p className="text-white/50">
                            {new Date(campaign.scheduledAt).toLocaleString('sr-RS')} · {campaign.segment}
                            {campaign.subjectB ? ' · A/B' : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold">
                            {campaign.status === 'sent' ? `poslato (${campaign.sentCount ?? 0})`
                              : campaign.status === 'scheduled' ? 'zakazano'
                                : campaign.status === 'failed' ? 'neuspešno' : 'propušteno'}
                          </span>
                          {campaign.status === 'scheduled' && (
                            <button
                              type="button"
                              className="ui-btn br-ghost ui-btn-sm text-red-300"
                              onClick={() => cancelScheduledCampaign(campaign.id)}
                            >
                              Otkaži
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
