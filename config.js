export const CONFIG = {
  APP_VERSION: "0.4.1",
  AI_PROVIDER: {
    workerUrl: "https://vinilos-proxy.julioalbertoo.workers.dev",
    primaryModel: "meta/Llama-4-Scout-17B-16E-Instruct", // confirmar nombre exacto en el catálogo antes del Paso 4
    fallbackModel: "openai/gpt-4o",
    pingModel: "openai/gpt-4o-mini",
  },
  DISCOGS: {
    baseUrl: "https://api.discogs.com",
  },
  STORAGE_KEYS: {
    githubToken: "vinilos_github_token",
    githubTokenSavedAt: "vinilos_github_token_saved_at",
    githubVerified: "vinilos_github_verified",
    discogsToken: "vinilos_discogs_token",
    discogsVerified: "vinilos_discogs_verified",
    history: "vinilos_history",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
