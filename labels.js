import { getRelease, vinylColor, releaseWeight } from "./discogs.js";
import { locateLabel } from "./ai.js";
import { getHistory, updateHistoryItem } from "./history.js";

const MAX_PHOTOS = 8;
let running = false;
// Discos que fallaron en esta visita: no se reintentan hasta volver a abrir la app.
const failedThisVisit = new Set();

// Discogs no deja que una web lea sus fotos (falta el permiso CORS). wsrv.nl es un servicio gratuito
// que reenvía imágenes públicas con ese permiso; solo recibe el enlace público de la foto.
function viaProxy(url) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=400&output=jpg`;
}

// Descarga la foto como data URL. Si no se puede leer desde el navegador, lanza un error.
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
async function findLabel(release, aiKey) {
  const photos = release.extraImages.slice(0, MAX_PHOTOS);
  if (!photos.length) return { label: { none: true, reason: "Discogs solo tiene la portada" } };

  // Las fotos van dentro del mensaje: directas de Discogs, o a través de wsrv.nl.
  // Si ninguna vía funciona, se le pasan a Gemini los enlaces.
  const notes = [];
  let images = null;
  let how = "con enlaces";
  for (const [name, toUrl] of [["Discogs", (p) => p.uri150], ["wsrv", (p) => viaProxy(p.uri)]]) {
    try {
      images = await Promise.all(photos.map((p) => toDataUrl(toUrl(p))));
      how = `fotos vía ${name}`;
      break;
    } catch (err) {
      notes.push(`${name}: ${err && err.message ? err.message : err}`);
    }
  }
  if (!images) images = photos.map((p) => p.uri150);

  const found = await locateLabel(images, aiKey);
  if (!found.ok) {
    const tried = notes.length ? `; descargas fallidas → ${notes.join(", ")}` : "";
    return { error: `Gemini (${how}): ${found.detail}${tried}`, stop: found.stop, busy: found.busy };
  }
  if (found.index === null) return { label: { none: true, reason: "ninguna foto de Discogs muestra la galleta" } };
  // Para enseñarla se usa la foto grande; la caja va en proporciones, así que vale igual.
  return { label: { src: photos[found.index].uri, box: found.box } };
}

const needsLabel = (item) => !isResolved(item) && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.6.6 solo tienen la miniatura (150 px), que se ve pixelada.
const needsCover = (item) => !item.cover && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.11.0 no saben de qué color es el vinilo.
const needsColor = (item) => item.color === undefined && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.12.0 no saben su gramaje.
const needsWeight = (item) => item.weight === undefined && !failedThisVisit.has(item.release_id);

// Recorre, de uno en uno, los discos sin galleta, sin portada grande, sin color o sin gramaje.
// onUpdate(item): se ha guardado algo nuevo del disco. onStatus(texto): resumen para la pantalla.
export async function fillMissingLabels(aiKey, discogsToken, onUpdate, onStatus) {
  if (running || !aiKey || !discogsToken) return;
  const pending = getHistory().filter((item) => needsLabel(item) || needsCover(item) || needsColor(item) || needsWeight(item));
  if (!pending.length) return;
  const labelTotal = pending.filter(needsLabel).length;
  let labelIndex = 0;
  running = true;
  let found = 0;
  let without = 0;
  const errors = [];
  let busy = "";
  try {
    for (const item of pending) {
      const wantsLabel = needsLabel(item);
      if (wantsLabel) onStatus(`Buscando galletas en Discogs: ${++labelIndex} de ${labelTotal}…`);
      let outcome;
      try {
        const release = await getRelease(item.release_id, discogsToken);
        const patch = {};
        if (!item.cover && release.image) patch.cover = release.image;
        if (item.color === undefined) patch.color = vinylColor(release.formats.map((f) => f.text));
        if (item.weight === undefined) patch.weight = releaseWeight(release);
        if (Object.keys(patch).length) {
          Object.assign(item, patch);
          updateHistoryItem(item.release_id, patch);
          onUpdate(item);
        }
        if (!wantsLabel) continue;
        outcome = await findLabel(release, aiKey);
      } catch (err) {
        outcome = { error: `Discogs: ${err && err.message ? err.message : err}`, stop: err && err.authError };
      }
      if (outcome.error) {
        // Si Gemini está saturado se para todo y se reintenta la próxima vez que se abra «Mis discos».
        if (outcome.busy) {
          busy = outcome.error;
          break;
        }
        failedThisVisit.add(item.release_id);
        errors.push(outcome.error);
        if (outcome.stop) break;
        continue;
      }
      item.label = outcome.label;
      updateHistoryItem(item.release_id, { label: outcome.label });
      if (outcome.label.src) {
        found += 1;
        onUpdate(item);
      } else {
        without += 1;
      }
    }
  } finally {
    running = false;
  }
  if (!labelTotal) return;
  const parts = [];
  if (found) parts.push(`${found} encontrada${found > 1 ? "s" : ""}`);
  if (without) parts.push(`${without} sin foto de la galleta en Discogs`);
  if (errors.length) parts.push(`${errors.length} con error (${errors[0]})`);
  if (busy) {
    const why = /cupo/.test(busy) ? "se ha agotado el cupo gratuito de Gemini" : "Gemini está saturado";
    parts.push(`${why} por ahora: lo reintento la próxima vez que abras «Mis discos»`);
  }
  onStatus(`Galletas: ${parts.join(" · ")}.`);
}
