/**
 * F-5 — KOLEKCIJE IGRARA / LISTE
 * -----------------------------
 * Korisnik pravi „Top 10 RPG 2026“, dodaje igre (sa opcionom beleškom po
 * stavci), drugi glasaju. Svaka javna lista je SEO stranica
 * (`/collections/:slug`), pa slug mora biti jedinstven i stabilan.
 *
 * Model: `game_collections` + `game_collection_items` (pozicija = redosled koji
 * autor određuje) + `game_collection_votes` (jedan glas po korisniku, isto
 * pravilo kao `deal_votes`). `score` je denormalizovan samo radi sortiranja.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

export interface CollectionItem {
  id: string;
  collectionId: string;
  gameId: string | null;
  gameTitle: string;
  gameSlug: string | null;
  gameCover: string | null;
  note: string | null;
  position: number;
}

export interface CollectionRecord {
  id: string;
  userId: string;
  title: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  score: number;
  createdAt: string;
  updatedAt: string;
  items: CollectionItem[];
  myVote?: 'up' | 'down' | null;
}

export const COLLECTION_LIMITS = {
  titleMax: 120,
  descriptionMax: 600,
  noteMax: 280,
  itemsMax: 50,
};

/** Slug iz naslova (`Top 10 RPG 2026` → `top-10-rpg-2026`), sa srpskim slovima. */
export function collectionSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'lista';
}

export interface CollectionRepo {
  listPublic(options: { limit?: number; offset?: number; search?: string }): Promise<{ collections: CollectionRecord[]; total: number }>;
  listByUser(userId: string, viewerId?: string): Promise<CollectionRecord[]>;
  findBySlug(slug: string, viewerId?: string): Promise<CollectionRecord | null>;
  findById(id: string): Promise<CollectionRecord | null>;
  create(collection: Omit<CollectionRecord, 'items'>): Promise<CollectionRecord>;
  update(id: string, patch: Partial<Pick<CollectionRecord, 'title' | 'description' | 'isPublic' | 'slug'>>): Promise<CollectionRecord | null>;
  remove(id: string): Promise<boolean>;
  addItem(item: CollectionItem): Promise<CollectionItem>;
  removeItem(collectionId: string, itemId: string): Promise<boolean>;
  vote(userId: string, collectionId: string, direction: 'up' | 'down' | null): Promise<{ score: number; myVote: 'up' | 'down' | null }>;
}

/* ------------------------------ memorija ------------------------------ */

interface MemoryCollectionState {
  collections: CollectionRecord[];
  items: CollectionItem[];
  votes: { collectionId: string; userId: string; type: 'up' | 'down' }[];
  counter: number;
}

const memory: MemoryCollectionState = { collections: [], items: [], votes: [], counter: 0 };

const withItems = (collection: CollectionRecord, viewerId?: string): CollectionRecord => ({
  ...collection,
  items: memory.items
    .filter((item) => item.collectionId === collection.id)
    .sort((a, b) => a.position - b.position),
  myVote: viewerId ? memory.votes.find((vote) => vote.collectionId === collection.id && vote.userId === viewerId)?.type ?? null : undefined,
});

export class MemoryCollectionRepo implements CollectionRepo {
  async listPublic({ limit = 20, offset = 0, search }: { limit?: number; offset?: number; search?: string }) {
    const term = search?.toLowerCase().trim();
    const all = memory.collections
      .filter((collection) => collection.isPublic)
      .filter((collection) => !term || collection.title.toLowerCase().includes(term))
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
    return { collections: all.slice(offset, offset + limit).map((item) => withItems(item)), total: all.length };
  }

