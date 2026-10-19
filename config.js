export const CONFIG = {
  AI_PROVIDER: {
    workerUrl: "", // se rellena en el Paso 3, al desplegar el Cloudflare Worker
    primaryModel: "",
    fallbackModel: "",
  },
  DISCOGS: {
    baseUrl: "https://api.discogs.com",
  },
  STORAGE_KEYS: {
    githubToken: "vinilos_github_token",
    githubTokenSavedAt: "vinilos_github_token_saved_at",
    discogsToken: "vinilos_discogs_token",
    history: "vinilos_history",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
