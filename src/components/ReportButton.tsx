import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useT } from '../lib/i18n';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

type ReportTarget = 'thread' | 'reply' | 'article' | 'comment' | 'user' | 'deal';

interface ReportButtonProps {
  targetType: ReportTarget;
  targetId: string;
  /** Opcioni label; podrazumevano je ikonica + "Prijavi". */
  label?: string;
  className?: string;
}

const REASONS = [
  { value: 'spam', labelKey: 'reports.reasonSpam' },
  { value: 'harassment', labelKey: 'reports.reasonHarassment' },
  { value: 'off_topic', labelKey: 'reports.reasonOffTopic' },
  { value: 'illegal', labelKey: 'reports.reasonIllegal' },
  { value: 'spoiler', labelKey: 'reports.reasonSpoiler' },
  { value: 'other', labelKey: 'reports.reasonOther' },
] as const;

/**
 * ReportButton � "Prijavi" dugme za temu, odgovor, clanak ili komentar.
 * Prijava ide u moderacioni red (`POST /api/reports`) i vidljiva je na /admin/reports.
 */
export function ReportButton({ targetType, targetId, label, className }: ReportButtonProps) {
  const t = useT();
  const { isAuthenticated } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isAuthenticated) return null;

  const handleSubmit = async () => {
    const selected = t(REASONS.find((r) => r.value === reason)?.labelKey ?? 'reports.reasonOther');
    const fullReason = note.trim() ? `${selected}: ${note.trim()}` : selected;

    if (fullReason.length < 10) {
      toast.error(t('reports.minReason'));
      return;
    }

    setSubmitting(true);
    try {
      await api.reports.create({ targetType, targetId, reason: fullReason });
      toast.success(t('reports.submitted'));
      setOpen(false);
      setNote('');
    } catch (err: any) {
      toast.error(err?.message || t('reports.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? 'inline-flex items-center gap-1 text-xs text-white/55 hover:text-rose-400'}
        title={t('reports.title')}
      >
        <Flag size={12} />
        {label ?? t('reports.reportTarget')}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('reports.title')}
        description={t('reports.subtitle')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleSubmit} loading={submitting}>
              {t('reports.send')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">{t('reports.reason')}</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">{t('reports.note')}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              className="w-full resize-none rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white"
              placeholder={t('reports.notePlaceholder')}
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
