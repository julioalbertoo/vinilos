import { getMasterYear, mainVinylRelease, vinylColor, COLOR_REV, releaseWeight, releaseDiscs } from "./discogs.js";
import { cachedRelease, rememberRelease } from "./details.js";
import { locateLabel } from "./ai.js";
import { getHistory, updateHistoryItem } from "./history.js";

const MAX_PHOTOS = 8;
let running = false;
let stopRequested = false;

// Para la búsqueda de galletas en curso (al identificar un disco), para no quitarle cupo de Gemini.
// Se retoma la próxima vez que se abra «Mis discos».
export function stopLabelSearch() {
  if (running) stopRequested = true;
}
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
// vienen de la v1.6.0, que fallaba sin decir por qué, y las que no llevan checkedMain, de antes de
// la v1.18.0, que no miraba la edición principal: se vuelven a buscar.
function isResolved(item) {
  return Boolean(item.label && (item.label.src || (item.label.reason && item.label.checkedMain)));
}

// Busca la galleta entre las fotos de una edición.
// Devuelve { label } si la encuentra, { none: motivo } si no, o { error, stop, busy }.
async function findInPhotos(release, aiKey) {
  const photos = release.extraImages.slice(0, MAX_PHOTOS);
  if (!photos.length) return { none: "Discogs solo tiene la portada" };

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
  if (found.index === null) return { none: "ninguna foto de Discogs muestra la galleta" };
  // Para enseñarla se usa la foto grande; la caja va en proporciones, así que vale igual.
  return { label: { src: photos[found.index].uri, box: found.box } };
}

// Devuelve { label } para guardar, o { error, stop } si hay que reintentar otro día.
// Si esta edición no tiene foto de la galleta, se busca en la edición principal en vinilo del álbum.
async function findLabel(release, aiKey, discogsToken) {
  const own = await findInPhotos(release, aiKey);
  if (!own.none) return own;
  let mainId = null;
  try {
    if (release.masterId) mainId = await mainVinylRelease(release.masterId, discogsToken, release.id);
  } catch (err) {
    return { error: `Discogs (edición principal): ${err && err.message ? err.message : err}`, stop: err && err.authError };
  }
  if (!mainId) return { label: { none: true, reason: own.none, checkedMain: true } };
  let main;
  try {
    main = await cachedRelease(mainId, discogsToken);
  } catch (err) {
    return { error: `Discogs (edición principal): ${err && err.message ? err.message : err}`, stop: err && err.authError };
  }
  const other = await findInPhotos(main, aiKey);
  if (other.label) return { label: { ...other.label, fromRelease: mainId } };
  if (other.error) return other;
  return { label: { none: true, reason: "ni esta edición ni la principal en vinilo tienen foto de la galleta", checkedMain: true } };
}

// Discos cuya galleta se está buscando ahora desde su ficha: la búsqueda de fondo se los salta.
const searchingNow = new Set();

const needsLabel = (item) => !isResolved(item) && !failedThisVisit.has(item.release_id) && !searchingNow.has(item.release_id);
// Los discos guardados antes de la v1.6.6 solo tienen la miniatura (150 px), que se ve pixelada.
const needsCover = (item) => !item.cover && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.11.0 no saben de qué color es el vinilo.
// Y los guardados como negros con una lista de colores anterior se vuelven a mirar (p. ej. «Rainbow»).
const colorOutdated = (item) => item.color === undefined || (item.color === "" && (item.colorRev || 0) < COLOR_REV);
const needsColor = (item) => colorOutdated(item) && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.12.0 no saben su gramaje.
const needsWeight = (item) => item.weight === undefined && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.49.0 no saben cuántos vinilos traen.
const needsDiscs = (item) => item.discs === undefined && !failedThisVisit.has(item.release_id);
// Los discos guardados antes de la v1.19.0 no saben el año del álbum original.
const needsOriginalYear = (item) => item.originalYear === undefined && !failedThisVisit.has(item.release_id);

// Al abrir la ficha de un disco sin galleta, se vuelve a buscar aunque antes no se encontrara
// (Discogs puede tener fotos nuevas). release: la ficha ya descargada.
// Devuelve un texto para enseñar en la ficha, o "" si no hay nada que decir.
export async function retryLabel(item, release, aiKey, discogsToken) {
  if (!item || (item.label && item.label.src) || !aiKey || !discogsToken || searchingNow.has(item.release_id)) return "";
  searchingNow.add(item.release_id);
  try {
    const outcome = await findLabel(release, aiKey, discogsToken);
    if (outcome.error) {
      if (outcome.busy) return "No pude buscar la galleta: probé todos los modelos de respaldo y están saturados o sin cupo. Lo reintento más tarde.";
      return `No pude buscar la galleta (${outcome.error}).`;
    }
    item.label = outcome.label;
    failedThisVisit.delete(item.release_id);
    updateHistoryItem(item.release_id, { label: outcome.label });
    return outcome.label.src
      ? outcome.label.fromRelease
        ? "✓ Galleta encontrada en la edición principal en vinilo: ya la verás en el disco."
        : "✓ Galleta encontrada: ya la verás en el disco."
      : `Sin galleta: ${outcome.label.reason}.`;
  } finally {
    searchingNow.delete(item.release_id);
  }
}

// Recorre, de uno en uno, los discos sin galleta, sin portada grande, sin color, sin gramaje o sin año original.
// onUpdate(item): se ha guardado algo nuevo del disco. onStatus(texto): resumen para la pantalla.
export async function fillMissingLabels(aiKey, discogsToken, onUpdate, onStatus) {
  if (running || !aiKey || !discogsToken) return;
  const pending = getHistory().filter((item) => needsLabel(item) || needsCover(item) || needsColor(item) || needsWeight(item) || needsDiscs(item) || needsOriginalYear(item));
  if (!pending.length) return;
  const labelTotal = pending.filter(needsLabel).length;
  let labelIndex = 0;
  running = true;
  stopRequested = false;
  let found = 0;
  let without = 0;
  const errors = [];
  let busy = "";
  try {
    for (const item of pending) {
      if (stopRequested) break;
      const wantsLabel = needsLabel(item);
      if (wantsLabel) onStatus(`Buscando galletas en Discogs: ${++labelIndex} de ${labelTotal}…`);
      let outcome;
      try {
        const release = await cachedRelease(item.release_id, discogsToken);
        const patch = {};
        if (!item.cover && release.image) patch.cover = release.image;
        if (colorOutdated(item)) {
          patch.color = vinylColor(release.formats.map((f) => f.text));
          patch.colorRev = COLOR_REV;
        }
        if (item.weight === undefined) patch.weight = releaseWeight(release);
        if (item.discs === undefined) patch.discs = releaseDiscs(release);
        if (item.originalYear === undefined) {
          if (release.originalYear === undefined) {
            release.originalYear = await getMasterYear(release.masterId, discogsToken);
            rememberRelease(release);
          }
          patch.originalYear = release.originalYear;
        }
        if (Object.keys(patch).length) {
          Object.assign(item, patch);
          updateHistoryItem(item.release_id, patch);
          onUpdate(item);
        }
        if (!wantsLabel) continue;
        outcome = await findLabel(release, aiKey, discogsToken);
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
  if (stopRequested) {
    onStatus("");
    return;
  }
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
