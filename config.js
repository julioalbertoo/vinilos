export const CONFIG = {
  AI_PROVIDER: {
    workerUrl: "", // se rellena al desplegar el Cloudflare Worker (Paso 3)
    primaryModel: "meta/Llama-4-Scout-17B-16E-Instruct", // confirmar nombre exacto en el catálogo antes del Paso 4
    fallbackModel: "openai/gpt-4o-mini",
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
