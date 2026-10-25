import { CONFIG } from "./config.js";

// «Discos explorados»: lo que se identifica en modo explorador. Solo se guarda en este móvil (no va a la nube).
// Cada entrada: { release_id, artist, title, year, thumb, date }. Si se explora otra vez, sube al principio.
const KEY = CONFIG.STORAGE_KEYS.explored;
const MAX_ITEMS = 200;

export function getExplored() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function save(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // Sin espacio en el móvil: no se guarda.
  }
}

export function addExplored(entry) {
  const id = String(entry.release_id);
  const items = getExplored().filter((item) => String(item.release_id) !== id);
  items.unshift({ ...entry, date: new Date().toISOString() });
  save(items);
}

export function removeExplored(releaseId) {
  save(getExplored().filter((item) => String(item.release_id) !== String(releaseId)));
}

export function clearExplored() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
