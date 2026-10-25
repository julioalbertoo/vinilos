// Fichas y precios guardados en Supabase para no preguntar tanto a Discogs.
// - La ficha (canciones, sellos, notas, enlaces de las fotos…) se reutiliza durante 30 días.
// - Los precios, durante 7 días.
// Sin cuenta en la nube, o si Supabase no responde, se pregunta a Discogs como siempre.
import { getRelease, getPrices, cheapestVinyl, borrowDurations } from "./discogs.js";
import { CONFIG } from "./config.js";
import { loadDetail, saveDetail } from "./cloud.js";

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
  if (row && row.data && isFresh(row.data_at, RELEASE_MAX_AGE)) return row.data;
  try {
    const release = await getRelease(id, discogsToken);
    // El año original no cambia: se conserva el que ya se sabía.
    if (row && row.data && row.data.originalYear !== undefined) release.originalYear = row.data.originalYear;
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

// Si Discogs no da la duración de algunas canciones, se copian de otra edición del mismo álbum
// (se intenta una sola vez por disco y se guarda). Devuelve la ficha, con o sin cambios.
export async function fillDurations(release, discogsToken) {
  if (release.durationsChecked || !release.tracklist || release.tracklist.every((t) => t.duration)) return release;
  await borrowDurations(release, discogsToken); // si falla, quien llama lo apunta y se reintenta otro día
  release.durationsChecked = true;
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
  const result = await cheapestVinyl(masterId, discogsToken, options);
  if (!result) return null;
  const entry = { ...result, at: new Date().toISOString() };
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
