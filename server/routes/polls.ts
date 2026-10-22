import { Router } from 'express';
import { db } from '../lib/store.js';
import { authenticate, type AuthRequest } from '../middleware/auth.js';
import { sanitizeText } from '../middleware/sanitize.js';
import { pollVoteSchema, validate } from '../lib/schemas.js';

/**
 * INTERAKTIVNE ANKETE
 * -------------------
 * Anketa je vezana za forum temu (`thread_id`) i dohvatа se zajedno sa temom
 * preko GET /api/forum/threads/:id. Glasanje je dozvoljeno samo prijavljenim
 * korisnicima i po jedan glas po korisniku.
 *
 * Radi i bez Supabase-a (in-memory fallback), kao i ostatak data layera.
 *
 * F-22 — u Supabase režimu NEMA tihog fallback-a na memoriju: greška baze se
 * prijavljuje kao 503 (`PollStorageUnavailableError`). Memorijsko skladište se
 * koristi samo kada je data layer `memory` (demo režim).
 */

export class PollStorageUnavailableError extends Error {
  constructor(message = 'Ankete trenutno nisu dostupne. Pokušajte ponovo.') {
    super(message);
    this.name = 'PollStorageUnavailableError';
  }
}

interface PollRecord {
  threadId: string;
  question: string;
  options: string[];
}

interface PollVoteRecord {
  threadId: string;
  userId: string;
  optionIndex: number;
}

const memoryPolls = new Map<string, PollRecord>();
const memoryVotes: PollVoteRecord[] = [];

/** Uključen samo kada je Supabase stvarno konfigurisan; tada tabele iz schema-polls.sql. */
const supabase = db.kind === 'supabase' ? (await import('../lib/pollsSupabase.js')).pollsSupabase : null;

export function validatePoll(poll: any): { question: string; options: string[] } | null {
  if (!poll || typeof poll !== 'object') return null;
  const question = String(poll.question ?? '').trim();
  const rawOptions = Array.isArray(poll.options) ? poll.options : [];
  const options = rawOptions
    .map((option: unknown) => sanitizeText(option).trim())
    .filter(Boolean);

  if (question.length < 3 || options.length < 2) return null;
  return {
    question: sanitizeText(question).slice(0, 200),
    options: options.slice(0, 6).map((option: string) => option.slice(0, 120)),
  };
}

export async function savePoll(threadId: string, poll: { question: string; options: string[] }) {
  if (supabase) {
    try {
      await supabase.createPoll({ threadId, question: poll.question, options: poll.options });
      return;
    } catch (error: any) {
      // F-22 — greška baze se NE gutа: tema se ne objavljuje sa anketom koja
      // postoji samo u memoriji ovog procesa.
      console.error('[polls] upis ankete u bazu nije uspeo:', error?.message);
      throw new PollStorageUnavailableError('Anketa nije mogla da se sačuva. Pokušajte ponovo.');
    }
  }
  memoryPolls.set(threadId, { threadId, ...poll });
}

export async function getPollForThread(threadId: string, userId?: string) {
  let poll: PollRecord | null = null;
  let votes: PollVoteRecord[] = [];

  if (supabase) {
    // F-22 — greška baze je 503, ne prazna anketa iz memorije.
    try {
      poll = await supabase.getPoll(threadId);
      if (poll) {
        const dbVotes = await supabase.getVotes(threadId);
        votes = dbVotes;
      }
    } catch (error: any) {
      console.error('[polls] čitanje ankete iz baze nije uspelo:', error?.message);
      throw new PollStorageUnavailableError();
    }
    if (!poll) return null;
  } else {
    poll = memoryPolls.get(threadId) ?? null;
    votes = memoryVotes.filter((vote) => vote.threadId === threadId);
    if (!poll) return null;
  }

  const tallies: number[] = poll.options.map((_, index) => votes.filter((vote) => vote.optionIndex === index).length);
  const totalVotes = tallies.reduce((sum, value) => sum + value, 0);
  const myVote = userId ? votes.find((vote) => vote.userId === userId)?.optionIndex ?? null : null;

  return {
    question: poll.question,
    options: poll.options.map((label, index) => ({
      index,
      label,
      votes: tallies[index],
      percent: totalVotes ? Math.round((tallies[index] / totalVotes) * 100) : 0,
    })),
    totalVotes,
    myVote,
  };
}

const router = Router();

// POST /api/forum/threads/:id/poll/vote
router.post('/threads/:id/poll/vote', authenticate, async (req: AuthRequest, res, next) => {
  try {
    const parsed = validate(pollVoteSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Nevažeća opcija ankete.' });
    }

    const threadId = req.params.id;
    const optionIndex = parsed.data.optionIndex;
    const userId = req.user!.id;

    let poll: PollRecord | null = null;
    if (supabase) {
      try {
        poll = await supabase.getPoll(threadId);
      } catch (error: any) {
        console.error('[polls] čitanje ankete iz baze nije uspelo:', error?.message);
        return res.status(503).json({ error: 'Ankete trenutno nisu dostupne. Pokušajte ponovo.' });
      }
    }
    const resolvedPoll = poll ?? (supabase ? null : memoryPolls.get(threadId) ?? null);
    if (!resolvedPoll) return res.status(404).json({ error: 'Anketa nije pronađena.' });
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= resolvedPoll.options.length) {
      return res.status(400).json({ error: 'Nevažeća opcija ankete.' });
    }

    let storedInDb = false;
    if (poll) {
      try {
        const alreadyVoted = await supabase!.hasVoted(threadId, userId);
        if (alreadyVoted) return res.status(409).json({ error: 'Već ste glasali u ovoj anketi.' });
        await supabase!.addVote({ threadId, userId, optionIndex });
        storedInDb = true;
      } catch (error: any) {
        // F-22 — glas se NE upisuje u memoriju: bio bi izgubljen pri restartu i
        // nevidljiv drugim instancama. Klijent dobija 503 i može da pokuša ponovo.
        console.error('[polls] upis glasa u bazu nije uspeo:', error?.message);
        return res.status(503).json({ error: 'Glas trenutno nije moguće sačuvati. Pokušajte ponovo.' });
      }
    }

    if (!storedInDb) {
      if (memoryVotes.some((vote) => vote.threadId === threadId && vote.userId === userId)) {
        return res.status(409).json({ error: 'Već ste glasali u ovoj anketi.' });
      }
      memoryVotes.push({ threadId, userId, optionIndex });
    }

    res.json(await getPollForThread(threadId, userId));
  } catch (err) {
    next(err);
  }
});

export default router;
