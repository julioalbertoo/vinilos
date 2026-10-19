import { CONFIG } from "./config.js";

const KEY = CONFIG.STORAGE_KEYS.history;
const MAX_ITEMS = 500;

// Cada entrada: { release_id, artist, title, year, thumb, date }. release_id es la clave para
// sincronizar con la colección de Discogs en la v2.
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

// Si el disco ya estaba, se actualiza y sube al principio en vez de duplicarse.
export function addToHistory(entry) {
  const items = getHistory().filter((item) => item.release_id !== entry.release_id);
  items.unshift({ ...entry, date: new Date().toISOString() });
  save(items);
}

export function removeFromHistory(releaseId) {
  save(getHistory().filter((item) => item.release_id !== releaseId));
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}
