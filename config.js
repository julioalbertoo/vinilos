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
  // Copia en la nube de «Mis discos» (proyecto Supabase compartido con otras apps; los discos van en el schema «vinilos»).
  // La clave publicable es pública por diseño: lo que protege los datos son las reglas RLS de la tabla.
  SUPABASE: {
    url: "https://lmfdpetsqmmymbuwbziw.supabase.co",
    publishableKey: "sb_publishable_EjbC1Y2umbq66ZS-ohAu8g_-BlYQHOd",
    schema: "vinilos",
    table: "records",
  },
  STORAGE_KEYS: {
    aiKey: "vinilos_ai_key",
    aiVerified: "vinilos_ai_verified",
    discogsToken: "vinilos_discogs_token",
    discogsVerified: "vinilos_discogs_verified",
    history: "vinilos_history",
    cloudSynced: "vinilos_cloud_synced",
    cloudPendingDeletes: "vinilos_cloud_pending_deletes",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
