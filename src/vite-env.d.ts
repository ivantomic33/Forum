/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  /** Bazni URL API-ja u produkciji (npr. https://api.nexus.rs). Prazno = isti domen. */
  readonly VITE_API_URL?: string;
  /** 2.6.1 — Supabase Realtime (javni ključevi; pristup ograničava RLS). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
