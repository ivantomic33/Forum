import { useState } from 'react';
import { Flag } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useAuthStore } from '../store/authStore';
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
  { value: 'spam', label: 'Spam / reklamiranje' },
  { value: 'harassment', label: 'Uznemiravanje / govor mr�nje' },
  { value: 'off_topic', label: 'Potpuno van teme' },
  { value: 'illegal', label: 'Nezakonit sadr�aj' },
  { value: 'spoiler', label: 'Nenajavljen spojler' },
  { value: 'other', label: 'Drugo' },
];

/**
 * ReportButton � "Prijavi" dugme za temu, odgovor, clanak ili komentar.
 * Prijava ide u moderacioni red (`POST /api/reports`) i vidljiva je na /admin/reports.
 */
export function ReportButton({ targetType, targetId, label = 'Prijavi', className }: ReportButtonProps) {
  const { isAuthenticated } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('spam');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isAuthenticated) return null;

  const handleSubmit = async () => {
    const selected = REASONS.find((r) => r.value === reason)?.label ?? reason;
    const fullReason = note.trim() ? `${selected}: ${note.trim()}` : selected;

    if (fullReason.length < 10) {
      toast.error('Razlog mora imati najmanje 10 karaktera.');
      return;
    }

    setSubmitting(true);
    try {
      await api.reports.create({ targetType, targetId, reason: fullReason });
      toast.success('Prijava je poslata moderatorima. Hvala!');
      setOpen(false);
      setNote('');
    } catch (err: any) {
      toast.error(err?.message || 'Prijava nije poslata. Poku�ajte ponovo.');
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
        title="Prijavi sadr�aj moderatorima"
      >
        <Flag size={12} />
        {label}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Prijavi sadr�aj"
        description="Moderator ce pregledati prijavu. Zloupotreba prijava mo�e dovesti do sankcija."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Otka�i
            </Button>
            <Button variant="danger" onClick={handleSubmit} loading={submitting}>
              Po�alji prijavu
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Razlog</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-white/70">Dodatno obja�njenje (opciono)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              className="w-full resize-none rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white"
              placeholder="Kratko opi�ite problem..."
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
