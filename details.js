// Fichas y precios guardados en Supabase para no preguntar tanto a Discogs.
// - La ficha (canciones, sellos, notas, enlaces de las fotos…) se reutiliza durante 30 días.
// - Los precios, durante 7 días.
// Sin cuenta en la nube, o si Supabase no responde, se pregunta a Discogs como siempre.
import { getRelease, getPrices, cheapestVinyl, borrowDurations, RELEASE_VERSION } from "./discogs.js";
import { CONFIG } from "./config.js";
import { mbTrackLengths, trackKey } from "./musicbrainz.js";
import { loadDetail, saveDetail, loadCache, saveCache } from "./cloud.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RELEASE_MAX_AGE = 30 * DAY_MS;
const PRICES_MAX_AGE = 7 * DAY_MS;
const CLOUD_TIMEOUT_MS = 4000;

// Filas ya leídas en esta visita, para no volver a pedirlas a Supabase.
const rows = new Map();

const isFresh = (at, maxAge) => Boolean(at) && Date.now() - new Date(at).getTime() < maxAge;

function withTimeout(promise) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), CLOUD_TIMEOUT_MS))]);
}

async function readRow(id) {
  const key = Number(id);
  if (rows.has(key)) return rows.get(key);
  let row = null;
  try {
    row = await withTimeout(loadDetail(key));
  } catch {
    row = null;
  }
  if (row) rows.set(key, row);
  return row;
}

function writeRow(id, fields) {
  const key = Number(id);
  rows.set(key, { ...(rows.get(key) || {}), ...fields });
  // Si no se puede guardar, la próxima vez se pregunta otra vez a Discogs: no pasa nada.
  saveDetail(key, fields).catch(() => {});
}

// Ficha de la edición: la guardada si es reciente; si no, la de Discogs (y se guarda).
// Si Discogs falla pero hay una guardada antigua, se usa esa.
export async function cachedRelease(id, discogsToken) {
  const row = await readRow(id);
  if (row && row.data && row.data.v === RELEASE_VERSION && isFresh(row.data_at, RELEASE_MAX_AGE)) return row.data;
  try {
    const release = await getRelease(id, discogsToken);
    // El año original no cambia: se conserva el que ya se sabía.
    if (row && row.data && row.data.originalYear !== undefined) release.originalYear = row.data.originalYear;
    // Las duraciones que ya se habían encontrado en otras fuentes se conservan.
    if (row && row.data && Array.isArray(row.data.tracklist)) {
      const old = new Map(row.data.tracklist.filter((t) => t.duration).map((t) => [trackKey(t.title), t.duration]));
      for (const t of release.tracklist) if (!t.duration && old.has(trackKey(t.title))) t.duration = old.get(trackKey(t.title));
    }
    writeRow(id, { data: release, data_at: new Date().toISOString() });
    return release;
  } catch (err) {
    if (row && row.data) return row.data;
    throw err;
  }
}

// Guarda la ficha otra vez con lo que se ha añadido después (p. ej. el año del álbum original).
export function rememberRelease(release) {
  const row = rows.get(Number(release.id));
  writeRow(release.id, { data: release, data_at: (row && row.data_at) || new Date().toISOString() });
}

// Sube cuando se añade otra fuente de duraciones: los discos ya mirados se vuelven a mirar (3: MusicBrainz, sin dar por mirados los que fallaron).
export const DURATIONS_CHECK = 4;

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// Rellena las duraciones que faltan con las de MusicBrainz: por título y, si el disco tiene
// las mismas canciones en el mismo número, por orden.
async function mbDurations(release) {
  // Si MusicBrainz falla (p. ej. por ir muy deprisa), el error sube y se reintenta otro día.
  const tracks = await mbTrackLengths(release.artist, release.title, release.tracklist.length);
  if (!tracks) {
    release.durationsNote = "MusicBrainz: álbum no encontrado";
    return;
  }
  const known = new Map();
  for (const t of tracks) if (t.seconds && !known.has(trackKey(t.title))) known.set(trackKey(t.title), t.seconds);
  const sameOrder = tracks.length === release.tracklist.length;
  release.tracklist.forEach((t, i) => {
    if (t.duration) return;
    const twin = sameOrder && trackKey(tracks[i].title) === trackKey(t.title) && tracks[i].seconds;
    const seconds = twin || known.get(trackKey(t.title)) || (sameOrder && tracks[i].seconds);
    if (seconds) t.duration = clock(seconds);
  });
  const filled = release.tracklist.filter((t) => t.duration).length;
  release.durationsNote = `MusicBrainz: ${tracks.length} canciones, ${filled} de ${release.tracklist.length} con duración`;
}

