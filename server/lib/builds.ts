/**
 * F-11 — KALKULATOR BUILD-a (kategorija „Hardver“)
 * ----------------------------------------------
 * Namena je konkretna: izabereš komponente i vidiš UKUPNU cenu kod domaćih
 * prodavnica, sa upozorenjem na nedostajući deo i linkom ka deal-u ako ga ima.
 *
 * Model:
 *  - `pc_components` — katalog koji pune staff/moderatori (kategorija, naziv,
 *    cena, prodavnica, URL, opciono igra/`deal` nije potreban). Javno se čita.
 *  - `pc_builds` — sačuvani build (naslov, lista `{componentId, qty}`, javan /
 *    privatan, `share_id` za deljivi link bez prijave).
 *
 * Zašto ne „cena kod svih prodavnica“: to bi tražilo scraping (pravni rizik +
 * održavanje). Ovde je jedna aktuelna cena po komponenti u trenutku unosa, a
 * moderator menja cenu kada se promeni — isto kao deals.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

export type ComponentCategory =
  | 'cpu'
  | 'gpu'
  | 'motherboard'
  | 'ram'
  | 'storage'
  | 'psu'
  | 'case'
  | 'cooler'
  | 'monitor'
  | 'peripheral';

export const COMPONENT_CATEGORIES: { id: ComponentCategory; label: string; required: boolean }[] = [
  { id: 'cpu', label: 'Procesor', required: true },
  { id: 'gpu', label: 'Grafička kartica', required: true },
  { id: 'motherboard', label: 'Matična ploča', required: true },
  { id: 'ram', label: 'Memorija (RAM)', required: true },
  { id: 'storage', label: 'SSD / HDD', required: true },
  { id: 'psu', label: 'Napajanje', required: true },
  { id: 'case', label: 'Kućište', required: true },
  { id: 'cooler', label: 'Hlađenje', required: false },
  { id: 'monitor', label: 'Monitor', required: false },
  { id: 'peripheral', label: 'Periferije', required: false },
];

export interface PcComponent {
  id: string;
  category: ComponentCategory;
  name: string;
  brand: string | null;
  /** Specifikacija (npr. „16 GB DDR5 6000 MHz“) — kratko, za izbor. */
  spec: string | null;
  price: number;
  currency: string;
  store: string;
  url: string | null;
  imageUrl: string | null;
  /** Ko je uneo (staff) — za reviziju cena. */
  createdBy: string | null;
  updatedAt: string;
}

export interface BuildItem {
  componentId: string;
  qty: number;
}

