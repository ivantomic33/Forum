import { Router } from 'express';
import { authenticate, authorize, requireVerified, type AuthRequest } from '../middleware/auth.js';
import { db } from '../lib/store.js';
import { z } from 'zod';
import { validate } from '../lib/schemas.js';

const router = Router();

// Schema za kreiranje report-a
const createReportSchema = z.object({
  targetType: z.enum(['thread', 'reply', 'article', 'comment', 'user', 'deal']),
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
      id: `rep_${Date.now().toString(36)}`,
      targetType,
      targetId,
      reporterId,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    req.log?.info({ reportId: report?.id, targetType, targetId }, 'content_reported');
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

    res.json({ reports: reports || [], total: total || 0 });
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
    res.json({ message: 'Prijava je uspešno obrađena.', report: updated });
  } catch (err: any) {
    req.log?.error({ err }, 'report_resolution_failed');
    res.status(500).json({ error: 'Greška pri obradi prijave.' });
  }
});

export default router;
