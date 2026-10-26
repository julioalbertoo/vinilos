// Pestaña «Datos» de «Mis discos»: valor estimado, géneros, duración, años, portadas, mapa, curiosidades…
// Lo que no está en el historial (géneros, país, precios, canciones…) sale de la ficha de Discogs de cada disco.
// Se guarda un resumen pequeño en el móvil; con cuenta, se leen de golpe las fichas guardadas en la nube
// y lo que falte se pide a Discogs poco a poco, en segundo plano, mientras la pestaña está abierta.
import { CONFIG } from "./config.js";
import { cachedRelease, cachedPrices, fillDurations, DURATIONS_CHECK, cachedCheapest, savedCheapest } from "./details.js";
import { RELEASE_VERSION, findAlbumMaster } from "./discogs.js";
import { loadDetailSummaries, cloudUser } from "./cloud.js";
import { releaseWeight, isHeavy, countryFlag, countryCodes } from "./discogs.js";
import { mbDiscogsMaster } from "./musicbrainz.js";
import { getWantlist, updateWanted, wantKey } from "./wantlist.js";
import { savedDiscography, ensureDiscography, discographyProgress, hasArtistPage } from "./artist.js";
import {
  el, card, tile, note, hint, pill, plural, level, legend, segmented, coverStrip, rankList, podium, factGrid, navBar,
  genreVinylCard, decadeTagCard, rainbowCard, coverColor, durationCard, timelineCard, mapCard, stackCard, splitBar, compareTo,
} from "./charts.js";

const CACHE_KEY = CONFIG.STORAGE_KEYS.statsCache;
const PRICES_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Sube cuando el resumen guarda campos nuevos: los resúmenes antiguos se rehacen
// (2: canciones y duración; 3: ediciones especiales, caras, tamaño y canciones récord).
const SUMMARY_VERSION = 3;
// Si Discogs no da la duración de ninguna canción de un disco, se cuenta esto por canción.
const DEFAULT_TRACK_SECONDS = 4 * 60;

// ---------- Resumen guardado en el móvil ----------

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

const cache = readCache();

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Sin espacio: los datos valen hasta cerrar la app.
  }
}

const cleanName = (name) => String(name || "").replace(/\s*\(\d+\)/g, "").replace(/\*/g, "").trim();

