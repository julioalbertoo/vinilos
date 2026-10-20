import { getRelease } from "./discogs.js";
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
async function findLabel(item, aiKey, discogsToken) {
  const release = await getRelease(item.release_id, discogsToken);
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
  let busy = false;
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
        // Si Gemini está saturado se para todo y se reintenta la próxima vez que se abra «Mis discos».
        if (outcome.busy) {
          busy = true;
          break;
        }
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
  if (busy) parts.push("Gemini está saturado ahora mismo: lo reintento la próxima vez que abras «Mis discos»");
  onStatus(`Galletas: ${parts.join(" · ")}.`);
}
