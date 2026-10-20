import { getRelease } from "./discogs.js";
import { locateLabel } from "./ai.js";
import { getHistory, updateHistoryItem } from "./history.js";

const MAX_PHOTOS = 8;
let running = false;
// Discos que fallaron en esta visita: no se reintentan hasta volver a abrir la app.
const failedThisVisit = new Set();

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

// Galleta ya resuelta: encontrada, o confirmado que no hay foto. Las marcas "none" sin motivo
// vienen de la v1.6.0, que fallaba sin decir por qué: se vuelven a buscar.
function isResolved(item) {
  return Boolean(item.label && (item.label.src || item.label.reason));
}

// Devuelve { label } para guardar, o { error, stop } si hay que reintentar otro día.
async function findLabel(item, aiKey, discogsToken) {
  const release = await getRelease(item.release_id, discogsToken);
  const photos = release.extraImages.slice(0, MAX_PHOTOS);
  if (!photos.length) return { label: { none: true, reason: "Discogs solo tiene la portada" } };

  // Se intenta mandar las fotos dentro del mensaje; si Discogs no deja descargarlas, van los enlaces.
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
    const how = asLinks ? "con enlaces" : "con fotos";
    return { error: `Gemini (${how}): ${found.detail}`, stop: found.stop };
  }
  if (found.index === null) return { label: { none: true, reason: "ninguna foto de Discogs muestra la galleta" } };
  // Para enseñarla se usa la foto grande; la caja va en proporciones, así que vale igual.
  return { label: { src: photos[found.index].uri, box: found.box } };
}

// Recorre los discos sin galleta, de uno en uno.
// onFound(item): se ha guardado su galleta. onStatus(texto): resumen para enseñar en pantalla.
export async function fillMissingLabels(aiKey, discogsToken, onFound, onStatus) {
  if (running || !aiKey || !discogsToken) return;
  const pending = getHistory().filter((item) => !isResolved(item) && !failedThisVisit.has(item.release_id));
  if (!pending.length) return;
  running = true;
  let found = 0;
  let without = 0;
  const errors = [];
  try {
    for (const [i, item] of pending.entries()) {
      onStatus(`Buscando galletas en Discogs: ${i + 1} de ${pending.length}…`);
      let outcome;
      try {
        outcome = await findLabel(item, aiKey, discogsToken);
      } catch (err) {
        outcome = { error: `Discogs: ${err && err.message ? err.message : err}`, stop: err && err.authError };
      }
      if (outcome.error) {
        failedThisVisit.add(item.release_id);
        errors.push(outcome.error);
        if (outcome.stop) break;
        continue;
      }
      updateHistoryItem(item.release_id, { label: outcome.label });
      if (outcome.label.src) {
        found += 1;
        onFound({ ...item, label: outcome.label });
      } else {
        without += 1;
      }
    }
  } finally {
    running = false;
  }
  const parts = [];
  if (found) parts.push(`${found} encontrada${found > 1 ? "s" : ""}`);
  if (without) parts.push(`${without} sin foto de la galleta en Discogs`);
  if (errors.length) parts.push(`${errors.length} con error (${errors[0]})`);
  onStatus(`Galletas: ${parts.join(" · ")}.`);
}
