import { CONFIG } from "./config.js";

const KEY = CONFIG.STORAGE_KEYS.history;
const MAX_ITEMS = 500;

// Cada entrada: { release_id, artist, title, year, thumb, cover, label, color, date }. color: texto del
// color del vinilo según Discogs ("" = negro; sin el campo = aún no se sabe). release_id es la clave
// para la copia en la nube y para sincronizar con la colección de Discogs en la v2.
export function getHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

// Quien quiera enterarse de los cambios (la copia en la nube) se apunta aquí.
// Así este archivo no necesita saber nada de Supabase.
const listeners = [];
export function onHistoryChange(fn) {
  listeners.push(fn);
}
function notify(change) {
  for (const fn of listeners) {
    try {
      fn(change);
    } catch {
      // Un fallo de la nube nunca debe impedir guardar en el móvil.
    }
  }
}

// Si el disco ya estaba, se actualiza y sube al principio en vez de duplicarse.
export function addToHistory(entry) {
  const items = getHistory().filter((item) => item.release_id !== entry.release_id);
  const item = { ...entry, date: new Date().toISOString() };
  items.unshift(item);
  save(items);
  notify({ type: "upsert", item });
}

// Cambia campos de un disco sin moverlo de sitio (p. ej. para guardar su galleta).
export function updateHistoryItem(releaseId, patch) {
  const items = getHistory();
  const item = items.find((i) => i.release_id === releaseId);
  if (!item) return;
  Object.assign(item, patch);
  save(items);
  notify({ type: "upsert", item });
}

export function removeFromHistory(releaseId) {
  save(getHistory().filter((item) => item.release_id !== releaseId));
  notify({ type: "remove", ids: [releaseId] });
}

export function clearHistory() {
  const ids = getHistory().map((item) => item.release_id);
  localStorage.removeItem(KEY);
  notify({ type: "remove", ids });
}

// Sustituye la lista entera sin avisar (lo usa la nube al mezclar lo de aquí con lo de allí).
export function replaceHistory(items) {
  save(items);
}
