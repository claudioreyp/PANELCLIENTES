/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_DEV_AUTH_TOKEN?: string;
  readonly VITE_DEV_BUSINESS_ID?: string;
  readonly VITE_DEV_BRANCH_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
