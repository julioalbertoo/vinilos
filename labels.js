import { getRelease } from "./discogs.js";
import { locateLabel } from "./ai.js";
import { getHistory, updateHistoryItem } from "./history.js";

const MAX_PHOTOS = 8;
let running = false;

// Descarga la foto como data URL. Si Discogs no deja leerla desde el navegador, lanza un error.
async function toDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`código ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Busca la galleta de un disco. Devuelve lo que se guarda en item.label:
// { src, box } si la encuentra, { none: true } si no hay, o null si hay que reintentar otro día.
async function findLabel(item, aiKey, discogsToken) {
  const release = await getRelease(item.release_id, discogsToken);
  const photos = release.extraImages.slice(0, MAX_PHOTOS);
  if (!photos.length) return { result: { none: true } };

  // A Gemini se le mandan las fotos pequeñas; si no se pueden descargar, se le pasan los enlaces.
  let images;
  let asLinks = false;
  try {
    images = await Promise.all(photos.map((p) => toDataUrl(p.uri150)));
  } catch {
    images = photos.map((p) => p.uri150);
    asLinks = true;
  }

  const found = await locateLabel(images, aiKey);
  if (!found.ok) {
    if (found.stop) return { result: null, stop: true };
    // Si Gemini no acepta los enlaces, reintentar no arreglaría nada: se queda la galleta genérica.
    return { result: asLinks && !/red|tiempo/.test(found.detail) ? { none: true } : null };
  }
  if (found.index === null) return { result: { none: true } };
  // Para enseñarla se usa la foto grande; la caja va en proporciones, así que vale igual.
  return { result: { src: photos[found.index].uri, box: found.box } };
}

// Recorre los discos sin galleta, de uno en uno. onFound(item) se llama cada vez que se guarda una.
export async function fillMissingLabels(aiKey, discogsToken, onFound) {
  if (running || !aiKey || !discogsToken) return;
  running = true;
  try {
    const pending = getHistory().filter((item) => !item.label);
    for (const item of pending) {
      let outcome;
      try {
        outcome = await findLabel(item, aiKey, discogsToken);
      } catch (err) {
        // Sin token válido o sin red, se para y se reintenta la próxima vez.
        if (err && err.authError) break;
        continue;
      }
      if (outcome.stop) break;
      if (!outcome.result) continue;
      updateHistoryItem(item.release_id, { label: outcome.result });
      onFound({ ...item, label: outcome.result });
    }
  } finally {
    running = false;
  }
}
