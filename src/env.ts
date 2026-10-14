export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** TypeSafe API key for Jev. When missing, the app uses the offline mock (see src/lib/jev.ts). */
  JEV_API_KEY?: string;
};

export type AppEnv = { Bindings: Env };
