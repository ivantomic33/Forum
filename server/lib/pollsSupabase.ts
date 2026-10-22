import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase deo anketa — tabele `forum_polls` i `forum_poll_votes`
 * (kreirati SQL-om iz `server/schema-polls.sql`).
 */

export interface PollRow {
  threadId: string;
  question: string;
  options: string[];
}

export interface PollVoteRow {
  threadId: string;
  userId: string;
  optionIndex: number;
}

const db: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

export const pollsSupabase = {
  async createPoll(poll: PollRow) {
    const { error } = await db.from('forum_polls').insert({
      thread_id: poll.threadId,
      question: poll.question,
      options: poll.options,
    });
    if (error) throw error;
  },

  async getPoll(threadId: string): Promise<PollRow | null> {
    const { data, error } = await db
      .from('forum_polls')
      .select('thread_id, question, options')
      .eq('thread_id', threadId)
      .maybeSingle();
    if (error) throw error;
    return data ? { threadId: data.thread_id, question: data.question, options: data.options ?? [] } : null;
  },

  async getVotes(threadId: string): Promise<PollVoteRow[]> {
    const { data, error } = await db
      .from('forum_poll_votes')
      .select('thread_id, user_id, option_index')
      .eq('thread_id', threadId);
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      threadId: row.thread_id,
      userId: row.user_id,
      optionIndex: row.option_index,
    }));
  },

  async hasVoted(threadId: string, userId: string): Promise<boolean> {
    const { data } = await db
      .from('forum_poll_votes')
      .select('id')
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean(data);
  },

  async addVote(vote: PollVoteRow) {
    const { error } = await db.from('forum_poll_votes').insert({
      thread_id: vote.threadId,
      user_id: vote.userId,
      option_index: vote.optionIndex,
    });
    if (error) throw error;
  },
};