export interface PcBuild {
  id: string;
  userId: string;
  title: string;
  items: BuildItem[];
  isPublic: boolean;
  shareId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentRepo {
  list(category?: ComponentCategory): Promise<PcComponent[]>;
  findById(id: string): Promise<PcComponent | null>;
  create(component: PcComponent): Promise<PcComponent>;
  update(id: string, patch: Partial<PcComponent>): Promise<PcComponent | null>;
  remove(id: string): Promise<boolean>;
}

export interface BuildRepo {
  findByShareId(shareId: string): Promise<PcBuild | null>;
  findById(id: string): Promise<PcBuild | null>;
  listByUser(userId: string): Promise<PcBuild[]>;
  create(build: PcBuild): Promise<PcBuild>;
  update(id: string, patch: Partial<PcBuild>): Promise<PcBuild | null>;
  remove(id: string): Promise<boolean>;
}

/* ------------------------------ memorija ------------------------------ */

const memory = { components: [] as PcComponent[], builds: [] as PcBuild[] };

export class MemoryComponentRepo implements ComponentRepo {
  async list(category?: ComponentCategory) {
    return memory.components
      .filter((component) => !category || component.category === category)
      .sort((a, b) => a.category.localeCompare(b.category) || a.price - b.price);
  }
  async findById(id: string) {
    return memory.components.find((component) => component.id === id) ?? null;
  }
  async create(component: PcComponent) {
    memory.components.push(component);
    return component;
  }
  async update(id: string, patch: Partial<PcComponent>) {
    const index = memory.components.findIndex((component) => component.id === id);
    if (index === -1) return null;
    memory.components[index] = { ...memory.components[index], ...patch, id, updatedAt: new Date().toISOString() };
    return memory.components[index];
  }
  async remove(id: string) {
    const before = memory.components.length;
    memory.components = memory.components.filter((component) => component.id !== id);
    return memory.components.length < before;
  }
}

export class MemoryBuildRepo implements BuildRepo {
  async findByShareId(shareId: string) {
    return memory.builds.find((build) => build.shareId === shareId) ?? null;
  }
  async findById(id: string) {
    return memory.builds.find((build) => build.id === id) ?? null;
  }
  async listByUser(userId: string) {
    return memory.builds.filter((build) => build.userId === userId);
  }
  async create(build: PcBuild) {
    memory.builds.push(build);
    return build;
  }
  async update(id: string, patch: Partial<PcBuild>) {
    const index = memory.builds.findIndex((build) => build.id === id);
    if (index === -1) return null;
    memory.builds[index] = { ...memory.builds[index], ...patch, id, updatedAt: new Date().toISOString() };
    return memory.builds[index];
  }
  async remove(id: string) {
    const before = memory.builds.length;
    memory.builds = memory.builds.filter((build) => build.id !== id);
    return memory.builds.length < before;
  }
}

/* ------------------------------ Supabase ------------------------------ */

function mapComponentRow(row: any): PcComponent {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    brand: row.brand ?? null,
    spec: row.spec ?? null,
    price: Number(row.price ?? 0),
    currency: row.currency ?? 'RSD',
    store: row.store ?? '',
    url: row.url ?? null,
    imageUrl: row.image_url ?? null,
    createdBy: row.created_by ?? null,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export class SupabaseComponentRepo implements ComponentRepo {
  constructor(private db: SupabaseClient) { }
  async list(category?: ComponentCategory) {
    let query = this.db.from('pc_components').select('*');
    if (category) query = query.eq('category', category);
    const { data, error } = await query.order('price', { ascending: true });
    // Bez migracije (42P01) katalog je prazan — ruta vraća `[]`, a ne 500.
    if (error) {
      if (error.code !== '42P01') logger.warn({ err: error }, 'pc_components_list_failed');
      return [];
    }
    return (data ?? []).map(mapComponentRow);
  }
  async findById(id: string) {
    const { data, error } = await this.db.from('pc_components').select('*').eq('id', id).maybeSingle();
    if (error) return null;
    return data ? mapComponentRow(data) : null;
  }
  async create(component: PcComponent) {
    const { data, error } = await this.db
      .from('pc_components')
      .insert({
        category: component.category,
        name: component.name,
        brand: component.brand,
        spec: component.spec,
        price: component.price,
        currency: component.currency,
        store: component.store,
        url: component.url,
        image_url: component.imageUrl,
        created_by: component.createdBy,
      })
      .select('*')
      .single();
    if (error) throw error;
    return mapComponentRow(data);
  }
  async update(id: string, patch: Partial<PcComponent>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.brand !== undefined) row.brand = patch.brand;
    if (patch.spec !== undefined) row.spec = patch.spec;
    if (patch.price !== undefined) row.price = patch.price;
    if (patch.store !== undefined) row.store = patch.store;
    if (patch.url !== undefined) row.url = patch.url;
    if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
    const { data } = await this.db.from('pc_components').update(row).eq('id', id).select('*').maybeSingle();
    return data ? mapComponentRow(data) : null;
  }
  async remove(id: string) {
    const { error } = await this.db.from('pc_components').delete().eq('id', id);
    return !error;
  }
}

function mapBuildRow(row: any, items: BuildItem[]): PcBuild {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    items,
    isPublic: row.is_public !== false,
    shareId: row.share_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

export class SupabaseBuildRepo implements BuildRepo {
  constructor(private db: SupabaseClient) { }

  private async itemsFor(ids: string[]) {
    const map = new Map<string, BuildItem[]>();
    if (!ids.length) return map;
    const { data } = await this.db.from('pc_build_items').select('*').in('build_id', ids);
    for (const row of (data ?? []) as any[]) {
      const list = map.get(row.build_id) ?? [];
      list.push({ componentId: row.component_id, qty: Number(row.qty ?? 1) });
      map.set(row.build_id, list);
    }
    return map;
  }

  async findByShareId(shareId: string) {
    const { data } = await this.db.from('pc_builds').select('*').eq('share_id', shareId).maybeSingle();
    if (!data) return null;
    const items = await this.itemsFor([data.id]);
    return mapBuildRow(data, items.get(data.id) ?? []);
  }
  async findById(id: string) {
    const { data } = await this.db.from('pc_builds').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    const items = await this.itemsFor([data.id]);
    return mapBuildRow(data, items.get(data.id) ?? []);
  }
  async listByUser(userId: string) {
    const { data } = await this.db.from('pc_builds').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    const rows = data ?? [];
    const items = await this.itemsFor(rows.map((row: any) => row.id));
    return rows.map((row: any) => mapBuildRow(row, items.get(row.id) ?? []));
  }
  async create(build: PcBuild) {
    const { data, error } = await this.db
      .from('pc_builds')
      .insert({
        user_id: build.userId,
        title: build.title,
        is_public: build.isPublic,
        share_id: build.shareId,
      })
      .select('*')
      .single();
    if (error) throw error;
    await this.replaceItems(data.id, build.items);
    return mapBuildRow(data, build.items);
  }
  async update(id: string, patch: Partial<PcBuild>) {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.isPublic !== undefined) row.is_public = patch.isPublic;
    const { data } = await this.db.from('pc_builds').update(row).eq('id', id).select('*').maybeSingle();
    if (!data) return null;
    if (patch.items) await this.replaceItems(id, patch.items);
    return this.findById(id);
  }
  private async replaceItems(buildId: string, items: BuildItem[]) {
    const { error: deleteError } = await this.db.from('pc_build_items').delete().eq('build_id', buildId);
    if (deleteError) throw deleteError;
    if (!items.length) return;
    const { error } = await this.db
      .from('pc_build_items')
      .insert(items.map((item) => ({ build_id: buildId, component_id: item.componentId, qty: item.qty })));
    if (error) logger.warn({ err: error, buildId }, 'pc_build_items_insert_failed');
  }
  async remove(id: string) {
    const { error } = await this.db.from('pc_builds').delete().eq('id', id);
    return !error;
  }
}

/**
 * Ukupna cena i provere (nedostajući obavezni delovi). Cena je u RSD jer su
 * domaće prodavnice u dinarima; `currency` se prikazuje po komponenti.
 */
export function summarizeBuild(components: PcComponent[], items: BuildItem[]) {
  const byId = new Map(components.map((component) => [component.id, component]));
  let total = 0;
  const parts: { component: PcComponent; qty: number; subtotal: number }[] = [];
  for (const item of items) {
    const component = byId.get(item.componentId);
    if (!component) continue;
    const qty = Math.max(1, Math.min(10, item.qty));
    const subtotal = component.price * qty;
    total += subtotal;
    parts.push({ component, qty, subtotal });
  }
  const present = new Set(parts.map((part) => part.component.category));
  const missing = COMPONENT_CATEGORIES.filter((category) => category.required && !present.has(category.id)).map(
    (category) => category.label,
  );
  return { total, parts, missing, complete: missing.length === 0 };
}

/** Deljivi ID: kratak, bez sličnih znakova (O/0, l/1) da se lako prepiše. */
export function shareId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let index = 0; index < 10; index += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