  async listByUser(userId: string, viewerId?: string) {
    return memory.collections
      .filter((collection) => collection.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((collection) => withItems(collection, viewerId));
  }

  async findBySlug(slug: string, viewerId?: string) {
    const found = memory.collections.find((collection) => collection.slug === slug);
    return found ? withItems(found, viewerId) : null;
  }

  async findById(id: string) {
    const found = memory.collections.find((collection) => collection.id === id);
    return found ? withItems(found) : null;
  }

  async create(collection: Omit<CollectionRecord, 'items'>) {
    memory.collections.push({ ...collection, items: [] });
    return withItems({ ...collection, items: [] });
  }

  async update(id: string, patch: Partial<Pick<CollectionRecord, 'title' | 'description' | 'isPublic' | 'slug'>>) {
    const index = memory.collections.findIndex((collection) => collection.id === id);
    if (index === -1) return null;
    memory.collections[index] = {
      ...memory.collections[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return withItems(memory.collections[index]);
  }

  async remove(id: string) {
    const before = memory.collections.length;
    memory.collections = memory.collections.filter((collection) => collection.id !== id);
    memory.items = memory.items.filter((item) => item.collectionId !== id);
    memory.votes = memory.votes.filter((vote) => vote.collectionId !== id);
    return memory.collections.length < before;
  }

  async addItem(item: CollectionItem) {
    memory.items.push(item);
    return item;
  }

  async removeItem(collectionId: string, itemId: string) {
    const before = memory.items.length;
    memory.items = memory.items.filter((item) => !(item.id === itemId && item.collectionId === collectionId));
    return memory.items.length < before;
  }

  async vote(userId: string, collectionId: string, direction: 'up' | 'down' | null) {
    const collection = memory.collections.find((item) => item.id === collectionId);
    if (!collection) return { score: 0, myVote: null };
    const existing = memory.votes.find((vote) => vote.collectionId === collectionId && vote.userId === userId);
    let delta = 0;
    if (existing) {
      delta -= existing.type === 'up' ? 1 : -1;
      memory.votes = memory.votes.filter((vote) => !(vote.collectionId === collectionId && vote.userId === userId));
    }
    if (direction) {
      memory.votes.push({ collectionId, userId, type: direction });
      delta += direction === 'up' ? 1 : -1;
    }
    collection.score += delta;
    return { score: collection.score, myVote: direction };
  }
}

/* ------------------------------ Supabase ------------------------------ */

function mapCollectionRow(row: any): CollectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    slug: row.slug,
    description: row.description ?? null,
    isPublic: row.is_public !== false,
    score: Number(row.score ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    items: [],
  };
}

function mapItemRow(row: any): CollectionItem {
  return {
    id: row.id,
    collectionId: row.collection_id,
    gameId: row.game_id ?? null,
    gameTitle: row.game_title,
    gameSlug: row.game_slug ?? null,
    gameCover: row.game_cover ?? null,
    note: row.note ?? null,
    position: Number(row.position ?? 0),
  };
}

export class SupabaseCollectionRepo implements CollectionRepo {
  constructor(private db: SupabaseClient) {}

  private async hydrate(collections: CollectionRecord[], viewerId?: string): Promise<CollectionRecord[]> {
    if (!collections.length) return collections;
    const ids = collections.map((collection) => collection.id);
    const [{ data: items }, { data: votes }] = await Promise.all([
      this.db.from('game_collection_items').select('*').in('collection_id', ids).order('position', { ascending: true }),
      viewerId
        ? this.db.from('game_collection_votes').select('collection_id, vote_type').eq('user_id', viewerId).in('collection_id', ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const itemsByCollection = new Map<string, CollectionItem[]>();
    for (const row of (items ?? []) as any[]) {
      const list = itemsByCollection.get(row.collection_id) ?? [];
      list.push(mapItemRow(row));
      itemsByCollection.set(row.collection_id, list);
    }
    const voteMap = new Map<string, 'up' | 'down'>();
    for (const row of (votes ?? []) as any[]) voteMap.set(row.collection_id, row.vote_type);

    return collections.map((collection) => ({
      ...collection,
      items: itemsByCollection.get(collection.id) ?? [],
      myVote: viewerId ? voteMap.get(collection.id) ?? null : undefined,
    }));
  }

  async listPublic({ limit = 20, offset = 0, search }: { limit?: number; offset?: number; search?: string }) {
    let query = this.db.from('game_collections').select('*', { count: 'exact' }).eq('is_public', true);
    if (search) query = query.ilike('title', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { data, error, count } = await query
      .order('score', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { collections: await this.hydrate((data ?? []).map(mapCollectionRow)), total: count ?? 0 };
  }

  async listByUser(userId: string, viewerId?: string) {
    const { data, error } = await this.db
      .from('game_collections')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) return [];
    return this.hydrate((data ?? []).map(mapCollectionRow), viewerId);
  }

  async findBySlug(slug: string, viewerId?: string) {
    const { data, error } = await this.db.from('game_collections').select('*').eq('slug', slug).maybeSingle();
    if (error || !data) return null;
    const [collection] = await this.hydrate([mapCollectionRow(data)], viewerId);
    return collection ?? null;
  }

  async findById(id: string) {
    const { data, error } = await this.db.from('game_collections').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const [collection] = await this.hydrate([mapCollectionRow(data)]);
    return collection ?? null;
  }

  async create(collection: Omit<CollectionRecord, 'items'>) {
    const { data, error } = await this.db
      .from('game_collections')
      .insert({
        user_id: collection.userId,
        title: collection.title,
        slug: collection.slug,
        description: collection.description,
        is_public: collection.isPublic,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapCollectionRow(data);
  }

  async update(id: string, patch: Partial<Pick<CollectionRecord, 'title' | 'description' | 'isPublic' | 'slug'>>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.isPublic !== undefined) row.is_public = patch.isPublic;
    if (patch.slug !== undefined) row.slug = patch.slug;
    const { data, error } = await this.db.from('game_collections').update(row).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [collection] = await this.hydrate([mapCollectionRow(data)]);
    return collection ?? null;
  }

  async remove(id: string) {
    const { error } = await this.db.from('game_collections').delete().eq('id', id);
    return !error;
  }

  async addItem(item: CollectionItem) {
    const { data, error } = await this.db
      .from('game_collection_items')
      .insert({
        collection_id: item.collectionId,
        game_id: item.gameId,
        game_title: item.gameTitle,
        game_slug: item.gameSlug,
        game_cover: item.gameCover,
        note: item.note,
        position: item.position,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapItemRow(data);
  }

  async removeItem(collectionId: string, itemId: string) {
    const { error } = await this.db
      .from('game_collection_items')
      .delete()
      .eq('id', itemId)
      .eq('collection_id', collectionId);
    return !error;
  }

  async vote(userId: string, collectionId: string, direction: 'up' | 'down' | null) {
    try {
      const { data: existing } = await this.db
        .from('game_collection_votes')
        .select('id, vote_type')
        .eq('collection_id', collectionId)
        .eq('user_id', userId)
        .maybeSingle();
      await this.db.from('game_collection_votes').delete().eq('collection_id', collectionId).eq('user_id', userId);

      let delta = existing ? -(existing.vote_type === 'up' ? 1 : -1) : 0;
      if (direction) {
        const { error } = await this.db
          .from('game_collection_votes')
          .insert({ collection_id: collectionId, user_id: userId, vote_type: direction });
        if (error) throw error;
        delta += direction === 'up' ? 1 : -1;
      }

      // `score` je denormalizovan; čitamo pa upisujemo (glasovi su retki, a
      // `game_collections` nema RPC — jedan UPDATE je dovoljan za sortiranje).
      const { data: collection } = await this.db.from('game_collections').select('score').eq('id', collectionId).maybeSingle();
      const score = Number(collection?.score ?? 0) + delta;
      if (delta !== 0) await this.db.from('game_collections').update({ score }).eq('id', collectionId);
      return { score, myVote: direction };
    } catch (error) {
      logger.warn({ err: error, collectionId }, 'collection_vote_failed');
      return { score: 0, myVote: null };
    }
  }
}
