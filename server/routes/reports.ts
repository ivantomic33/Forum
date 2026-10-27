import { Router } from 'express';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/store.js';
import { z } from 'zod';
import { validate } from '../lib/schemas.js';
import { reportListResponseSchema, reportResponseSchema, reportTargetTypeSchema } from '../../contracts/index.js';
import { respond } from '../lib/respond.js';
import { notify, notifyStaff } from '../lib/notifications.js';
import { newId } from '../lib/store.js';

const router = Router();

// Schema za kreiranje report-a
const createReportSchema = z.object({
  targetType: reportTargetTypeSchema,
  targetId: z.string().min(1, 'ID sadržaja je obavezan').max(100),
  reason: z.string().min(10, 'Razlog mora imati najmanje 10 karaktera').max(500, 'Razlog je predug'),
});

// Schema za rešavanje report-a
const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolutionNote: z.string().optional(),
});

// POST /api/reports - Kreiraj report
router.post('/', authenticate, requireVerified, async (req: AuthRequest, res) => {
  try {
    const parsed = validate(createReportSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const { targetType, targetId, reason } = parsed.data;
    const reporterId = req.user!.id;

    // Proveri da li korisnik već ima pending report za isti target
    const existing = await db.reports?.findByReporter(reporterId, targetType, targetId);
    if (existing?.some((r: any) => r.status === 'pending')) {
      return res.status(409).json({ error: 'Već ste prijavili ovaj sadržaj.' });
    }

    const report = await db.reports?.create({
      // `reports.id` je UUID u bazi — prefiksovani id je bacao insert.
      id: newId(),
      targetType,
      targetId,
      reporterId,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    req.log?.info({ reportId: report?.id, targetType, targetId }, 'content_reported');

    // 3.0.0 — prijava je „vruće“ obaveštenje za staff: zvonce + push, sa linkom
    // na red prijava koji čeka odluku.
    void notifyStaff({
      title: 'Nova prijava sadržaja',
      message: `${req.user!.username} je prijavio/la ${targetType} (${targetId}): ${reason.slice(0, 120)}`,
      link: '/admin/reports',
      actorId: req.user!.id,
      metadata: { reportId: report?.id ?? null, targetType, targetId },
    }).catch(() => null);

    res.status(201).json({ message: 'Prijava je uspešno poslata.', report });
  } catch (err: any) {
    req.log?.error({ err }, 'report_creation_failed');
    res.status(500).json({ error: 'Greška pri slanju prijave.' });
  }
});

// GET /api/reports - Lista svih reporta (moderator/admin)
router.get('/', authenticate, authorize('moderator', 'admin'), async (req: AuthRequest, res) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query;

    const reports = await db.reports?.list({
      status: status as string | undefined,
      limit: Math.min(parseInt(limit as string, 10) || 50, 100),
      offset: parseInt(offset as string, 10) || 0,
    });

    const total = await db.reports?.count(status as string | undefined);

    respond(res, reportListResponseSchema, { reports: reports || [], total: total || 0 });
  } catch (err: any) {
    req.log?.error({ err }, 'reports_list_failed');
    res.status(500).json({ error: 'Greška pri učitavanju prijava.' });
  }
});

// PATCH /api/reports/:id - Reši report (moderator/admin)
router.patch('/:id', authenticate, authorize('moderator', 'admin'), async (req: AuthRequest, res) => {
  try {
    const parsed = validate(resolveReportSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.details[0].message });
    }

    const { status, resolutionNote } = parsed.data;
    const reportId = req.params.id;

    const report = await db.reports?.findById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Prijava nije pronađena.' });
    }

    if (report.status !== 'pending') {
      return res.status(400).json({ error: 'Ova prijava je već obrađena.' });
    }

    const updated = await db.reports?.update(reportId, {
      status,
      resolvedBy: req.user!.id,
      resolvedAt: new Date().toISOString(),
      resolutionNote,
    });

    req.log?.info({ reportId, status, moderatorId: req.user!.id }, 'report_resolved');
    if (!updated) return res.status(404).json({ error: 'Prijava nije pronađena.' });

    // 3.0.0 — podnosilac prijave saznaje ishod u inbox-u (dosad je odluka
    // vidljiva samo staff-u).
    void notify({
      userId: report.reporterId,
      type: 'system',
      title: status === 'resolved' ? 'Prijava je rešena' : 'Prijava je odbačena',
      message:
        status === 'resolved'
          ? `Moderacija je rešila tvoju prijavu (${report.targetType})${resolutionNote ? `: ${resolutionNote}` : '.'}`
          : `Moderacija je pregledala prijavu (${report.targetType}) i odlučila da nema prekršaja${resolutionNote ? `: ${resolutionNote}` : '.'}`,
      link: '/notifications',
      actorId: req.user!.id,
      metadata: { reportId, status },
    }).catch(() => null);
    respond(res, reportResponseSchema, { message: 'Prijava je uspešno obrađena.', report: updated });
  } catch (err: any) {
    req.log?.error({ err }, 'report_resolution_failed');
    res.status(500).json({ error: 'Greška pri obradi prijave.' });
  }
});

export default router;
