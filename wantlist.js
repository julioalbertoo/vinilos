// «Lo que busco» (wantlist): álbumes que no tienes y quieres conseguir. Se guarda en este móvil y, con cuenta,
// también en la nube (cloud.js se apunta a los cambios con onWantlistChange).
// Cada entrada: { artist, title, year, thumb, id, masterId, mbid, masterChecked, date }. Se reconoce por artista y
// título, así un mismo álbum marcado desde MusicBrainz o desde Discogs no se apunta dos veces.
const KEY = "vinilos_wantlist";

const norm = (text) =>
  String(text || "")
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\*/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[([].*?[)\]]/g, "")
    .replace(/[^a-z0-9]+/g, "");

export const wantKey = (artist, title) => `${norm(artist)}|${norm(title)}`;

export function getWantlist() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function save(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Sin espacio en el móvil: no se guarda.
  }
}

// Quien quiera enterarse de los cambios (la copia en la nube) se apunta aquí.
// change: { type: "upsert", item } o { type: "remove", keys }.
const listeners = [];
export function onWantlistChange(fn) {
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

// Sustituye la lista entera sin avisar (lo usa la nube al mezclar lo de aquí con lo de allí).
export function replaceWantlist(items) {
  save(items);
}

export function isWanted(artist, title) {
  const key = wantKey(artist, title);
  return getWantlist().some((item) => wantKey(item.artist, item.title) === key);
}

export function addWanted(entry) {
  const key = wantKey(entry.artist, entry.title);
  const items = getWantlist().filter((item) => wantKey(item.artist, item.title) !== key);
  const item = {
    artist: entry.artist || "",
    title: entry.title || "",
    year: entry.year || "",
    thumb: entry.thumb || "",
    id: entry.id || null,
    masterId: entry.masterId || null,
    mbid: entry.mbid || null,
    date: new Date().toISOString(),
  };
  items.unshift(item);
  save(items);
  notify({ type: "upsert", item });
}

// Cambia campos de un álbum de la lista sin moverlo de sitio (p. ej. su álbum de Discogs, para el precio).
export function updateWanted(artist, title, patch) {
  const key = wantKey(artist, title);
  const items = getWantlist();
  const item = items.find((i) => wantKey(i.artist, i.title) === key);
  if (!item) return;
  Object.assign(item, patch);
  save(items);
  notify({ type: "upsert", item });
}

export function removeWanted(artist, title) {
  const key = wantKey(artist, title);
  const items = getWantlist();
  const left = items.filter((item) => wantKey(item.artist, item.title) !== key);
  if (left.length === items.length) return;
  save(left);
  notify({ type: "remove", keys: [key] });
}

// Marca o desmarca. Devuelve true si queda en la lista.
export function toggleWanted(entry) {
  if (isWanted(entry.artist, entry.title)) {
    removeWanted(entry.artist, entry.title);
    return false;
  }
  addWanted(entry);
  return true;
}

// Al conseguir un disco (se guarda en «Mis discos») sale solo de la lista.
export function removeWantedRelease({ artist, title, id, masterId }) {
  const key = wantKey(artist, title);
  const items = getWantlist();
  const left = items.filter(
    (item) =>
      wantKey(item.artist, item.title) !== key &&
      !(id && String(item.id) === String(id)) &&
      !(masterId && String(item.masterId) === String(masterId))
  );
  if (left.length === items.length) return;
  save(left);
  notify({ type: "remove", keys: items.filter((item) => !left.includes(item)).map((item) => wantKey(item.artist, item.title)) });
}
