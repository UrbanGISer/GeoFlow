/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin only, e.g. http://127.0.0.1:8000 — requests go to `${VITE_API_BASE_URL}/api/...` */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
