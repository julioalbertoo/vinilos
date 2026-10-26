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
    // Fichas de Discogs y sus precios, para no volver a pedirlos cada vez (details.js).
    detailsTable: "details",
    // Otras respuestas de Discogs, MusicBrainz, TheAudioDB y Genius (artistas, ediciones, textos…).
    cacheTable: "cache",
    // «Lo que busco»: una fila por álbum.
    wantlistTable: "wantlist",
  },
  STORAGE_KEYS: {
    aiKey: "vinilos_ai_key",
    aiVerified: "vinilos_ai_verified",
    discogsToken: "vinilos_discogs_token",
    discogsVerified: "vinilos_discogs_verified",
    // Llave opcional de Genius (historias de canciones para el dato curioso).
    geniusToken: "vinilos_genius_token",
    history: "vinilos_history",
    // Ya no se usa (el orden de «Mis discos» no se recuerda): se borra al abrir la app.
    collectionSort: "vinilos_collection_sort",
    // "1" = modo explorador (tema oscuro; lo que se identifica no se guarda en «Mis discos»).
    exploreMode: "vinilos_explore_mode",
    // Discos identificados en modo explorador (explored.js).
    explored: "vinilos_explored",
    cloudSynced: "vinilos_cloud_synced",
    // Resumen de cada disco para la pestaña «Datos» (géneros, país, precios…).
    statsCache: "vinilos_stats_cache",
    cloudPendingDeletes: "vinilos_cloud_pending_deletes",
    // Lo mismo para «Lo que busco» (claves artista|título en vez de números de Discogs).
    cloudWantSynced: "vinilos_cloud_want_synced",
    cloudWantPendingDeletes: "vinilos_cloud_want_pending_deletes",
    // Fichas de artistas de Discogs (foto, biografía, discografía), 30 días.
    artistCache: "vinilos_artist_cache",
    // Vinilo más barato de cada álbum entre sus ediciones más comunes, 7 días.
    cheapestCache: "vinilos_cheapest_cache",
  },
  IMAGE: {
    maxDim: 1024,
    quality: 0.8,
  },
};
