export const CONFIG = {
  AI_PROVIDER: {
    // Google Gemini mediante su entrada compatible con el formato de OpenAI; admite llamadas directas desde el navegador.
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    primaryModel: "gemini-flash-latest",
    fallbackModel: "gemini-flash-lite-latest",
    pingModel: "gemini-flash-lite-latest",
  },
  DISCOGS: {
    baseUrl: "https://api.discogs.com",
  },
  STORAGE_KEYS: {
    aiKey: "vinilos_ai_key",
    aiVerified: "vinilos_ai_verified",
    discogsToken: "vinilos_discogs_token",
    discogsVerified: "vinilos_discogs_verified",
    history: "vinilos_history",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