// "3:45" → 225; "1:02:10" → 3730; "" → 0.
function seconds(duration) {
  const parts = String(duration || "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

// Lo especial de una edición según su formato en Discogs. [clave, nombre en «Datos», nombre corto, ¿la tiene?]
// d: descripciones del formato en minúsculas («limited edition», «45 rpm»…); t: el texto libre; names: nombres del formato.
const FORMAT_TAGS = [
  ["limited", "🔢 Limitadas", "limitada", (d, t) => d.has("limited edition") || /\blimited\b/.test(t)],
  ["numbered", "#️⃣ Numeradas", "numerada", (d, t) => d.has("numbered") || /numbered/.test(t)],
  ["picture", "🖼️ Picture disc", "picture disc", (d, t) => d.has("picture disc") || /picture ?disc/.test(t)],
  ["gatefold", "📖 Con carpeta (gatefold)", "con carpeta", (d, t) => d.has("gatefold") || /gate-?fold/.test(t)],
  ["deluxe", "✨ Deluxe o especiales", "deluxe", (d, t) => d.has("deluxe edition") || d.has("special edition") || /\bdeluxe\b/.test(t)],
  ["box", "📦 En caja", "en caja", (d, t, names) => names.has("box set")],
  ["double", "💿 Dobles o más", "doble", () => false], // sale del número de vinilos, no del texto
  ["rpm45", "⚡ A 45 rpm", "a 45 rpm", (d) => d.has("45 rpm")],
  ["mono", "📻 En mono", "mono", (d) => d.has("mono")],
  ["remaster", "🎚️ Remasterizadas", "remasterizada", (d) => d.has("remastered")],
  ["promo", "📣 Promo o de prueba", "promo", (d) => d.has("promo") || d.has("test pressing") || d.has("white label")],
  ["unofficial", "🏴‍☠️ No oficiales", "no oficial", (d) => d.has("unofficial release")],
];
// Las que hacen de un disco una edición especial (las demás son detalles del formato).
const SPECIAL_TAGS = new Set(["limited", "numbered", "picture", "deluxe", "box", "promo", "unofficial"]);

function formatTags(formats) {
  const d = new Set(formats.flatMap((f) => f.descriptions || []).map((x) => String(x).toLowerCase()));
  const t = formats.map((f) => f.text || "").join(" ").toLowerCase();
  const names = new Set(formats.map((f) => String(f.name || "").toLowerCase()));
  return FORMAT_TAGS.filter(([, , , has]) => has(d, t, names)).map(([key]) => key);
}

// Tamaño del vinilo en pulgadas (7, 10 o 12; 12 si Discogs no lo dice).
function inchesOf(formats) {
  const d = formats.flatMap((f) => f.descriptions || []).join(" ");
  return /\b7"/.test(d) ? 7 : /\b10"/.test(d) ? 10 : 12;
}

// Caras del disco según las posiciones de las canciones (A1, B2, C1… → 3). 0 si no usan letras.
function sidesOf(tracks) {
  const sides = new Set();
  for (const t of tracks) {
    const match = /^([A-Z])\1?(?:\d|$)/.exec(String(t.position || "").trim().toUpperCase());
    if (match) sides.add(match[0].replace(/\d+$/, ""));
  }
  return sides.size;
}

// Lo que interesa de una ficha (completa, o el resumen que llega de la nube).
function summarize(source) {
  const community = source.community || null;
  const labels = Array.isArray(source.labels) ? source.labels : [];
  const formats = Array.isArray(source.formats) ? source.formats : [];
  const tracks = (Array.isArray(source.tracklist) ? source.tracklist : []).filter((t) => !t.type_ || t.type_ === "track");
  const songs = tracks.map((t) => ({ t: String(t.title || "").trim(), s: seconds(t.duration) })).filter((x) => x.s > 0);
  const timed = songs.map((x) => x.s);
  const vinyl = formats.filter((f) => /vinyl|lp/i.test(f.name || ""));
  // La más corta: se ignoran los cortes de pocos segundos (silencios entre canciones, pistas ocultas).
  const real = songs.filter((x) => x.s >= 10);
  return {
    v: SUMMARY_VERSION,
    genres: Array.isArray(source.genres) ? source.genres : [],
    styles: Array.isArray(source.styles) ? source.styles : [],
    country: source.country || "",
    label: labels.length ? cleanName(labels[0].name) : "",
    weight: releaseWeight({ formats: formats.map((f) => ({ text: f.text || "", descriptions: f.descriptions || [] })) }),
    have: community ? community.have || 0 : null,
    want: community ? community.want || 0 : null,
    rating: community && community.rating ? community.rating : null,
    originalYear: source.originalYear || "",
    tracks: tracks.length,
    timedTracks: timed.length,
    seconds: timed.reduce((a, b) => a + b, 0),
    durationsChecked: Number(source.durationsChecked) === DURATIONS_CHECK,
    tags: formatTags(formats),
    vinyls: vinyl.reduce((sum, f) => sum + (Number.parseInt(f.qty, 10) || 1), 0),
    sides: sidesOf(tracks),
    inches: inchesOf(formats),
    longest: songs.length ? songs.reduce((a, b) => (b.s > a.s ? b : a)) : null,
    shortest: real.length ? real.reduce((a, b) => (b.s < a.s ? b : a)) : null,
    // Ficha guardada con una versión antigua (p. ej. sin los temas en varias partes): se vuelve a pedir.
    oldData: Number(source.v || 0) !== RELEASE_VERSION,
  };
}

const isFresh = (at) => Boolean(at) && Date.now() - new Date(at).getTime() < PRICES_MAX_AGE;
const newer = (a, b) => (a ? new Date(a).getTime() : 0) > (b ? new Date(b).getTime() : 0);

// ---------- Datos de la nube, de una vez ----------

let primedFor = null;

async function primeFromCloud() {
  const user = cloudUser();
  if (!user || primedFor === user.id) return false;
  primedFor = user.id;
  let rows = null;
  try {
    rows = await loadDetailSummaries();
  } catch {
    primedFor = null; // se reintentará la próxima vez
    return false;
  }
  if (!rows) return false;
  let changed = false;
  for (const row of rows) {
    const id = String(row.release_id);
    const entry = cache[id] || {};
    if (row.genres && (entry.v !== SUMMARY_VERSION || newer(row.data_at, entry.dataAt))) {
      Object.assign(entry, summarize(row), { dataAt: row.data_at });
      changed = true;
    }
    if (row.prices && newer(row.prices_at, entry.pricesAt)) {
      Object.assign(entry, { prices: row.prices, pricesAt: row.prices_at });
      changed = true;
    }
    cache[id] = entry;
  }
  if (changed) writeCache();
  return changed;
}

// ---------- Relleno en segundo plano ----------

let active = false;
let running = false;
let latest = null; // { items, token, onUpdate, onStatus }
const failed = new Set(); // discos que fallaron en esta visita: no se insiste

export function setStatsActive(on) {
  active = on;
}

// Faltan duraciones y aún no se han buscado en otras ediciones del álbum.
const missingDurations = (entry) =>
  Boolean(entry.oldData) || (Boolean(entry.tracks) && entry.timedTracks < entry.tracks && !entry.durationsChecked);

function needsWork(item) {
  const id = String(item.release_id);
  if (failed.has(id)) return false;
  const entry = cache[id];
  return !entry || !entry.dataAt || entry.v !== SUMMARY_VERSION || !isFresh(entry.pricesAt) || missingDurations(entry);
}

// Si al volver a la pestaña aún seguía la vuelta anterior, se da otra al terminar.
let again = false;

async function runFill() {
  running = true;
  again = false;
  try {
    // Primero lo que haya en la nube: suele traerlo casi todo sin preguntar a Discogs.
    if (await primeFromCloud()) latest.onUpdate();
    // Luego tus discos, después los precios de lo que buscas y al final las discografías.
    if (!(await fillRecords()) || !(await fillWantlist()) || !(await fillDiscographies())) return;
    latest.onStatus(latest.token ? "" : "Añade tu token de Discogs en Ajustes para ver precios, géneros y duración.");
  } finally {
    running = false;
    if (again && active) runFill().catch(() => {});
  }
}

const authFailed = () => latest.onStatus("❌ El token de Discogs no es válido: revisa tus llaves en Ajustes.");

// Géneros, precios, canciones… de tus discos. false si el token no vale.
async function fillRecords() {
  while (active && latest.token) {
    const { items, token } = latest;
    const pending = items.filter(needsWork);
    if (!pending.length) return true;
    const item = pending[0];
    const id = String(item.release_id);
    latest.onStatus(`🔄 Completando datos con Discogs… ${items.length - pending.length + 1} de ${items.length}`);
    const entry = cache[id] || {};
    try {
      if (!entry.dataAt || entry.v !== SUMMARY_VERSION || missingDurations(entry)) {
        // Con cuenta, la ficha suele salir de la nube sin preguntar a Discogs.
        const release = await fillDurations(await cachedRelease(item.release_id, token), token);
        Object.assign(entry, summarize(release), { dataAt: entry.dataAt || new Date().toISOString() });
        // Si Discogs no respondió y quedó la ficha antigua, no se insiste en esta visita.
        if (entry.oldData) failed.add(id);
      }
      if (!isFresh(entry.pricesAt)) {
        const { prices, at } = await cachedPrices(item.release_id, token);
        Object.assign(entry, { prices, pricesAt: at });
      }
    } catch (err) {
      failed.add(id);
      if (err.authError) {
        authFailed();
        return false;
      }
    }
    cache[id] = entry;
    writeCache();
    if (active) latest.onUpdate();
  }
  return true;
}

// ---------- Lo que busco: el vinilo más barato de cada álbum ----------

// Álbumes ya mirados en esta visita (bien o mal), para no insistir; y lo encontrado, por si no cabe en el móvil.
const wantTried = new Set();
const wantPrices = new Map();

const cheapestOf = (w) => (w.masterId ? wantPrices.get(String(w.masterId)) || savedCheapest(w.masterId) : null);
const wantNeedsWork = (w) => !wantTried.has(wantKey(w.artist, w.title)) && (w.masterId ? !cheapestOf(w) : !w.masterChecked);

// Álbum (master) de Discogs de algo de tu lista: por su edición, por el enlace de MusicBrainz o buscándolo.
async function findWantedMaster(w, token) {
  if (w.id) {
    const release = await cachedRelease(w.id, token);
    if (release.masterId) return release.masterId;
  }
  if (w.mbid) {
    try {
      const id = await mbDiscogsMaster(w.mbid);
      if (id) return id;
    } catch {
      // Se busca en Discogs.
    }
  }
  return findAlbumMaster(w.artist, w.title, token);
}

async function fillWantlist() {
  while (active && latest.token) {
    const list = getWantlist();
    const pending = list.filter(wantNeedsWork);
    if (!pending.length) return true;
    const w = pending[0];
    wantTried.add(wantKey(w.artist, w.title));
    latest.onStatus(`🔄 Buscando precios de lo que buscas… ${list.length - pending.length + 1} de ${list.length}`);
    try {
      let masterId = w.masterId;
      if (!masterId) {
        masterId = await findWantedMaster(w, latest.token);
        updateWanted(w.artist, w.title, masterId ? { masterId } : { masterChecked: true });
      }
      if (masterId) {
        const result = await cachedCheapest(masterId, latest.token, { stop: () => !active });
        // Cortado al salir de la pestaña: se termina otra vez.
        if (!result) {
          wantTried.delete(wantKey(w.artist, w.title));
          return true;
        }
        wantPrices.set(String(masterId), result);
      }
    } catch (err) {
      if (err.authError) {
        authFailed();
        return false;
      }
    }
    if (active) latest.onUpdate();
  }
  return true;
}

// ---------- Discografías de tus artistas ----------

// Se miran tus artistas con más discos (con dos o más; si hay pocos, los primeros aunque tengan uno).
const DISCOGRAPHY_MAX = 12;

function discographyArtists(items) {
  const counts = countBy(items.map((i) => cleanName(i.artist))).filter(([name]) => hasArtistPage(name));
  const repeated = counts.filter(([, n]) => n >= 2);
  const pick = repeated.length >= 3 ? repeated.slice(0, DISCOGRAPHY_MAX) : counts.slice(0, 5);
  return pick.map(([name]) => name);
}

const discTried = new Set();
const discographies = new Map(); // nombre → ficha con discografía (también si no cupo en el móvil)
const discographyOf = (name) => discographies.get(name) || savedDiscography(name);

async function fillDiscographies() {
  while (active && latest.token) {
    const names = discographyArtists(latest.items);
    const pending = names.filter((name) => !discTried.has(name) && !discographyOf(name));
    if (!pending.length) return true;
    const name = pending[0];
    discTried.add(name);
    latest.onStatus(`🔄 Buscando discografías de tus artistas… ${names.length - pending.length + 1} de ${names.length}`);
    try {
      const entry = await ensureDiscography(name, latest.items, latest.token);
      if (entry) discographies.set(name, entry);
    } catch (err) {
      if (err.authError) {
        authFailed();
        return false;
      }
    }
    if (active) latest.onUpdate();
  }
  return true;
}

// Colores de las portadas: se leen de la foto en el propio móvil, una vez por disco.
let coloring = false;
const coverSrc = (item) => item.thumb || item.cover || "";
const needsColor = (item) => {
  const entry = cache[String(item.release_id)];
  return coverSrc(item) && !(entry && "cc" in entry);
};

async function runColors() {
  coloring = true;
  try {
    let since = 0;
    while (active) {
      const batch = latest.items.filter(needsColor).slice(0, 3);
      if (!batch.length) break;
      const colors = await Promise.all(batch.map((item) => coverColor(coverSrc(item))));
      batch.forEach((item, i) => {
        const id = String(item.release_id);
        cache[id] = { ...(cache[id] || {}), cc: colors[i] || false }; // false = no se pudo leer
      });
      writeCache();
      since += batch.length;
      // Se repinta cada pocos discos para no redibujar todo a cada uno.
      if (since >= 6 && active) {
        since = 0;
        latest.onUpdate();
      }
    }
    if (active) latest.onUpdate();
  } finally {
    coloring = false;
  }
}

function startFill(items, token, onUpdate, onStatus) {
  latest = { items, token, onUpdate, onStatus };
  if (!running) runFill().catch(() => {});
  else again = true;
  if (!coloring) runColors().catch(() => {});
}

// ---------- Cálculos ----------

const yearOf = (value) => {
  const n = Number.parseInt(value, 10);
  return n > 1800 && n < 2200 ? n : null;
};

// Precio estimado de un disco: el sugerido para VG+ (estado típico de un disco usado);
// si no hay, lo más barato a la venta; si no, otro sugerido.
// source dice de dónde sale: "vg+" (sugerido VG+), "lowest" (más barato a la venta) u "other" (sugerido de otro estado).
export function estimate(prices) {
  if (!prices) return null;
  const suggested = Array.isArray(prices.suggested) ? prices.suggested : [];
  const vgPlus = suggested.find((s) => s.grade === "VG+");
  const lowest = prices.lowest && prices.lowest.value ? prices.lowest : null;
  const [pick, source, grade] = vgPlus ? [vgPlus, "vg+", "VG+"] : lowest ? [lowest, "lowest", ""] : [suggested[0], "other", suggested[0] && suggested[0].grade];
  return pick && pick.value ? { value: Number(pick.value), currency: pick.currency || "EUR", source, grade } : null;
}

// Texto corto de dónde sale el precio de un disco.
export function priceSource(price) {
  if (!price) return "";
  if (price.source === "lowest") return "el más barato a la venta";
  return `sugerido para ${price.grade || "su estado"}`;
}

const SOURCE_NAMES = { "vg+": "Sugerido para VG+", lowest: "Más barato a la venta", other: "Sugerido para otro estado", none: "Sin precio" };

function countBy(list) {
  const map = new Map();
  for (const key of list) if (key) map.set(key, (map.get(key) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"));
}

// Duración de un disco: la suma de sus canciones; si faltan algunas, se calcula aproximada.
function recordLength(s) {
  if (!s.tracks) return null;
  if (s.timedTracks === s.tracks) return { seconds: s.seconds, estimated: false };
  if (s.timedTracks) return { seconds: (s.seconds / s.timedTracks) * s.tracks, estimated: true };
  return { seconds: s.tracks * DEFAULT_TRACK_SECONDS, estimated: true };
}

function compute(items, yearMode) {
  const rows = items.map((item) => {
    const s = cache[String(item.release_id)] || {};
    const original = yearOf(item.originalYear || s.originalYear) || yearOf(item.year);
    return {
      item,
      s,
      year: yearMode === "edition" ? yearOf(item.year) : original,
      original,
      edition: yearOf(item.year),
      price: estimate(s.prices),
    };
  });
  const withData = rows.filter((r) => r.s.dataAt);
  const totals = new Map();
  for (const r of rows) if (r.price) totals.set(r.price.currency, (totals.get(r.price.currency) || 0) + r.price.value);
  return { rows, withData, totals, priced: rows.filter((r) => r.price) };
}

// ---------- Pintar ----------

function money(value, currency = "EUR", digits = 0) {
  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

// Map clave → discos. keysOf(fila) da las claves de cada disco (un género, un país…).
function groupBy(rows, keysOf) {
  const map = new Map();
  for (const r of rows) for (const key of keysOf(r)) if (key) map.set(key, [...(map.get(key) || []), r.item]);
  return map;
}

// "los 70", "los 2000".
const decadeName = (decade) => `los ${decade < 2000 ? String(decade).slice(2) : decade}`;

// Estado de la pantalla que se mantiene entre repintados.
let yearMode = "original";
let selectedYear = null;
let peopleMode = "artists";
const picks = {
  country: null, artists: null, labels: null, rarity: null, hot: false, source: null, style: null,
  special: null, discog: null, wantAll: false,
};

// Entradas de la barra de accesos, en el orden de la página.
const NAV = [
  ["value", "💶 Valor"],
  ["genres", "🎸 Géneros"],
  ["duration", "⏱️ Duración"],
  ["songs", "🎵 Canciones"],
  ["needle", "🪡 Aguja"],
  ["stack", "📦 Pila"],
  ["special", "🎛️ Ediciones"],
  ["years", "📅 Años"],
  ["colors", "🌈 Colores"],
  ["map", "🌍 Mapa"],
  ["rare", "💎 Rareza"],
  ["people", "🎤 Artistas"],
  ["discog", "🧩 Discografías"],
  ["want", "⭐ Lo que busco"],
  ["fun", "✨ Curiosidades"],
  ["added", "🗓️ Añadidos"],
];

// Las cuatro cifras de arriba: discos, artistas, países y horas de música.
function summaryTiles(items, artists, countries, lengths, onArtists) {
  const seconds = lengths.reduce((sum, r) => sum + r.seconds, 0);
  const music = !seconds ? "—" : seconds >= 3600 ? `${Math.round(seconds / 3600).toLocaleString("es-ES")} h` : `${Math.max(1, Math.round(seconds / 60))} min`;
  const box = el("div", "stats-tiles stats-summary");
  box.append(
    tile(items.length.toLocaleString("es-ES"), items.length === 1 ? "disco" : "discos", { icon: "💿", accent: "lilac" }),
    tile(artists.length.toLocaleString("es-ES"), artists.length === 1 ? "artista" : "artistas", { icon: "🎤", accent: "peach", onClick: onArtists, ariaLabel: "Ver tus artistas" }),
    tile(countries.length ? String(countries.length) : "—", countries.length === 1 ? "país" : "países", { icon: "🌍", accent: "sky" }),
    tile(music, "de música", { icon: "🎧", accent: "mint" })
  );
  return box;
}

function valueCard(data, items, onOpen, rerender) {
  const head = { icon: "💶", title: "Valor estimado", sub: "Según los precios de Discogs", accent: "butter", nav: "value" };
  if (!data.totals.size) {
    return card(head, pill("⏳ Aún no hay precios: se piden a Discogs poco a poco.", "butter"));
  }
  const [mainCurrency] = [...data.totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = [...data.totals.entries()].map(([cur, v]) => money(v, cur)).join(" + ");
  const mainPriced = data.priced.filter((r) => r.price.currency === mainCurrency);
  const avg = data.totals.get(mainCurrency) / mainPriced.length;
  const top = [...data.priced].sort((a, b) => b.price.value - a.price.value).slice(0, 3);
  const box = card(
    head,
    el("p", "stats-big", total),
    el("p", "stats-big-note", `unos ${money(avg, mainCurrency)} por disco de media`),
    top.length ? el("p", "stats-sub", "🏆 Los más valiosos") : null,
    top.length ? podium(top.map((r) => ({ item: r.item, value: money(r.price.value, r.price.currency) })), onOpen) : null,
    el("p", "stats-sub", "🔎 De dónde sale el precio"),
    sourceList(data, rerender, onOpen),
    picks.source ? null : hint("Toca una fila para ver sus discos."),
    note(
      "Se usa el precio que Discogs sugiere para un disco en estado VG+ (muy bueno, usado). Si no lo hay, el más " +
        "barato a la venta ahora; si nadie lo vende, el sugerido para otro estado. Solo cuenta el estado del disco, no el de la funda."
    )
  );
  box.classList.add("stats-card--hero");
  return box;
}

// Cuántos discos tienen cada tipo de precio; tocar una fila enseña sus discos con su precio.
function sourceList(data, rerender, onOpen) {
  const byKey = new Map();
  for (const r of data.rows) {
    const name = SOURCE_NAMES[r.price ? r.price.source : "none"];
    byKey.set(name, [...(byKey.get(name) || []), r]);
  }
  const entries = Object.values(SOURCE_NAMES).map((name) => [name, (byKey.get(name) || []).length]).filter(([, n]) => n);
  const list = rankList(entries, data.rows.length, { max: entries.length });
  // Filas que se pueden tocar: debajo salen sus discos, del más caro al más barato.
  [...list.querySelectorAll(".stats-bar")].forEach((row, i) => {
    const [name] = entries[i];
    const button = el("button", "stats-bar");
    button.type = "button";
    button.setAttribute("aria-expanded", String(picks.source === name));
    if (picks.source === name) button.classList.add("active");
    button.append(...row.childNodes);
    button.addEventListener("click", () => {
      picks.source = picks.source === name ? null : name;
      rerender();
    });
    row.replaceWith(button);
    if (picks.source !== name) return;
    const rows = [...byKey.get(name)].sort((a, b) => (b.price ? b.price.value : 0) - (a.price ? a.price.value : 0));
    const facts = rows.map((r) => ({
      icon: "💶",
      label: r.price ? priceSource(r.price).replace(/^./, (c) => c.toUpperCase()) : "Discogs no da precio",
      item: r.item,
      value: r.price ? money(r.price.value, r.price.currency) : "—",
    }));
    button.after(factGrid(facts, onOpen));
  });
  return list;
}

function yearsCard(data, rerender, onOpen) {
  const head = { icon: "📅", title: "Años", sub: "Cada casilla es un año: cuanto más oscura, más discos", accent: "mint", nav: "years" };
  const switcher = segmented([["original", "Año original"], ["edition", "Año de tu edición"]], yearMode, (mode) => {
    yearMode = mode;
    selectedYear = null;
    rerender();
  });

  const byYear = groupBy(data.rows, (r) => [r.year]);
  const years = [...byYear.keys()];
  if (!years.length) return card(head, switcher, note("Aún no se sabe el año de ningún disco."));

  const first = Math.floor(Math.min(...years) / 10) * 10;
  const last = Math.floor(Math.max(...years) / 10) * 10;
  const peak = Math.max(...[...byYear.values()].map((list) => list.length));
  const perDecade = (decade) => years.filter((y) => y >= decade && y < decade + 10).reduce((n, y) => n + byYear.get(y).length, 0);
  let topDecade = first;
  for (let decade = first; decade <= last; decade += 10) if (perDecade(decade) > perDecade(topDecade)) topDecade = decade;

  const grid = el("div", "stats-years");
  const top = el("div", "stats-years-row stats-years-head");
  top.append(el("span", "stats-years-decade"));
  for (let d = 0; d < 10; d++) top.append(el("span", "stats-years-digit", String(d)));
  top.append(el("span", "stats-years-total", "Total"));
  grid.append(top);

  for (let decade = first; decade <= last; decade += 10) {
    const row = el("div", "stats-years-row");
    row.append(el("span", "stats-years-decade", `${String(decade).slice(2)}s`));
    for (let d = 0; d < 10; d++) {
      const year = decade + d;
      const list = byYear.get(year) || [];
      const cell = el("button", `stats-cell lvl${level(list.length, peak)}`);
      cell.type = "button";
      cell.title = `${year}: ${plural(list.length, "disco", "discos")}`;
      cell.setAttribute("aria-label", cell.title);
      if (year === selectedYear) cell.classList.add("selected");
      cell.addEventListener("click", () => {
        selectedYear = selectedYear === year ? null : year;
        rerender();
      });
      row.append(cell);
    }
    const sum = perDecade(decade);
    row.append(el("span", `stats-years-total${decade === topDecade ? " top" : ""}`, sum ? String(sum) : "·"));
    grid.append(row);
  }

  let picked;
  if (selectedYear) {
    const list = byYear.get(selectedYear) || [];
    picked = list.length
      ? coverStrip(list, onOpen, `${selectedYear} · ${plural(list.length, "disco", "discos")}`)
      : note(`${selectedYear}: ningún disco.`);
  } else {
    picked = hint("Toca una casilla para ver los discos de ese año.");
  }

  // Década favorita, el más antiguo y el más nuevo.
  const sorted = data.rows.filter((r) => r.year).sort((a, b) => a.year - b.year);
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const facts = [{ icon: "⏳", label: "El más antiguo", item: oldest.item, value: String(oldest.year) }];
  if (newest !== oldest) facts.push({ icon: "🆕", label: "El más nuevo", item: newest.item, value: String(newest.year) });

  // ¿Ediciones del mismo año que el álbum o reediciones? Y cuántos años tiene de media tu música.
  const both = data.rows.filter((r) => r.original && r.edition);
  const originals = both.filter((r) => r.edition === r.original).length;
  const reissues = both.filter((r) => r.edition > r.original).length;
  const withOriginal = data.rows.filter((r) => r.original);
  const thisYear = new Date().getFullYear();
  const age = withOriginal.length ? Math.round(withOriginal.reduce((sum, r) => sum + (thisYear - r.original), 0) / withOriginal.length) : null;
  const extra = [];
  if (originals + reissues) {
    extra.push(
      el("p", "stats-sub", "🥇 ¿Edición original o reedición?"),
      splitBar([
        { label: "Del año del álbum", count: originals, className: "first" },
        { label: "Reediciones", count: reissues, className: "later" },
      ])
    );
  }
  if (age !== null) extra.push(pill(`🎂 Tu música tiene de media ${plural(age, "año", "años")}`, "mint"));

  return card(
    head,
    switcher,
    grid,
    legend(),
    picked,
    pill(`⭐ Tu década: ${decadeName(topDecade)} · ${plural(perDecade(topDecade), "disco", "discos")}`, "mint"),
    factGrid(facts, onOpen),
    ...extra
  );
}

// Lo que dice la comunidad de Discogs: cuánta gente tiene tus discos, cuánta los busca y qué nota les pone.
const RARITY_BUCKETS = [
  [1000, "Menos de mil"],
  [5000, "1 a 5 mil"],
  [20000, "5 a 20 mil"],
  [100000, "20 a 100 mil"],
  [Infinity, "Más de 100 mil"],
];

const stars = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function rarityCard(data, rerender, onOpen) {
  const head = { icon: "💎", title: "Rareza y nota", sub: "Lo que dice la comunidad de Discogs de tus discos", accent: "lilac", nav: "rare" };
  const rows = data.withData.filter((r) => r.s.have !== null && r.s.have !== undefined);
  if (!rows.length) return card(head, note("Aún no hay datos de la comunidad de Discogs."));

  // Mediana: la mitad de tus discos los tiene menos gente que esto.
  const haves = rows.map((r) => r.s.have).sort((a, b) => a - b);
  const mid = Math.floor(haves.length / 2);
  const median = Math.round(haves.length % 2 ? haves[mid] : (haves[mid - 1] + haves[mid]) / 2);
  const hot = rows.filter((r) => r.s.want > r.s.have);
  const rated = data.withData.filter((r) => r.s.rating && r.s.rating.count >= 3);
  const average = rated.length ? rated.reduce((sum, r) => sum + r.s.rating.average, 0) / rated.length : null;

  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(average === null ? "—" : stars(average), "nota media de 5", { icon: "⭐", accent: "butter" }),
    tile(median.toLocaleString("es-ES"), "lo tienen (mediana)", { icon: "👥", accent: "lilac" }),
    tile(String(hot.length), hot.length === 1 ? "más buscado que tenido" : "más buscados que tenidos", {
      icon: "🔥",
      accent: "peach",
      ...(hot.length && {
        onClick: () => {
          picks.hot = !picks.hot;
          rerender();
        },
        ariaLabel: picks.hot ? "Ocultar la lista" : "Ver cuáles son",
      }),
    })
  );
  const nodes = [tiles];
  // Los discos que busca más gente de la que los tiene, del más buscado (en proporción) al que menos.
  if (picks.hot && hot.length) {
    const n = (x) => x.toLocaleString("es-ES");
    const facts = [...hot]
      .sort((a, b) => b.s.want / b.s.have - a.s.want / a.s.have)
      .map((r) => ({
        icon: "🔥",
        label: `${(r.s.want / Math.max(1, r.s.have)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} veces más buscado que tenido`,
        item: r.item,
        value: `${n(r.s.want)} lo buscan · ${n(r.s.have)} lo tienen`,
      }));
    nodes.push(el("p", "stats-sub", "🔥 Más buscados que tenidos"), factGrid(facts, onOpen));
  } else if (hot.length) {
    nodes.push(hint("Toca 🔥 para ver cuáles son."));
  }
  if (average !== null) nodes.push(pill(`⭐ Tu colección saca un ${stars(average)} de 5`, "butter"));
  nodes.push(pill(`👥 La mitad de tus discos los tienen menos de ${median.toLocaleString("es-ES")} personas en Discogs`, "lilac"));

  // Cuántos discos hay en cada tramo de «lo tienen».
  const byBucket = new Map();
  for (const r of rows) {
    const [, name] = RARITY_BUCKETS.find(([limit]) => r.s.have < limit);
    byBucket.set(name, [...(byBucket.get(name) || []), r.item]);
  }
  const entries = RARITY_BUCKETS.map(([, name]) => [name, (byBucket.get(name) || []).length]).filter(([, n]) => n);
  nodes.push(
    el("p", "stats-sub", "¿Cuánta gente los tiene?"),
    rankList(entries, rows.length, {
      max: RARITY_BUCKETS.length,
      byKey: byBucket,
      selected: picks.rarity,
      onSelect: (key) => {
        picks.rarity = key;
        rerender();
      },
      onOpen,
    })
  );
  if (!picks.rarity) nodes.push(hint("Toca un tramo para ver sus discos."));

  // Récords de la comunidad.
  const facts = [];
  const rarest = [...rows].sort((a, b) => a.s.have - b.s.have)[0];
  facts.push({ icon: "💎", label: "El más raro", item: rarest.item, value: `lo tienen ${rarest.s.have.toLocaleString("es-ES")}` });
  const wanted = [...rows].sort((a, b) => b.s.want - a.s.want)[0];
  facts.push({ icon: "🔥", label: "El más deseado", item: wanted.item, value: `lo buscan ${wanted.s.want.toLocaleString("es-ES")}` });
  if (hot.length) {
    const top = [...hot].sort((a, b) => b.s.want / b.s.have - a.s.want / a.s.have)[0];
    const times = (top.s.want / top.s.have).toLocaleString("es-ES", { maximumFractionDigits: 1 });
    facts.push({ icon: "📈", label: "Puede subir de precio", item: top.item, value: `lo buscan ${times} veces más de los que lo tienen` });
  }
  if (rated.length) {
    const best = [...rated].sort((a, b) => b.s.rating.average - a.s.rating.average)[0];
    const value = best.s.rating.average.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    facts.push({ icon: "⭐", label: "Mejor valorado", item: best.item, value: `${value} de 5` });
  }
  nodes.push(factGrid(facts, onOpen));
  return card(head, ...nodes);
}

// Artistas y sellos que más se repiten, con un selector para cambiar de uno a otro.
function peopleCard(artists, labels, byArtist, byLabel, rerender, onOpen, onArtist) {
  const switcher = segmented([["artists", "🎤 Artistas"], ["labels", "🏷️ Sellos"]], peopleMode, (mode) => {
    peopleMode = mode;
    rerender();
  });
  const isArtists = peopleMode === "artists";
  const entries = isArtists ? artists : labels;
  const repeated = entries.filter(([, n]) => n > 1);
  const singles = entries.length - repeated.length;
  const nodes = [switcher];
  if (!entries.length) {
    nodes.push(note("Aún no se sabe el sello de tus discos."));
  } else if (!repeated.length) {
    const distinct = isArtists ? plural(entries.length, "artista distinto", "artistas distintos") : plural(entries.length, "sello distinto", "sellos distintos");
    nodes.push(pill(`🎉 ${distinct}: ninguno se repite todavía`, "peach"));
  } else {
    nodes.push(
      rankList(repeated, 0, {
        max: 6,
        byKey: isArtists ? byArtist : byLabel,
        selected: picks[peopleMode],
        onSelect: (key) => {
          picks[peopleMode] = key;
          rerender();
        },
        onOpen,
        more: isArtists ? "artistas más" : "sellos más",
      })
    );
    if (!picks[peopleMode]) nodes.push(hint(`Toca un ${isArtists ? "artista" : "sello"} para ver sus discos.`));
    if (isArtists && picks.artists && onArtist) {
      const pick = picks.artists;
      const go = el("button", "secondary stats-artist-go", `🎤 Ver la ficha de ${pick}`);
      go.type = "button";
      go.addEventListener("click", () => onArtist(pick));
      nodes.push(go);
    }
    if (singles) {
      nodes.push(note(isArtists ? `Y ${plural(singles, "artista", "artistas")} con un solo disco.` : `Y ${plural(singles, "sello", "sellos")} con un solo disco.`));
    }
  }
  return card({ icon: "🎤", title: "Artistas y sellos", sub: "Los que más se repiten en tu colección", accent: "peach", nav: "people" }, ...nodes);
}

// Rachas de siempre (no solo de los últimos 6 meses): semanas seguidas añadiendo discos, día de la semana
// favorito, y el mes y el día con más discos.
const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
// Número de semana (de lunes a domingo) de una fecha, contando desde 1970.
const weekOf = (d) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 3) / 7);

function streakPills(items) {
  const dates = items.map((i) => new Date(i.date || "")).filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length < 2) return [];
  const months = new Map();
  const days = new Map();
  const weekdays = new Array(7).fill(0);
  const weeks = new Set();
  for (const d of dates) {
    const month = new Date(d.getFullYear(), d.getMonth(), 1);
    months.set(month.getTime(), (months.get(month.getTime()) || 0) + 1);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    days.set(day.getTime(), (days.get(day.getTime()) || 0) + 1);
    weekdays[(d.getDay() + 6) % 7] += 1;
    weeks.add(weekOf(d));
  }
  const pills = [];

  // Semanas seguidas: la racha más larga y la de ahora (sigue viva si añadiste algo esta semana o la pasada).
  const sorted = [...weeks].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const now = weekOf(new Date());
  let current = 0;
  for (let w = weeks.has(now) ? now : now - 1; weeks.has(w); w--) current += 1;
  if (current >= 2) {
    pills.push(pill(`🔥 Llevas ${current} semanas seguidas añadiendo discos${current >= longest ? ": ¡tu récord!" : ` (tu récord: ${longest})`}`, "lilac"));
  } else if (longest >= 2) {
    pills.push(pill(`🔥 Tu racha más larga: ${longest} semanas seguidas añadiendo discos`, "lilac"));
  }

  // Día de la semana favorito, si destaca.
  const order = weekdays.map((n, i) => [i, n]).sort((a, b) => b[1] - a[1]);
  if (order[0][1] >= 3 && order[0][1] > order[1][1]) {
    pills.push(pill(`📆 Tu día favorito para añadir discos: el ${WEEKDAYS[order[0][0]]} (${order[0][1]} de ${dates.length})`, "lilac"));
  }

  const [bestMonth, monthCount] = [...months.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (monthCount > 1) {
    const name = new Date(bestMonth).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    pills.push(pill(`📈 Tu mes récord: ${name} · ${plural(monthCount, "disco", "discos")}`, "lilac"));
  }
  const [bestDay, dayCount] = [...days.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (dayCount >= 3) {
    const name = new Date(bestDay).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
    pills.push(pill(`🚀 Tu día récord: el ${name} añadiste ${plural(dayCount, "disco", "discos")}`, "lilac"));
  }
  return pills;
}

// Calendario de cuándo se añadió cada disco (las últimas 26 semanas), como el de GitHub.
function calendarCard(items) {
  const WEEKS = 26;
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayIndex = (today.getDay() + 6) % 7; // lunes = 0
  const start = new Date(today.getTime() - (dayIndex + (WEEKS - 1) * 7) * DAY);
  const counts = new Map();
  for (const item of items) {
    if (!item.date) continue;
    const d = new Date(item.date);
    d.setHours(0, 0, 0, 0);
    if (d < start || d > today) continue;
    const key = d.toDateString();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const peak = Math.max(1, ...counts.values());

  // Nombre del mes encima de la semana en la que empieza.
  const head = el("div", "stats-calendar-months");
  head.style.setProperty("--weeks", WEEKS);
  let previous = null;
  for (let w = 0; w < WEEKS; w++) {
    const monday = new Date(start.getTime() + w * 7 * DAY);
    const month = monday.getMonth();
    if (month !== previous && (w > 0 || monday.getDate() <= 7)) {
      const label = el("span", null, monday.toLocaleDateString("es-ES", { month: "short" }).replace(".", ""));
      label.style.gridColumn = String(w + 1);
      head.append(label);
    }
    previous = month;
  }

  const grid = el("div", "stats-calendar");
  grid.style.setProperty("--weeks", WEEKS);
  let total = 0;
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(start.getTime() + i * DAY);
    const cell = el("span", "stats-cell");
    if (d > today) {
      cell.classList.add("future");
    } else {
      const n = counts.get(d.toDateString()) || 0;
      total += n;
      cell.classList.add(`lvl${level(n, peak)}`);
      cell.title = `${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}: ${plural(n, "disco", "discos")}`;
    }
    grid.append(cell);
  }
  const days = el("div", "stats-calendar-days");
  for (const day of ["L", "", "X", "", "V", "", ""]) days.append(el("span", null, day));
  const wrap = el("div", "stats-calendar-wrap");
  wrap.append(el("span"), head, days, grid);

  const nodes = [
    el("p", "stats-big", total.toLocaleString("es-ES")),
    el("p", "stats-big-note", total === 1 ? "disco añadido en los últimos 6 meses" : "discos añadidos en los últimos 6 meses"),
    wrap,
    legend(),
  ];
  const streaks = streakPills(items);
  if (streaks.length) nodes.push(el("p", "stats-sub", "🔥 Tus rachas"), ...streaks);
  return card({ icon: "🗓️", title: "Cuándo los añadiste", sub: "Cada casilla es un día", accent: "lilac", nav: "added" }, ...nodes);
}

function curiositiesCard(data, items, styles, onOpen) {
  const facts = [];
  // El más ecléctico: el que mezcla más géneros y estilos (con al menos dos géneros o tres etiquetas).
  const mixes = data.withData
    .map((r) => ({ r, genres: r.s.genres.length, styles: r.s.styles.length }))
    .filter((m) => m.genres >= 2 || m.genres + m.styles >= 3)
    .sort((a, b) => b.genres + b.styles - (a.genres + a.styles) || b.genres - a.genres);
  if (mixes.length) {
    const { r, genres, styles: count } = mixes[0];
    const tags = [...r.s.genres, ...r.s.styles].slice(0, 4).join(", ");
    facts.push({
      icon: "🎨",
      label: "El más ecléctico",
      item: r.item,
      value: `${plural(genres, "género", "géneros")} y ${plural(count, "estilo", "estilos")}`,
      detail: tags,
    });
  }
  // La reedición más lejana del original.
  const gaps = data.rows.filter((r) => r.original && r.edition && r.edition > r.original);
  if (gaps.length) {
    const far = [...gaps].sort((a, b) => b.edition - b.original - (a.edition - a.original))[0];
    facts.push({ icon: "🔁", label: "Reedición tardía", item: far.item, value: `${far.edition - far.original} años después` });
  }

  const colored = items.filter((i) => i.color).length;
  const heavy = data.rows.filter((r) => isHeavy(r.item.weight || r.s.weight)).length;
  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(String(colored), "de color", { icon: "🎨", accent: "pink" }),
    tile(String(heavy), "de 180 g o más", { icon: "🏋️", accent: "sky" }),
    tile(String(styles.length), styles.length === 1 ? "estilo distinto" : "estilos distintos", { icon: "🎼", accent: "mint" })
  );
  return card(
    { icon: "✨", title: "Curiosidades", sub: "Otros récords de tu colección", accent: "butter", nav: "fun" },
    tiles,
    facts.length ? factGrid(facts, onOpen) : null
  );
}

// ---------- 🎵 Canciones récord ----------

// "3:45"; "1:02:10".
function clock(total) {
  const s = Math.round(total);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// «40 días», «8 meses», «3,4 años».
function daysText(days) {
  if (days < 60) return plural(days, "día", "días");
  if (days < 730) return plural(Math.round(days / 30.4), "mes", "meses");
  return `${(days / 365).toLocaleString("es-ES", { maximumFractionDigits: 1 })} años`;
}

// Lo que dura la canción más larga, comparado con algo conocido. null si es una canción normal.
function longSongPill(seconds) {
  const minutes = seconds / 60;
  if (minutes >= 45) return "⚽ La más larga dura más que la primera parte de un partido de fútbol";
  if (minutes >= 40) return "⚽ La más larga dura casi lo que la primera parte de un partido de fútbol";
  if (minutes >= 30) return "📺 La más larga dura más que un capítulo de Friends";
  if (minutes >= 20) return "📺 La más larga dura lo que un capítulo de Friends";
  const songs = Math.round(minutes / 3.5);
  return songs >= 2 ? `📻 La más larga dura lo que ${songs} canciones normales de la radio` : null;
}

function songsCard(data, onOpen) {
  const head = { icon: "🎵", title: "Canciones récord", sub: "Cuántas tienes, y las más largas y cortas", accent: "peach", nav: "songs" };
  const rows = data.withData.filter((r) => r.s.tracks);
  if (!rows.length) return card(head, note("Aún no se sabe: falta la lista de canciones de tus discos."));
  const total = rows.reduce((sum, r) => sum + r.s.tracks, 0);
  const nodes = [
    el("p", "stats-big", total.toLocaleString("es-ES")),
    el("p", "stats-big-note", total === 1 ? "canción en tus discos" : "canciones en tus discos"),
    pill(`📅 Escuchando una al día, tardarías ${daysText(total)} en oírlas todas`, "peach"),
  ];
  const facts = [];
  const timed = rows.filter((r) => r.s.longest);
  const longest = timed.length ? timed.reduce((a, b) => (b.s.longest.s > a.s.longest.s ? b : a)) : null;
  if (longest) {
    facts.push({ icon: "🐢", label: "La canción más larga", item: longest.item, value: `«${longest.s.longest.t}» · ${clock(longest.s.longest.s)}` });
  }
  const short = rows.filter((r) => r.s.shortest);
  const shortest = short.length ? short.reduce((a, b) => (b.s.shortest.s < a.s.shortest.s ? b : a)) : null;
  if (shortest) {
    facts.push({ icon: "🐇", label: "La canción más corta", item: shortest.item, value: `«${shortest.s.shortest.t}» · ${clock(shortest.s.shortest.s)}` });
  }
  const most = rows.reduce((a, b) => (b.s.tracks > a.s.tracks ? b : a));
  facts.push({ icon: "📚", label: "El disco con más canciones", item: most.item, value: plural(most.s.tracks, "canción", "canciones") });
  const fewest = rows.reduce((a, b) => (b.s.tracks < a.s.tracks ? b : a));
  if (fewest.s.tracks < most.s.tracks) {
    facts.push({ icon: "🎯", label: "El disco con menos canciones", item: fewest.item, value: plural(fewest.s.tracks, "canción", "canciones") });
  }
  nodes.push(factGrid(facts, onOpen));
  const compare = longest && longSongPill(longest.s.longest.s);
  if (compare) nodes.push(pill(compare, "peach"));
  if (rows.length < data.rows.length) nodes.push(note(`Sin contar ${plural(data.rows.length - rows.length, "disco", "discos")} sin lista de canciones todavía.`));
  return card(head, ...nodes);
}

// ---------- 🪡 La aguja ----------

// Radio medio de la zona grabada de un vinilo, en metros, según su tamaño en pulgadas.
const GROOVE_RADIUS = { 7: 0.069, 10: 0.09, 12: 0.103 };
// Lo que suele durar la punta de una aguja, en horas (depende mucho de cuál sea y de cómo se cuide).
const STYLUS_HOURS = 1000;
const DISTANCES = [
  [0.105, "un campo de fútbol", "⚽"],
  [0.33, "la altura de la torre Eiffel", "🗼"],
  [5, "una carrera de 5 km", "🏃"],
  [21.1, "una media maratón", "🏃"],
  [42.2, "una maratón", "🏅"],
  [620, "el camino de Madrid a Barcelona en coche", "🚗"],
  [1000, "España de norte a sur", "🗺️"],
];

// Caras de un disco: las de sus canciones (A, B, C…) o, si no lo dicen, dos por vinilo.
const sidesOfRow = (r) => r.s.sides || (r.s.vinyls || Number(r.item.discs) || 1) * 2;
const bigNumber = (n) => (n >= 10000 ? `${Math.round(n / 1000).toLocaleString("es-ES")} mil` : Math.round(n).toLocaleString("es-ES"));
const oneDecimal = (n) => n.toLocaleString("es-ES", { maximumFractionDigits: n < 10 ? 1 : 0 });

function needleCard(data) {
  const head = { icon: "🪡", title: "La aguja", sub: "Caras, vueltas y kilómetros de surco de tu colección", accent: "sky", nav: "needle" };
  const sides = data.rows.reduce((sum, r) => sum + sidesOfRow(r), 0);
  let turns = 0;
  let meters = 0;
  let seconds = 0;
  for (const r of data.withData) {
    const len = recordLength(r.s);
    if (!len) continue;
    const rpm = (r.s.tags || []).includes("rpm45") ? 45 : 100 / 3;
    const minutes = len.seconds / 60;
    turns += minutes * rpm;
    meters += minutes * rpm * 2 * Math.PI * (GROOVE_RADIUS[r.s.inches] || GROOVE_RADIUS[12]);
    seconds += len.seconds;
  }
  const nodes = [
    el("p", "stats-big", sides.toLocaleString("es-ES")),
    el("p", "stats-big-note", sides === 1 ? "cara de vinilo" : "caras de vinilo"),
    pill(`🧍 Para oírlo todo te levantarías ${plural(sides, "vez", "veces")} a poner un disco o darle la vuelta`, "sky"),
  ];
  if (seconds) {
    const km = meters / 1000;
    const plays = (STYLUS_HOURS * 3600) / seconds;
    const playsText = oneDecimal(plays);
    const tiles = el("div", "stats-tiles");
    tiles.append(
      tile(bigNumber(turns), "vueltas del plato", { icon: "🔄", accent: "sky" }),
      tile(km < 1 ? `${Math.round(meters)} m` : `${oneDecimal(km)} km`, "de surco", { icon: "〰️", accent: "sky" }),
      tile(playsText, "escuchas por aguja", { icon: "🪡", accent: "sky" })
    );
    // «🏅 2,3 veces una maratón» → «🏅 La aguja recorre 2,3 veces una maratón».
    const [emoji, ...words] = compareTo(DISTANCES, km, "Casi").split(" ");
    const text = words.join(" ");
    const hours = STYLUS_HOURS.toLocaleString("es-ES");
    nodes.push(
      tiles,
      pill(`${emoji} La aguja recorre ${text.charAt(0).toLowerCase()}${text.slice(1)}`, "sky"),
      pill(
        plays >= 1
          ? `🪡 Una aguja dura unas ${hours} horas: te da para escuchar tu colección entera ${playsText} ${playsText === "1" ? "vez" : "veces"}`
          : `🪡 Una aguja dura unas ${hours} horas: para oír tu colección entera necesitarías ${Math.ceil(1 / plays)} agujas`,
        "sky"
      )
    );
  }
  nodes.push(
    note(
      "Aproximado: a 33⅓ vueltas por minuto (45 si Discogs lo dice), con el radio medio de los surcos y solo con los discos que " +
        "tienen lista de canciones. Las caras salen de las canciones (A, B, C…) o, si no, de cuántos vinilos trae cada disco. " +
        "Lo que dura una aguja depende de cuál sea y de cómo se cuide."
    )
  );
  return card(head, ...nodes);
}

// ---------- 🎛️ Ediciones especiales ----------

// Lo especial de un disco: lo que dice su formato y si trae dos vinilos o más.
const tagsOfRow = (r) => [...(r.s.tags || []), ...((r.s.vinyls || Number(r.item.discs) || 1) >= 2 ? ["double"] : [])];

function specialCard(data, rerender, onOpen) {
  const head = { icon: "🎛️", title: "Ediciones especiales", sub: "Lo que dice Discogs del formato de tus discos", accent: "pink", nav: "special" };
  const rows = data.withData;
  if (!rows.length) return card(head, note("Aún no hay datos de Discogs de tus discos."));
  const byTag = new Map();
  for (const r of rows) for (const tag of tagsOfRow(r)) byTag.set(tag, [...(byTag.get(tag) || []), r.item]);
  const tags = FORMAT_TAGS.filter(([key]) => byTag.has(key)).sort((a, b) => byTag.get(b[0]).length - byTag.get(a[0]).length);
  if (picks.special && !byTag.has(picks.special)) picks.special = null;
  const special = rows.filter((r) => tagsOfRow(r).some((t) => SPECIAL_TAGS.has(t)));
  const of = `de tus ${rows.length.toLocaleString("es-ES")} discos`;
  const nodes = [
    special.length
      ? pill(special.length === 1 ? `✨ 1 ${of} es una edición especial` : `✨ ${special.length.toLocaleString("es-ES")} ${of} son ediciones especiales`, "pink")
      : pill("Ninguno es una edición especial: ni limitada, ni numerada, ni picture disc.", "pink"),
  ];
  if (tags.length) {
    const chips = el("div", "stats-chips");
    for (const [key, label] of tags) {
      const chip = el("button", `stats-chip stats-chip--link stats-chip--accent${picks.special === key ? " active" : ""}`, label);
      chip.type = "button";
      chip.setAttribute("aria-expanded", String(picks.special === key));
      chip.append(el("b", null, String(byTag.get(key).length)));
      chip.addEventListener("click", () => {
        picks.special = picks.special === key ? null : key;
        rerender();
      });
      chips.append(chip);
    }
    nodes.push(chips);
    if (picks.special) {
      const [, label] = FORMAT_TAGS.find(([key]) => key === picks.special);
      const list = byTag.get(picks.special);
      nodes.push(coverStrip(list, onOpen, `${label} · ${plural(list.length, "disco", "discos")}`));
    } else {
      nodes.push(hint("Toca una para ver sus discos."));
    }
  } else {
    nodes.push(note("Discogs no dice nada especial del formato de tus discos."));
  }
  // El que junta más cosas especiales (al menos dos).
  const best = special
    .map((r) => ({ r, all: tagsOfRow(r), n: tagsOfRow(r).filter((t) => SPECIAL_TAGS.has(t)).length }))
    .sort((a, b) => b.n - a.n || b.all.length - a.all.length)[0];
  if (best && best.n >= 2) {
    const names = FORMAT_TAGS.filter(([key]) => best.all.includes(key)).map(([, , short]) => short);
    nodes.push(factGrid([{ icon: "🏅", label: "El más especial", item: best.r.item, value: names.join(", ") }], onOpen));
  }
  nodes.push(
    note(
      "«Con carpeta» (gatefold): la funda se abre como un libro. «Picture disc»: el dibujo va impreso en el propio vinilo. " +
        "«Promo»: copias para radios y prensa, que no se vendían."
    )
  );
  return card(head, ...nodes);
}

// ---------- 🧩 Discografías ----------

// «A», «A y B», «A, B y C», «A, B, C y 2 más».
function listNames(names) {
  if (names.length <= 1) return names.join("");
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} y ${names.length - 3} más`;
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function discographyCard(items, token, rerender, onOpenAlbum, onArtist) {
  const head = { icon: "🧩", title: "Discografías", sub: "Cuántos LP de estudio de tus artistas tienes", accent: "mint", nav: "discog" };
  const names = discographyArtists(items);
  if (!names.length) return card(head, note("Aún no hay artistas con ficha en tu colección."));
  const rows = [];
  for (const name of names) {
    const entry = discographyOf(name);
    const progress = entry && discographyProgress(entry, name, items);
    if (progress) rows.push({ name, ...progress, pct: progress.have / progress.total });
  }
  const pending = names.filter((name) => !discTried.has(name) && !discographyOf(name)).length;
  const waiting = token ? "⏳ Buscando las discografías de tus artistas…" : "Añade tu token de Discogs en Ajustes para ver las discografías.";
  if (!rows.length) return card(head, pill(pending || !token ? waiting : "No encuentro las discografías de tus artistas.", "mint"));

  rows.sort((a, b) => b.pct - a.pct || b.have - a.have || a.total - b.total);
  if (picks.discog && !rows.some((r) => r.name === picks.discog)) picks.discog = null;
  const nodes = [];
  const complete = rows.filter((r) => !r.missing.length && !r.more);
  // La que está a punto de completarse (le faltan como mucho 3 LP).
  const close = rows
    .filter((r) => r.have && r.missing.length && r.missing.length <= 3)
    .sort((a, b) => a.missing.length - b.missing.length || b.pct - a.pct)[0];
  if (complete.length) {
    nodes.push(pill(`🏆 Tienes todos los LP de ${listNames(complete.map((r) => r.name))}`, "mint"));
  } else if (rows[0].have && (!close || close.name !== rows[0].name)) {
    nodes.push(pill(`🏆 Tu discografía más completa: ${rows[0].name} · ${rows[0].have} de ${rows[0].total} LP`, "mint"));
  }
  if (close) {
    const left = close.missing.length === 1 ? "Te falta solo 1 LP" : `Te faltan solo ${close.missing.length} LP`;
    nodes.push(pill(`🎯 ${left} de ${close.name} para tenerlos todos`, "mint"));
  }

  const list = el("div", "stats-bars");
  for (const r of rows) {
    const open = picks.discog === r.name;
    const row = el("button", `stats-bar${open ? " active" : ""}`);
    row.type = "button";
    row.setAttribute("aria-expanded", String(open));
    const track = el("span", "stats-bar-track");
    const fill = el("span", "stats-bar-fill");
    fill.style.width = `${Math.max(4, r.pct * 100)}%`;
    track.append(fill);
    const count = el("span", "stats-bar-count");
    count.append(el("b", null, String(r.have)), ` de ${r.total}${r.more ? "+" : ""}`);
    row.append(el("span", "stats-bar-name", `${!r.missing.length && !r.more ? "✅ " : ""}${r.name}`), track, count);
    row.addEventListener("click", () => {
      picks.discog = open ? null : r.name;
      rerender();
    });
    list.append(row);
    if (!open) continue;
    let box;
    if (r.missing.length) {
      const label = `${r.missing.length === 1 ? "Te falta" : "Te faltan"} ${plural(r.missing.length, "LP", "LP")} · toca uno para abrirlo`;
      box = coverStrip(r.missing, (album) => onOpenAlbum && onOpenAlbum(album, r.name), label);
    } else {
      box = el("div", "stats-pick");
      box.append(el("p", "stats-pick-label", "🎉 Tienes todos sus LP de estudio"));
    }
    if (onArtist) {
      const go = el("button", "secondary stats-artist-go", `🎤 Ver la ficha de ${r.name}`);
      go.type = "button";
      go.addEventListener("click", () => onArtist(r.name));
      box.append(go);
    }
    list.append(box);
  }
  nodes.push(list);
  if (!picks.discog) nodes.push(hint("Toca un artista para ver los LP que te faltan."));
  if (pending && token) nodes.push(note(`🔄 Buscando la discografía de ${plural(pending, "artista más", "artistas más")}…`));
  nodes.push(
    note(
      "Solo cuentan los LP de estudio (ni directos ni recopilatorios), según MusicBrainz o, si no conoce al artista, Discogs. " +
        "Se miran tus artistas con más discos."
    )
  );
  return card(head, ...nodes);
}

// ---------- ⭐ Lo que busco ----------

const WANT_SHOWN = 8;

function wantCard(token, rerender, onOpenAlbum, onWantlist) {
  const head = { icon: "⭐", title: "Lo que busco", sub: "Lo que costaría conseguir los discos de tu lista", accent: "butter", nav: "want" };
  const list = getWantlist();
  if (!list.length) {
    return card(head, note("Aún no buscas ningún disco. Apúntalos con ☆ en la discografía de un artista o en la ficha de un disco que no tienes."));
  }
  const rows = list.map((w) => {
    const cheapest = cheapestOf(w);
    const state = cheapest ? (cheapest.best ? "priced" : "unsold") : !w.masterId && w.masterChecked ? "missing" : "pending";
    return { w, cheapest, state };
  });
  const priced = rows.filter((r) => r.state === "priced").sort((a, b) => a.cheapest.best.value - b.cheapest.best.value);
  const totals = new Map();
  for (const r of priced) {
    const currency = r.cheapest.best.currency || "EUR";
    totals.set(currency, (totals.get(currency) || 0) + Number(r.cheapest.best.value));
  }
  const nodes = [];
  if (priced.length) {
    const what = priced.length === list.length
      ? `para conseguir ${list.length === 1 ? "el disco" : `los ${list.length} discos`} de tu lista`
      : `para conseguir ${plural(priced.length, "disco", "discos")} de los ${list.length} de tu lista`;
    nodes.push(el("p", "stats-big", [...totals.entries()].map(([cur, v]) => money(v, cur)).join(" + ")), el("p", "stats-big-note", what));
  } else {
    nodes.push(el("p", "stats-big", "—"), el("p", "stats-big-note", plural(list.length, "disco en tu lista", "discos en tu lista")));
  }

  // Del más barato al más caro; luego los que aún se buscan, los que nadie vende y los que no salen en Discogs.
  const order = [...priced, ...["pending", "unsold", "missing"].flatMap((state) => rows.filter((r) => r.state === state))];
  const facts = (picks.wantAll ? order : order.slice(0, WANT_SHOWN)).map(({ w, cheapest, state }) => {
    if (state === "priced") {
      const b = cheapest.best;
      const edition = [b.country ? `${countryFlag(b.country)} ${b.country}`.trim() : "", b.year].filter(Boolean).join(" · ");
      return { icon: "🛒", label: "Desde", item: w, value: money(b.value, b.currency || "EUR"), detail: edition ? `Edición: ${edition}` : "" };
    }
    if (state === "unsold") return { icon: "🚫", label: "Nadie lo vende ahora", item: w, value: "—" };
    if (state === "missing") return { icon: "❓", label: "No lo encuentro en Discogs", item: w, value: "—" };
    return token ? { icon: "⏳", label: "Buscando su precio…", item: w, value: "…" } : { icon: "💶", label: "Sin precio", item: w, value: "—" };
  });
  nodes.push(factGrid(facts, (w) => onOpenAlbum && onOpenAlbum({ ...w }, w.artist)));
  if (order.length > WANT_SHOWN) {
    const more = el("button", "ghost stats-artist-all", picks.wantAll ? "Ver menos" : `Ver los ${order.length}`);
    more.type = "button";
    more.addEventListener("click", () => {
      picks.wantAll = !picks.wantAll;
      rerender();
    });
    nodes.push(more);
  }
  if (!token) nodes.push(note("Añade tu token de Discogs en Ajustes para ver los precios."));
  nodes.push(note("Precio del vinilo más barato a la venta ahora entre sus ediciones más comunes, sin gastos de envío. Toca uno para abrir su ficha."));
  if (onWantlist) {
    const all = el("button", "ghost stats-artist-all", "⭐ Ver tu lista ›");
    all.type = "button";
    all.addEventListener("click", onWantlist);
    nodes.push(all);
  }
  return card(head, ...nodes);
}

// Pinta la pestaña «Datos». onOpen(item) abre la ficha de un disco.
// onOpenAlbum(album, artista) abre un álbum que no tienes (de lo que buscas o de una discografía);
// onWantlist abre la lista de lo que buscas.
export function renderStats(container, items, { discogsToken, onOpen, statusEl, onArtists, onArtist, onOpenAlbum, onWantlist }) {
  setStatsActive(true);
  const draw = () => {
    const data = compute(items, yearMode);
    const artists = countBy(items.map((i) => cleanName(i.artist)));
    const labels = countBy(data.withData.map((r) => r.s.label));
    const countries = countBy(data.withData.map((r) => r.s.country));
    const genres = countBy(data.withData.flatMap((r) => r.s.genres));
    const styles = countBy(data.withData.flatMap((r) => r.s.styles));
    const lengths = data.withData
      .map((r) => ({ item: r.item, s: r.s, len: recordLength(r.s) }))
      .filter((r) => r.len)
      .map((r) => ({ item: r.item, seconds: r.len.seconds, estimated: r.len.estimated, tracks: r.s.tracks }));

    const nodes = [summaryTiles(items, artists, countries, lengths, onArtists), valueCard(data, items, onOpen, draw)];

    // 🎸 Géneros como un vinilo, y los estilos debajo.
    if (genres.length) {
      const byGenre = groupBy(data.withData, (r) => r.s.genres);
      const genreCard = genreVinylCard(genres, byGenre, data.withData.length, draw, onOpen);
      if (styles.length) {
        genreCard.append(el("p", "stats-sub", "Estilos más repetidos"));
        // Tocar un estilo enseña sus discos debajo; tocarlo otra vez los oculta.
        const byStyle = groupBy(data.withData, (r) => r.s.styles);
        const chips = el("div", "stats-chips");
        for (const [name, count] of styles.slice(0, 12)) {
          const chip = el("button", `stats-chip stats-chip--link${picks.style === name ? " active" : ""}`, name);
          chip.type = "button";
          chip.setAttribute("aria-expanded", String(picks.style === name));
          chip.append(el("b", null, String(count)));
          chip.addEventListener("click", () => {
            picks.style = picks.style === name ? null : name;
            draw();
          });
          chips.append(chip);
        }
        genreCard.append(chips);
        if (picks.style && byStyle.has(picks.style)) genreCard.append(coverStrip(byStyle.get(picks.style), onOpen, picks.style));
        else genreCard.append(hint("Toca un estilo para ver sus discos."));
      }
      const pending = items.length - data.withData.length;
      if (pending) genreCard.append(note(`Faltan datos de ${plural(pending, "disco", "discos")}.`));
      nodes.push(genreCard);
      // Qué géneros y qué estilos hay en cada década (por el año del álbum).
      const byDecade = (key) =>
        data.withData.filter((r) => r.original && r.s[key].length).map((r) => ({ item: r.item, year: r.original, tags: r.s[key] }));
      nodes.push(decadeTagCard(byDecade("genres"), genres, draw, onOpen, "genres"));
      if (styles.length) nodes.push(decadeTagCard(byDecade("styles"), styles, draw, onOpen, "styles"));
    }

    // ⏱️ Duración, 🎵 canciones récord y 🪡 la aguja.
    nodes.push(durationCard(lengths, items.length, onOpen));
    nodes.push(songsCard(data, onOpen));
    nodes.push(needleCard(data));

    // 📦 La pila: del más antiguo en tu colección (abajo) al último que añadiste (arriba).
    const pile = [...items]
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .map((item) => {
        const entry = cache[String(item.release_id)] || {};
        const grams = Number.parseInt(item.weight || entry.weight, 10);
        return { item, grams: grams >= 80 && grams <= 300 ? grams : null, color: entry.cc ? entry.cc.hex : null };
      });
    nodes.push(stackCard(pile));

    // 🎛️ Ediciones especiales.
    nodes.push(specialCard(data, draw, onOpen));

    // 📅 Años y 🕰️ línea del tiempo.
    nodes.push(yearsCard(data, draw, onOpen));
    nodes.push(timelineCard(data.rows, yearMode, onOpen));

    // 🌈 Portadas por colores y vinilos de color.
    const colorEntries = items.map((item) => {
      const entry = cache[String(item.release_id)];
      return { item, color: entry && entry.cc ? entry.cc : null };
    });
    const pendingColors = items.filter(needsColor).length;
    nodes.push(rainbowCard(colorEntries, items.filter((i) => i.color), onOpen, pendingColors));

    // 🌍 Mapa.
    if (countries.length) {
      const codeCounts = new Map();
      const names = new Map();
      const extras = new Map();
      for (const r of data.withData) {
        const codes = countryCodes(r.s.country).filter((c) => c !== "EU");
        for (const code of codes) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
        if (!codes.length && r.s.country) extras.set(r.s.country, (extras.get(r.s.country) || 0) + 1);
      }
      for (const [country] of countries) {
        for (const part of country.split(/\s*&\s*/)) {
          const [code] = countryCodes(part);
          if (code && !names.has(code)) names.set(code, `${countryFlag(part)} ${part}`);
        }
      }
      const countryList = rankList(countries, data.withData.length, {
        max: 6,
        format: (c) => `${countryFlag(c)} ${c}`.trim(),
        byKey: groupBy(data.withData, (r) => [r.s.country]),
        selected: picks.country,
        onSelect: (key) => {
          picks.country = key;
          draw();
        },
        onOpen,
        more: "países más",
      });
      const countryBox = el("div");
      countryBox.append(countryList);
      if (!picks.country) countryBox.append(hint("Toca un país para ver sus discos."));
      nodes.push(mapCard(codeCounts, names, [...extras.entries()].map(([c, n]) => [`${countryFlag(c)} ${c}`.trim(), n]), countryBox, draw));
    }

    // 💎 Rareza y nota.
    if (data.withData.length) nodes.push(rarityCard(data, draw, onOpen));

    // 🎤 Artistas y sellos.
    if (artists.length) {
      const byArtist = groupBy(data.rows, (r) => [cleanName(r.item.artist)]);
      const byLabel = groupBy(data.withData, (r) => [r.s.label]);
      nodes.push(peopleCard(artists, labels, byArtist, byLabel, draw, onOpen, onArtist));
      if (onArtists) {
        const all = el("button", "ghost stats-artist-all", `Ver tus ${plural(artists.length, "artista", "artistas")} ›`);
        all.type = "button";
        all.addEventListener("click", onArtists);
        nodes[nodes.length - 1].append(all);
      }
    }

    // 🧩 Discografías de tus artistas y ⭐ lo que buscas.
    nodes.push(discographyCard(items, discogsToken, draw, onOpenAlbum, onArtist));
    nodes.push(wantCard(discogsToken, draw, onOpenAlbum, onWantlist));

    nodes.push(curiositiesCard(data, items, styles, onOpen));
    nodes.push(calendarCard(items));

    const sections = NAV.filter(([key]) => nodes.some((node) => node.dataset.nav === key));
    container.replaceChildren(navBar(sections, container), ...nodes);
  };
  draw();
  startFill(
    items,
    discogsToken,
    () => {
      if (active && container.isConnected && !container.closest("[hidden]")) draw();
    },
    (text) => {
      if (statusEl) statusEl.textContent = text;
    }
  );
}
