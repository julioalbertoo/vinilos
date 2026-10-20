export const CONFIG = {
  AI_PROVIDER: {
    // Google Gemini mediante su entrada compatible con el formato de OpenAI; admite llamadas directas desde el navegador.
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    primaryModel: "gemini-flash-latest",
    fallbackModel: "gemini-flash-lite-latest",
    // Más respaldos si los dos de arriba fallan. Cada modelo tiene su propio cupo gratuito.
    // La app pregunta a Google qué modelos hay y añade los Flash y Gemma que encuentre;
    // estos van primero si existen, y se usan tal cual si Google no da la lista.
    extraModels: ["gemini-3.8-flash", "gemini-3.8-flash-lite"],
    pingModel: "gemini-flash-lite-latest",
  },
  DISCOGS: {
    baseUrl: "https://api.discogs.com",
  },
  // Copia en la nube de «Mis discos» y de las llaves (proyecto Supabase compartido con otras apps; los discos van en el schema «vinilos»).
  // La clave publicable es pública por diseño: lo que protege los datos son las reglas RLS de la tabla.
  SUPABASE: {
    url: "https://lmfdpetsqmmymbuwbziw.supabase.co",
    publishableKey: "sb_publishable_EjbC1Y2umbq66ZS-ohAu8g_-BlYQHOd",
    schema: "vinilos",
    table: "records",
    settingsTable: "settings",
  },
  STORAGE_KEYS: {
    aiKey: "vinilos_ai_key",
    aiVerified: "vinilos_ai_verified",
    discogsToken: "vinilos_discogs_token",
    discogsVerified: "vinilos_discogs_verified",
    history: "vinilos_history",
    collectionSort: "vinilos_collection_sort",
    cloudSynced: "vinilos_cloud_synced",
    cloudPendingDeletes: "vinilos_cloud_pending_deletes",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