// Si Discogs no da la duración de algunas canciones, se copian de otra edición del mismo álbum
// (se intenta una sola vez por disco y se guarda). Devuelve la ficha, con o sin cambios.
export async function fillDurations(release, discogsToken) {
  if (release.durationsChecked === DURATIONS_CHECK || !release.tracklist || release.tracklist.every((t) => t.duration)) return release;
  // Primero MusicBrainz (tiene su propia cola: no espera a las consultas de precios a Discogs);
  // lo que falte, de otras ediciones de Discogs. Si algo falla, se apunta y se reintenta otro día.
  try {
    await mbDurations(release);
    if (release.tracklist.some((t) => !t.duration)) await borrowDurations(release, discogsToken);
  } catch (err) {
    release.durationsNote = `Error: ${err.message}`;
    rememberRelease(release);
    throw err;
  }
  release.durationsChecked = DURATIONS_CHECK;
  rememberRelease(release);
  return release;
}

// Precios: { prices, at } — at es la fecha de la consulta a Discogs.
export async function cachedPrices(id, discogsToken) {
  const row = await readRow(id);
  if (row && row.prices && isFresh(row.prices_at, PRICES_MAX_AGE)) return { prices: row.prices, at: row.prices_at };
  try {
    const prices = await getPrices(id, discogsToken);
    const at = new Date().toISOString();
    writeRow(id, { prices, prices_at: at });
    return { prices, at };
  } catch (err) {
    if (row && row.prices) return { prices: row.prices, at: row.prices_at };
    throw err;
  }
}

// ---------- Otras respuestas guardadas en Supabase ----------

export const MONTH_MS = RELEASE_MAX_AGE;
export const WEEK_MS = PRICES_MAX_AGE;

// Respuestas ya leídas en esta visita (también las que no se encontraron).
const cacheRows = new Map();

// Lee una respuesta guardada: { value, at } o null. Sin cuenta, sin red o si tarda, null.
export async function readCloud(kind, key) {
  const id = `${kind}|${key}`;
  if (cacheRows.has(id)) return cacheRows.get(id);
  let row = null;
  try {
    row = await withTimeout(loadCache(kind, key));
  } catch {
    row = null;
  }
  const entry = row && row.data ? { value: row.data.value, at: row.at } : null;
  if (entry) cacheRows.set(id, entry);
  return entry;
}

export function writeCloud(kind, key, value) {
  cacheRows.set(`${kind}|${key}`, { value, at: new Date().toISOString() });
  // Si no se puede guardar, la próxima vez se vuelve a preguntar: no pasa nada.
  saveCache(kind, key, { value }).catch(() => {});
}

// Respuesta guardada si es reciente; si no, se pide con fetcher() y se guarda (también si no encontró
// nada, para no volver a buscarlo). Si fetcher falla pero hay una guardada antigua, se usa esa.
// valid(value): false para descartar guardadas de otra forma (p. ej. versiones antiguas).
export async function cloudCached(kind, key, maxAge, fetcher, valid = () => true) {
  if (key === undefined || key === null || key === "") return fetcher();
  const saved = await readCloud(kind, key);
  const usable = saved && valid(saved.value);
  if (usable && isFresh(saved.at, maxAge)) return saved.value;
  try {
    const value = await fetcher();
    writeCloud(kind, key, value === undefined ? null : value);
    return value;
  } catch (err) {
    if (usable) return saved.value;
    throw err;
  }
}

// Vinilo más barato de un álbum (entre sus ediciones más comunes), guardado en el móvil 7 días.
const CHEAPEST_KEY = CONFIG.STORAGE_KEYS.cheapestCache;

function readCheapest() {
  try {
    return JSON.parse(localStorage.getItem(CHEAPEST_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

// Devuelve { best, checked, total, versions, community, at } o null si se cortó (stop).
export async function cachedCheapest(masterId, discogsToken, options = {}) {
  const all = readCheapest();
  const saved = all[masterId];
  // Los guardados antes de contar quién lo tiene/busca (sin community) se vuelven a pedir.
  if (saved && saved.community && isFresh(saved.at, PRICES_MAX_AGE)) return saved;
  // Luego, lo guardado en la nube (desde este u otro móvil).
  const cloud = await readCloud("cheapest", masterId);
  let entry = cloud && cloud.value && cloud.value.community && isFresh(cloud.value.at, PRICES_MAX_AGE) ? cloud.value : null;
  if (!entry) {
    const result = await cheapestVinyl(masterId, discogsToken, options);
    if (!result) return null;
    entry = { ...result, at: new Date().toISOString() };
    writeCloud("cheapest", masterId, entry);
  }
  const fresh = readCheapest();
  // Solo se guardan los álbumes de la última semana, para no llenar el móvil.
  for (const [key, value] of Object.entries(fresh)) if (!isFresh(value.at, PRICES_MAX_AGE)) delete fresh[key];
  fresh[masterId] = entry;
  try {
    localStorage.setItem(CHEAPEST_KEY, JSON.stringify(fresh));
  } catch {
    // Sin espacio: se vuelve a buscar la próxima vez.
  }
  return entry;
}
