import { CONFIG } from "./config.js";
import { trackKey } from "./musicbrainz.js";

const MIN_GAP_MS = 1100; // Discogs permite unas 60 peticiones por minuto con token
let lastRequestAt = 0;
let queue = Promise.resolve();

function interpretStatus(status) {
  if (status === 401 || status === 403) {
    return "El token de Discogs no es válido. Revisa que lo copiaste bien.";
  }
  if (status === 429) {
    return "Se ha alcanzado el límite de peticiones de Discogs por ahora. Espera un minuto.";
  }
  return `Discogs respondió con un error inesperado (código ${status}).`;
}

// Pausas antes de reintentar cuando la petición ni llega a Discogs (corte de red o Discogs saturado:
// si se pasa del límite, a veces responde sin el permiso del navegador y parece un fallo de conexión).
const RETRY_WAITS_MS = [3000, 8000];

async function discogsGet(path, params, discogsToken, attempt = 0) {
  // Turno en la cola: si hay varias consultas a la vez, salen de una en una con su pausa.
  const turn = queue.then(() => {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : null;
  });
  queue = turn.then(() => {
    lastRequestAt = Date.now();
  });
  await queue;

  const query = params ? `?${new URLSearchParams(params)}` : "";
  let response;
  try {
    response = await fetch(`${CONFIG.DISCOGS.baseUrl}${path}${query}`, {
      headers: { Authorization: `Discogs token=${discogsToken}` },
    });
  } catch {
    if (attempt < RETRY_WAITS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
      return discogsGet(path, params, discogsToken, attempt + 1);
    }
    throw new Error("No se pudo contactar con Discogs: o no hay conexión o Discogs está saturado por tantas consultas. Espera un minuto y vuelve a probar.");
  }
  if (!response.ok) {
    const error = new Error(interpretStatus(response.status));
    error.authError = response.status === 401 || response.status === 403;
    throw error;
  }
  return response.json();
}

export async function testDiscogsConnection(discogsToken) {
  if (!discogsToken) {
    return { ok: false, reason: "Falta el token de Discogs." };
  }
  try {
    const data = await discogsGet("/oauth/identity", null, discogsToken);
    return { ok: true, reason: `Conectado como ${data.username}.` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function releaseUrl(id) {
  return `https://www.discogs.com/release/${id}`;
}

// Palabras que indican un vinilo de color. "black" va aparte: un disco solo negro no se destaca.
const COLOR_WORDS =
  /\b(red|blue|green|yellow|orange|pink|purple|violet|white|clear|transparent|translucent|gold|golden|silver|gr[ae]y|brown|cream|beige|turquoise|teal|magenta|aqua|mint|coral|marbled?|splatter|swirl|smoke|smoky|colou?red|picture disc|rainbow|arco ?iris|multi-?colou?r(?:ed)?|tie-?dye|galaxy|neon|glow|opaque|milky|crystal|bone|olive|lilac|lavender|indigo|navy|cyan|lime|amber|bronze|copper|ruby|emerald|sapphire|jade|tangerine|peach|salmon|maroon|burgundy|cobalt|sky|sea ?glass|haze|nebula|confetti|blend|cloudy|rojo|azul|verde|amarillo|naranja|rosa|morado|blanco|transparente|dorado|plateado|gris)\b/i;

// Sube cada vez que la lista de palabras de color crece: los discos guardados como negros con una
// lista anterior se vuelven a mirar por si ahora se reconoce su color.
export const COLOR_REV = 2;

// Devuelve el texto del color del vinilo (p. ej. "Orange Translucent"), o "" si es negro o no se sabe.
export function vinylColor(texts) {
  // «White Label» es una edición promocional sin portada, no un vinilo blanco.
  const hit = texts.find((t) => t && COLOR_WORDS.test(t.replace(/white label/gi, "")));
  return hit ? hit.trim() : "";
}

// Devuelve el gramaje (p. ej. "180 g") si Discogs lo indica: "180 Gram", "180g", "200 gr".
export function vinylWeight(texts) {
  for (const t of texts) {
    const m = (t || "").match(/\b(\d{2,3})\s*-?\s*(?:grams?|gr|g)\b/i);
    if (m) return `${m[1]} g`;
  }
  return "";
}

// Gramaje de una ficha completa: Discogs lo pone en las descripciones ("180 Gram") o en el texto libre.
export function releaseWeight(release) {
  return vinylWeight(release.formats.flatMap((f) => [f.text, ...f.descriptions]));
}

// Número de vinilos de una ficha completa (2 en un doble LP, 3 en un triple…). 1 si no lo dice.
export function releaseDiscs(release) {
  const vinyl = (release.formats || []).filter((f) => /vinyl|lp/i.test(f.name || ""));
  const total = vinyl.reduce((sum, f) => sum + (parseInt(f.qty, 10) || 1), 0);
  return Math.max(1, total);
}

// Vinilo pesado: 180 g o más.
export function isHeavy(weight) {
  return parseInt(weight, 10) >= 180;
}

function fromSearchResult(r) {
  return {
    id: r.id,
    title: r.title,
    year: r.year || "",
    country: r.country || "",
    label: (r.label || [])[0] || "",
    catno: r.catno || "",
    formats: r.format || [],
    color: vinylColor([...(r.formats || []).map((f) => f.text), ...(r.format || [])]),
    weight: vinylWeight([...(r.formats || []).flatMap((f) => [f.text, ...(f.descriptions || [])]), ...(r.format || [])]),
    barcodes: r.barcode || [],
    thumb: r.cover_image || r.thumb || "",
    have: r.community?.have || 0,
    url: releaseUrl(r.id),
  };
}

function fromMasterVersion(v) {
  return {
    id: v.id,
    title: v.title,
    year: v.released && v.released !== "0" ? v.released : "",
    country: v.country || "",
    label: v.label || "",
    catno: v.catno || "",
    formats: [...(v.major_formats || []), ...(v.format || "").split(", ").filter(Boolean)],
    color: vinylColor((v.format || "").split(", ")),
    weight: vinylWeight((v.format || "").split(", ")),
    barcodes: [],
    thumb: v.thumb || "",
    have: v.stats?.community?.in_collection || 0,
    url: releaseUrl(v.id),
  };
}

function mostCommonMasterId(results) {
  const counts = new Map();
  for (const r of results) {
    if (r.master_id) counts.set(r.master_id, (counts.get(r.master_id) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) [best, bestCount] = [id, count];
  }
  return best;
}

function buildSearchSteps(clues) {
  const steps = [];
  const barcode = (clues.barcode || "").replace(/\D/g, "");
  if (barcode) {
    steps.push({ by: "barcode", params: { barcode } });
  }
  if (clues.catalog_number) {
    const params = { catno: clues.catalog_number };
    if (clues.label) params.label = clues.label;
    steps.push({ by: "catno", params });
  }
  if (clues.artist || clues.title) {
    const params = {};
    if (clues.artist) params.artist = clues.artist;
    if (clues.title) params.release_title = clues.title;
    steps.push({ by: "artist-title", params, expandMaster: true });
    steps.push({ by: "text", params: { q: [clues.artist, clues.title].filter(Boolean).join(" ") }, expandMaster: true });
  }
  return steps;
}

// Orden de precisión: código de barras → nº de catálogo (+ sello) → artista + título → texto libre.
export function findCandidates(clues, discogsToken, onStep) {
  return runSearchSteps(buildSearchSteps(clues), discogsToken, onStep);
}

export function searchByText(text, discogsToken, onStep) {
  return runSearchSteps([{ by: "text", params: { q: text }, expandMaster: true }], discogsToken, onStep);
}

// Sube cuando cambia lo que se guarda de una ficha: las guardadas antes se vuelven a pedir a Discogs
// (2: los temas en varias partes, como «Shine On You Crazy Diamond (1-5)», ya no se pierden).
export const RELEASE_VERSION = 2;

// Canciones de una ficha. Un tema en varias partes (type_ "index") cuenta como una canción:
// posición de su primera parte («A1.1» → «A1») y duración la suya o la suma de las partes.
function tracksOf(list) {
  const tracks = [];
  for (const t of list || []) {
    if (t.type_ === "track") {
      tracks.push({ position: t.position, title: t.title, duration: t.duration || "" });
    } else if (t.type_ === "index" && (t.sub_tracks || []).length) {
      const parts = t.sub_tracks.filter((p) => p.type_ === "track");
      const first = (parts[0] && parts[0].position) || "";
      const secs = parts.map((p) => clockSeconds(p.duration));
      const sum = secs.every((x) => x > 0) ? secs.reduce((a, b) => a + b, 0) : 0;
      tracks.push({
        position: (first.match(/^[A-Z]*\d+/i) || [first])[0],
        title: t.title,
        duration: t.duration || (sum ? `${Math.floor(sum / 60)}:${String(sum % 60).padStart(2, "0")}` : ""),
      });
    }
  }
  return tracks;
}

// "3:45" → 225; "" → 0.
function clockSeconds(duration) {
  const parts = String(duration || "").split(":").map(Number);
  if (!duration || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

export async function getRelease(id, discogsToken) {
  const r = await discogsGet(`/releases/${id}`, null, discogsToken);
  const images = r.images || [];
  const cover = images.find((i) => i.type === "primary") || images[0];
  return {
    id: r.id,
    masterId: r.master_id || null,
    artist: r.artists_sort || "",
    // Cada artista con su id, para abrir su ficha.
    artists: (r.artists || []).filter((a) => a.id).map((a) => ({ id: a.id, name: a.name })),
    title: r.title || "",
    year: r.year || "",
    country: r.country || "",
    labels: (r.labels || []).map((l) => ({ name: l.name, catno: l.catno, ...(l.id ? { id: l.id } : {}) })),
    formats: (r.formats || []).map((f) => ({
      name: f.name,
      qty: f.qty,
      descriptions: f.descriptions || [],
      text: f.text || "",
    })),
    image: cover ? cover.uri : r.thumb || "",
    thumb: r.thumb || "",
    // Fotos que no son la portada: entre ellas suele estar la de la galleta.
    extraImages: images
      .filter((i) => i !== cover && i.uri)
      .map((i) => ({ uri: i.uri, uri150: i.uri150 || i.uri })),
    tracklist: tracksOf(r.tracklist),
    released: r.released || "",
    identifiers: (r.identifiers || []).map((i) => ({
      type: i.type || "",
      value: i.value || "",
      description: i.description || "",
    })),
    genres: r.genres || [],
    styles: r.styles || [],
    notes: cleanNotes(r.notes),
    community: communityData(r.community),
    url: r.uri || releaseUrl(r.id),
    v: RELEASE_VERSION,
  };
}

// ---------- Artistas ----------

// Ficha del artista: foto, biografía, miembros o grupos y enlaces.
export async function getArtist(id, discogsToken) {
  const a = await discogsGet(`/artists/${id}`, null, discogsToken);
  const images = a.images || [];
  const photo = images.find((i) => i.type === "primary") || images[0];
  const people = (list) => (list || []).filter((p) => p.id).map((p) => ({ id: p.id, name: p.name, active: p.active !== false }));
  return {
    id: a.id,
    name: a.name || "",
    realname: a.realname || "",
    profile: cleanNotes(a.profile).replace(/\[[amlr]\d+\]/gi, "").replace(/[ \t]{2,}/g, " ").trim(),
    image: photo ? photo.uri : "",
    members: people(a.members),
    groups: people(a.groups),
    urls: (a.urls || []).filter(Boolean),
    url: a.uri || `https://www.discogs.com/artist/${a.id}`,
  };
}

// Tipo de disco según sus formatos de Discogs ("Vinyl, LP, Album", '7", Single'…):
// "album" (LP), "single", "ep", "comp" (recopilatorio) u "other".
export function releaseKind(formats) {
  const words = (Array.isArray(formats) ? formats : String(formats || "").split(","))
    .map((f) => String(f).trim().toLowerCase())
    .filter(Boolean);
  const has = (w) => words.includes(w);
  if (has("compilation")) return "comp";
  if (has("album")) return "album";
  if (has("ep") || has("mini-album")) return "ep";
  if (has("single") || has("maxi-single") || has('7"')) return "single";
  if (has("lp")) return "album";
  return "other";
}

// Lo que se pide al buscador de Discogs para cada tipo de la discografía, en este orden
// (un disco va en el primer tipo en que aparece) y cuántas páginas de 100 como mucho.
const KIND_SEARCHES = [
  ["album", "Album", 2],
  ["comp", "Compilation", 1],
  ["ep", "EP", 1],
  ["single", "Single", 1],
];

const lowerWords = (formats) => (formats || []).map((f) => String(f).trim().toLowerCase());

// "The Beatles = ビートルズ* - Beatles No. 5 = ビートルズ No. 5" → { artist: "the beatles", title: "Beatles No. 5" }.
function splitSearchTitle(text) {
  const [artistPart, ...rest] = String(text || "").split(" - ");
  const title = rest.length ? rest.join(" - ") : artistPart;
  const clean = (t) => t.split(" = ")[0].replace(/\*/g, "").replace(/\s*\(\d+\)/g, "").trim();
  return { artist: clean(artistPart).toLowerCase(), title: clean(title) };
}

// Discogs no marca los directos: se reconocen por el título ("Live At…", "En directo", "At The Hollywood Bowl"…).
const LIVE_TITLE =
  /\blive\b(?!\s+(and|through|forever|to|with|your|my|it|this|that|like|or|for|is|fast|wire)\b)|\b(alive|en directo|en vivo|ao vivo|in concert|concierto|unplugged)\b|\bat the [^()]*\b(bowl|club|hall|theat(re|er)|garden|arena|stadium|fillmore|palladium|forum|apollo|budokan|olympia|bbc)\b|\bbudokan\b/i;
// "Long Live Rock 'n' Roll", "Live Through This"… no son directos.
const NOT_LIVE = /\blong live\b|\bto live\b|\blive (a|the) /i;

export const isLiveTitle = (title) => LIVE_TITLE.test(String(title || "")) && !NOT_LIVE.test(String(title || ""));

// Tipo final de un disco encontrado buscando `wanted`: los no oficiales van a «piratas», y los
// álbumes que no salieron nunca en vinilo, también (es una app de vinilos).
function searchKind(wanted, formats, title) {
  const words = lowerWords(formats);
  if (words.includes("unofficial release")) return "bootleg";
  if (wanted === "album") {
    if (words.includes("compilation")) return "comp";
    if (!words.includes("vinyl") && !words.includes("lp")) return "other";
    return isLiveTitle(title) ? "live" : "album";
  }
  return wanted;
}

const liveIfAlbum = (kind, title) => (kind === "album" && isLiveTitle(title) ? "live" : kind);

// Plan B para artistas sin masters en el buscador: sus ediciones de la lista del artista.
async function artistReleaseList(id, discogsToken) {
  const r = await discogsGet(`/artists/${id}/releases`, { sort: "year", sort_order: "asc", per_page: "100" }, discogsToken);
  const seen = new Set();
  const albums = [];
  for (const x of (r.releases || []).filter((x) => x.role === "Main")) {
    const t = String(x.title || "").toLowerCase().trim();
    if (seen.has(t)) continue;
    seen.add(t);
    albums.push({
      id: x.type === "master" ? x.main_release || null : x.id,
      masterId: x.type === "master" ? x.id : null,
      title: x.title || "",
      year: x.year ? String(x.year) : "",
      thumb: x.thumb || "",
      kind: liveIfAlbum(x.type === "master" ? "album" : releaseKind(x.format), x.title),
    });
  }
  return { albums, more: (r.pagination && r.pagination.pages > 1) || false };
}

// Discografía del artista, tipo a tipo (LP, recopilatorios, EP, singles y otros), del más antiguo al más nuevo.
// Se pregunta al buscador de Discogs por cada tipo; así salen todos sus álbumes aunque tenga miles de ediciones.
// onProgress({ albums, more, done }) se llama al terminar cada tipo, para enseñar los LP cuanto antes.
// more: { tipo: true } si hay más de los que se han traído.
// name: el nombre tal cual en Discogs, con su número si lo tiene («The Prodigy (2)» es otro grupo).
export async function getArtistAlbums(id, name, discogsToken, onProgress = () => {}) {
  const isMine = artistMatcher(name);
  name = name.replace(/\s*\(\d+\)/g, "").replace(/\*/g, "").trim();
  const albums = [];
  const more = {};
  const seen = new Set();
  const toCheck = [];
  for (const [kind, format, maxPages] of KIND_SEARCHES) {
    for (let page = 1; page <= maxPages; page++) {
      const r = await discogsGet(
        "/database/search",
        { type: "master", artist: name, format, sort: "year", sort_order: "asc", per_page: "100", page: String(page) },
        discogsToken
      );
      for (const x of r.results || []) {
        const { title } = splitSearchTitle(x.title);
        // El buscador también trae otros artistas con nombre parecido ("The Beatles Revival Band"):
        // solo valen los suyos, o los que comparte con «&» ("Lou Reed & John Cale").
        if (!isMine(String(x.title || "").split(" - ")[0])) continue;
        const k = searchKind(kind, x.format, title);
        // Un mismo título solo una vez por tipo (hay singles con varios masters casi iguales).
        const same = `${k}|${title.toLowerCase()}`;
        if (seen.has(x.id) || seen.has(same)) continue;
        seen.add(x.id);
        seen.add(same);
        const album = { id: null, masterId: x.id, title, year: x.year ? String(x.year) : "", thumb: x.thumb || "", kind: k };
        // El formato que da el buscador es solo el de la edición principal: un LP cuya edición
        // principal es un CD («Punk In Drublic») queda en «otros» hasta mirar sus demás ediciones.
        if (kind === "album" && k === "other") toCheck.push(album);
        albums.push(album);
      }
      const pages = (r.pagination && r.pagination.pages) || 1;
      if (page >= pages) break;
      if (page === maxPages) more[kind] = true;
    }
    if (kind === "album") await rescueVinylAlbums(toCheck, discogsToken);
    onProgress({ albums: sortByYear(albums), more, done: false });
  }
  if (!albums.length) {
    const fallback = await artistReleaseList(id, discogsToken);
    albums.push(...fallback.albums);
    if (fallback.more) for (const [kind] of KIND_SEARCHES) more[kind] = true;
  }
  const result = { albums: sortByYear(albums), more, done: true };
  onProgress(result);
  return result;
}

// ¿Es del artista `name` el disco firmado como `credit` («Prodigy* & Otro»)? Sin asterisco tiene que ser
// el mismo nombre, número incluido («The Prodigy (2)» es otro grupo). Con asterisco es una variante del
// nombre («Prodigy*» en «The Fat Of The Land»): vale si coincide sin el número ni el «The».
function artistMatcher(name) {
  const lower = (t) => String(t || "").toLowerCase().trim();
  const base = (t) => lower(t).replace(/\*/g, "").replace(/\s*\(\d+\)/g, "").replace(/^the\s+/, "").trim();
  const full = lower(name).replace(/\*/g, "");
  return (credit) =>
    String(credit || "")
      .split(/\s+&\s+/)
      .map((piece) => piece.split(" = ")[0].trim())
      .some((piece) => (piece.endsWith("*") ? base(piece) === base(name) : lower(piece) === full));
}

// Pasa a LP (o directo) los álbumes que tienen alguna edición en vinilo aunque la principal no lo sea.
// Como mucho MAX_VINYL_CHECKS consultas por artista; si una falla, el disco se queda en «otros».
const MAX_VINYL_CHECKS = 25;
async function rescueVinylAlbums(list, discogsToken) {
  for (const album of list.slice(0, MAX_VINYL_CHECKS)) {
    try {
      const r = await discogsGet(`/masters/${album.masterId}/versions`, { format: "Vinyl", per_page: "1" }, discogsToken);
      if (r.pagination && r.pagination.items > 0) album.kind = isLiveTitle(album.title) ? "live" : "album";
    } catch {
      // se queda en «otros»
    }
  }
}

// Del más antiguo al más nuevo; los que no tienen año, al final.
const sortByYear = (list) => [...list].sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));

// Edición de Discogs de un álbum del que solo se sabe artista y título (los de MusicBrainz):
// la principal de su master si se encuentra; si no, la primera edición en vinilo. null si no hay.
export async function findAlbumRelease(artist, title, discogsToken) {
  // Los títulos muy largos («X; or, Y: …») no los encuentra Discogs: se prueba también con la parte corta.
  const short = shortAlbumTitle(title);
  const titles = [...new Set([title, short].filter(Boolean))];
  const search = (params) => discogsGet("/database/search", params, discogsToken).then((r) => r.results || []);
  const firstResults = [];

  // 1) El álbum (master) con el mismo título; 2) búsqueda libre, por si el artista se escribe distinto («&» o «And»).
  const masterSearches = [
    ...titles.map((t) => ({ type: "master", artist, release_title: t, per_page: "10" })),
    { type: "master", q: `${artist} ${short}`, per_page: "10" },
  ];
  for (const params of masterSearches) {
    const results = await search(params);
    if (!firstResults.length) firstResults.push(...results);
    const master = bestMaster(results, title, true);
    if (master) {
      const id = await masterMainRelease(master.id, discogsToken);
      if (id) return id;
    }
  }
  // 3) Una edición en vinilo con el mismo título (la que más gente tiene).
  for (const t of titles) {
    const releases = await search({ type: "release", artist, release_title: t, format: "Vinyl", per_page: "10" });
    const release = bestMaster(releases, title, true);
    if (release) return release.id;
  }
  // 4) Como antes: el master más común de la primera búsqueda, aunque el título no coincida del todo.
  const master = bestMaster(firstResults, title, false);
  return master ? await masterMainRelease(master.id, discogsToken) : null;
}

// Álbum (master) de Discogs del que solo se sabe artista y título: el que tiene el mismo título
// (al menos su parte corta) y más gente tiene. null si no hay.
export async function findAlbumMaster(artist, title, discogsToken) {
  const short = shortAlbumTitle(title);
  for (const t of [...new Set([title, short].filter(Boolean))]) {
    const r = await discogsGet("/database/search", { type: "master", artist, release_title: t, per_page: "10" }, discogsToken);
    const master = bestMaster(r.results || [], title, true);
    if (master) return master.id;
  }
  return null;
}

// «PetroDragonic Apocalypse; or, Dawn of…» → «PetroDragonic Apocalypse».
function shortAlbumTitle(title) {
  return String(title || "").split(/\s*[;:(\[]\s*|\s+\/\s+|,\s+or,?\s+/i)[0].trim();
}

// De los resultados, el del álbum de verdad: mismo título (al menos su parte corta) y el que más gente tiene.
// Así no sale una edición rara (un VHS, un pirata, un single, un disco de otro con título parecido).
// strict: si ninguno tiene el mismo título, no devuelve nada.
function bestMaster(results, title, strict) {
  const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const wanted = norm(title);
  const wantedShort = norm(shortAlbumTitle(title));
  const official = results.filter((r) => !lowerWords(r.format).includes("unofficial release"));
  const titleOf = (r) => splitSearchTitle(r.title).title;
  const same = official.filter((r) => norm(titleOf(r)) === wanted);
  // Por la parte corta del título no valen los recopilatorios: «El Patio / Hijos Del Agobio» no es «El patio».
  const similar = official.filter(
    (r) => norm(shortAlbumTitle(titleOf(r))) === wantedShort && !lowerWords(r.format).includes("compilation")
  );
  const pool = same.length ? same : similar.length ? similar : strict ? [] : official.length ? official : results;
  const have = (r) => r.community?.have || 0;
  return pool.reduce((best, r) => (!best || have(r) > have(best) ? r : best), null);
}

// Edición principal de un álbum (para abrir su ficha desde la discografía): la principal del
// master si es de vinilo; si no (CD, digital…), la edición en vinilo que más gente tiene.
export async function masterMainRelease(masterId, discogsToken) {
  const master = await discogsGet(`/masters/${masterId}`, null, discogsToken);
  const versions = await discogsGet(`/masters/${masterId}/versions`, { format: "Vinyl", per_page: "100" }, discogsToken);
  const vinyls = (versions.versions || []).filter((v) => !/unofficial/i.test(v.format || ""));
  if (!vinyls.length || vinyls.some((v) => v.id === master.main_release)) return master.main_release || null;
  const have = (v) => v.stats?.community?.in_collection || 0;
  return vinyls.reduce((best, v) => (have(v) > have(best) ? v : best)).id;
}

// Todas las ediciones en vinilo de un álbum (master), como candidatos, de la que más gente tiene a la que menos.
// Discogs da como mucho 100 por página: se piden hasta 3 páginas. total: cuántas hay en Discogs.
export async function vinylVersions(masterId, discogsToken) {
  const found = [];
  let total = 0;
  for (let page = 1; page <= 3; page++) {
    const r = await discogsGet(`/masters/${masterId}/versions`, { format: "Vinyl", per_page: "100", page: String(page) }, discogsToken);
    found.push(...(r.versions || []).map(fromMasterVersion).filter(isVinyl));
    total = (r.pagination && r.pagination.items) || found.length;
    if (page >= ((r.pagination && r.pagination.pages) || 1)) break;
  }
  return { candidates: found.sort((a, b) => b.have - a.have), total: Math.max(total, found.length) };
}

// Ediciones oficiales en vinilo de un álbum, de la que más gente tiene a la que menos (solo ids).
export async function popularVinylVersions(masterId, discogsToken) {
  const versions = await discogsGet(`/masters/${masterId}/versions`, { format: "Vinyl", per_page: "100" }, discogsToken);
  const have = (v) => v.stats?.community?.in_collection || 0;
  return (versions.versions || [])
    .filter((v) => !/unofficial/i.test(v.format || ""))
    .sort((a, b) => have(b) - have(a))
    .map((v) => v.id);
}

// Si a una edición le faltan duraciones de canciones, se copian de otras ediciones del mismo álbum
// (la principal y las más comunes), emparejando por título. Cambia release.tracklist; true si añadió alguna.
export async function borrowDurations(release, discogsToken) {
  const norm = trackKey;
  const missing = () => release.tracklist.filter((t) => !t.duration);
  if (!release.masterId || !missing().length) return false;
  const master = await discogsGet(`/masters/${release.masterId}`, null, discogsToken);
  // Primero la principal; las más comunes solo se piden si a esa también le faltan.
  const ids = [master.main_release];
  let more = false;
  let added = false;
  for (let i = 0; i < ids.length && i < 3; i++) {
    const id = ids[i];
    if (!id || id === release.id) {
      if (!more) {
        more = true;
        ids.push(...(await popularVinylVersions(release.masterId, discogsToken)).filter((x) => x !== release.id && !ids.includes(x)));
      }
      continue;
    }
    const other = await discogsGet(`/releases/${id}`, null, discogsToken);
    const known = new Map();
    for (const t of other.tracklist || []) if (t.duration && !known.has(norm(t.title))) known.set(norm(t.title), t.duration);
    for (const t of missing()) {
      const d = known.get(norm(t.title));
      if (d) {
        t.duration = d;
        added = true;
      }
    }
    if (!missing().length) break;
    if (!more) {
      more = true;
      ids.push(...(await popularVinylVersions(release.masterId, discogsToken)).filter((x) => x !== release.id && !ids.includes(x)));
    }
  }
  return added;
}

// Notas de la edición principal (normalmente la primera) de un álbum. null si es la misma que exceptId o no tiene.
export async function masterMainNotes(masterId, discogsToken, exceptId) {
  const master = await discogsGet(`/masters/${masterId}`, null, discogsToken);
  if (!master.main_release || master.main_release === exceptId) return null;
  const r = await discogsGet(`/releases/${master.main_release}`, null, discogsToken);
  const notes = cleanNotes(r.notes);
  if (!notes) return null;
  const where = [r.country, r.year].filter(Boolean).join(", ");
  return { text: notes, url: r.uri || releaseUrl(r.id), where };
}

// Historia de un sello. null si no tiene.
export async function getLabelProfile(id, discogsToken) {
  const l = await discogsGet(`/labels/${id}`, null, discogsToken);
  const profile = cleanNotes(l.profile).replace(/\[[amlr]\d+\]/gi, "").trim();
  return profile ? { name: l.name || "", text: profile, url: l.uri || `https://www.discogs.com/label/${id}` } : null;
}

// Búsqueda libre del modo explorador: artistas y álbumes (masters) que encajan con el texto.
// artists: [{ id, name, thumb }]; albums: [{ masterId, title, artist, year, thumb }].
export async function searchArtistsAndAlbums(text, discogsToken) {
  const [a, m] = await Promise.all([
    discogsGet("/database/search", { type: "artist", q: text, per_page: "5" }, discogsToken),
    discogsGet("/database/search", { type: "master", q: text, per_page: "12" }, discogsToken),
  ]);
  const image = (r) => {
    const url = r.cover_image || r.thumb || "";
    return /spacer\.gif/.test(url) ? "" : url;
  };
  const clean = (t) => String(t || "").split(" = ")[0].replace(/\*/g, "").replace(/\s*\(\d+\)/g, "").trim();
  const artists = (a.results || []).map((r) => ({ id: r.id, name: clean(r.title), thumb: image(r) }));
  const albums = (m.results || [])
    .filter((r) => !lowerWords(r.format).includes("unofficial release"))
    .map((r) => {
      const [artistPart, ...rest] = String(r.title || "").split(" - ");
      return {
        masterId: r.id,
        title: clean(rest.length ? rest.join(" - ") : artistPart),
        artist: rest.length ? clean(artistPart) : "",
        year: r.year || "",
        thumb: image(r),
      };
    });
  return { artists, albums };
}

// Busca un artista por su nombre; devuelve su id o null. Primero el que se llama igual.
export async function findArtistId(name, discogsToken) {
  const r = await discogsGet("/database/search", { type: "artist", q: name, per_page: "10" }, discogsToken);
  const results = r.results || [];
  const norm = (t) => String(t || "").replace(/\s*\(\d+\)/g, "").toLowerCase().trim();
  const same = results.find((x) => norm(x.title) === norm(name));
  return (same || results[0] || {}).id || null;
}

// Las notas de Discogs traen marcas propias: [a=Artista], [l=Sello], [url=…]texto[/url], [b]…[/b].
// Se dejan solo los textos.
function cleanNotes(notes) {
  return (notes || "")
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, "$1")
    .replace(/\[[almr]=([^\]]+)\]/gi, "$1")
    .replace(/\[\/?(b|i|u)\]/gi, "")
    .trim();
}

// Lo que dice la comunidad de Discogs sobre esta edición. null si no viene.
function communityData(c) {
  if (!c) return null;
  return {
    have: c.have || 0,
    want: c.want || 0,
    rating: c.rating && c.rating.count ? { average: c.rating.average, count: c.rating.count } : null,
    contributors: (c.contributors || []).length,
    dataQuality: c.data_quality || "",
    status: c.status || "",
  };
}

// Año en que salió el álbum por primera vez (el del master, común a todas sus ediciones). "" si no se sabe.
export async function getMasterYear(masterId, discogsToken) {
  if (!masterId) return "";
  const master = await discogsGet(`/masters/${masterId}`, null, discogsToken);
  return master.year ? String(master.year) : "";
}

// Los dos años, si se saben: reedición "1994 (ed. 2009)"; si son el mismo, solo "1985".
// Sin año original, "Ed. 2009". "" si no se sabe ninguno.
export function bothYears(item) {
  const year = String(item.year || "");
  const original = String(item.originalYear || "");
  if (!original) return year && `Ed. ${year}`;
  if (!year || original === year) return original;
  return `${original} (ed. ${year})`;
}

// Edición de referencia en vinilo de un álbum: la principal del master si es de vinilo; si no,
// la edición en vinilo más antigua. Devuelve su id, o null si no hay (o es la misma que exceptId).
export async function mainVinylRelease(masterId, discogsToken, exceptId) {
  const master = await discogsGet(`/masters/${masterId}`, null, discogsToken);
  const versions = await discogsGet(
    `/masters/${masterId}/versions`,
    { format: "Vinyl", sort: "released", sort_order: "asc", per_page: "100" },
    discogsToken
  );
  const vinyls = (versions.versions || []).map((v) => v.id);
  const id = vinyls.includes(master.main_release) ? master.main_release : vinyls[0];
  return id && id !== exceptId ? id : null;
}

// Estados que se enseñan del precio sugerido, de mejor a peor (claves tal como las da Discogs).
const SUGGESTED_GRADES = [
  ["Near Mint (NM or M-)", "NM"],
  ["Very Good Plus (VG+)", "VG+"],
  ["Very Good (VG)", "VG"],
];

// Precio de esta edición: lo que hay en venta ahora y el precio sugerido por estado.
// El sugerido solo llega si la cuenta tiene rellenados los datos de vendedor; si no, queda vacío.
export async function getPrices(id, discogsToken) {
  const stats = await discogsGet(`/marketplace/stats/${id}`, { curr_abbr: "EUR" }, discogsToken);
  let suggested = [];
  try {
    const data = await discogsGet(`/marketplace/price_suggestions/${id}`, null, discogsToken);
    suggested = SUGGESTED_GRADES
      .filter(([key]) => data[key] && data[key].value)
      .map(([key, grade]) => ({ grade, value: data[key].value, currency: data[key].currency }));
  } catch {
    // Sin datos de vendedor Discogs no da sugerencias: se enseña solo lo que hay en venta.
  }
  return {
    lowest: stats.lowest_price && stats.lowest_price.value ? stats.lowest_price : null,
    forSale: stats.num_for_sale || 0,
    blocked: Boolean(stats.blocked_from_sale),
    suggested,
  };
}

// Cuántas ediciones en vinilo de un álbum se miran para buscar la más barata.
// Discogs no da precios en la lista de ediciones: hay que pedirlos uno a uno (1 por segundo).
const CHEAPEST_CHECKS = 10;

// La edición en vinilo más barata a la venta de un álbum, entre las más comunes
// (las que más gente tiene: suele haber más copias y más baratas).
// known: precios ya sabidos { [id]: { lowest } } (p. ej. la edición abierta), para no pedirlos otra vez.
// onProgress({ best, checked, total, versions }) tras cada edición; stop() corta la búsqueda.
export async function cheapestVinyl(masterId, discogsToken, { known = {}, onProgress = () => {}, stop = () => false } = {}) {
  const versions = [];
  let total = 0;
  for (let page = 1; page <= 2; page++) {
    const r = await discogsGet(`/masters/${masterId}/versions`, { format: "Vinyl", per_page: "100", page: String(page) }, discogsToken);
    versions.push(...(r.versions || []));
    total = (r.pagination && r.pagination.items) || versions.length;
    if (page >= ((r.pagination && r.pagination.pages) || 1) || stop()) break;
  }
  const have = (v) => (v.stats && v.stats.community && v.stats.community.in_collection) || 0;
  const want = (v) => (v.stats && v.stats.community && v.stats.community.in_wantlist) || 0;
  // Cuánta gente tiene y busca el álbum, sumando todas las ediciones en vinilo leídas (como mucho 200).
  const community = {
    have: versions.reduce((sum, v) => sum + have(v), 0),
    want: versions.reduce((sum, v) => sum + want(v), 0),
    counted: versions.length,
  };
  const picks = versions.sort((a, b) => have(b) - have(a)).slice(0, CHEAPEST_CHECKS);
  let best = null;
  let checked = 0;
  const consider = (v, lowest) => {
    if (lowest && lowest.value && (!best || lowest.value < best.value)) {
      best = {
        value: lowest.value,
        currency: lowest.currency,
        id: v.id,
        country: v.country || "",
        year: v.released && v.released !== "0" ? String(v.released).slice(0, 4) : "",
        label: v.label || "",
      };
    }
  };
  for (const v of picks) {
    if (stop()) return null;
    if (known[v.id]) {
      consider(v, known[v.id].lowest);
    } else {
      try {
        const stats = await discogsGet(`/marketplace/stats/${v.id}`, { curr_abbr: "EUR" }, discogsToken);
        if (!stats.blocked_from_sale) consider(v, stats.lowest_price);
      } catch (err) {
        if (err.authError) throw err;
        // Si una falla, se sigue con las demás.
      }
    }
    checked += 1;
    onProgress({ best, checked, total: picks.length, versions: total, community });
  }
  return { best, checked, total: picks.length, versions: total, community };
}

// Solo interesan los vinilos: se descartan CD, casetes, etc.
const isVinyl = (candidate) => candidate.formats.some((f) => /vinyl|lp\b|acetate|lathe/i.test(f));

async function runSearchSteps(steps, discogsToken, onStep) {
  for (const step of steps) {
    if (onStep) onStep(step.by);
    const data = await discogsGet(
      "/database/search",
      { ...step.params, type: "release", format: "Vinyl", per_page: "50" },
      discogsToken
    );
    const results = data.results || [];
    const found = results.map(fromSearchResult).filter(isVinyl);
    if (found.length === 0) continue;

    if (step.expandMaster) {
      const masterId = mostCommonMasterId(results);
      if (masterId) {
        if (onStep) onStep("master");
        const versions = await discogsGet(
          `/masters/${masterId}/versions`,
          { format: "Vinyl", per_page: "100" },
          discogsToken
        );
        const vinyls = (versions.versions || []).map(fromMasterVersion).filter(isVinyl);
        if (vinyls.length) return { candidates: vinyls, strategy: step.by, masterId };
      }
    }
    return { candidates: found, strategy: step.by, masterId: null };
  }
  return { candidates: [], strategy: null, masterId: null };
}

// Países tal como los escribe Discogs → código ISO de dos letras, para la bandera.
const COUNTRY_CODES = {
  Spain: "ES", UK: "GB", US: "US", USA: "US", Europe: "EU", "European Union": "EU", Germany: "DE",
  France: "FR", Italy: "IT", Portugal: "PT", Netherlands: "NL", Belgium: "BE", Benelux: "BE",
  Switzerland: "CH", Austria: "AT", Sweden: "SE", Norway: "NO", Denmark: "DK", Finland: "FI",
  Iceland: "IS", Ireland: "IE", Greece: "GR", Poland: "PL", Czechia: "CZ", "Czech Republic": "CZ",
  Czechoslovakia: "CZ", Slovakia: "SK", Hungary: "HU", Romania: "RO", Bulgaria: "BG",
  Yugoslavia: "RS", Serbia: "RS", Croatia: "HR", Slovenia: "SI", Russia: "RU", USSR: "RU",
  Ukraine: "UA", "German Democratic Republic (GDR)": "DE", "West Germany": "DE", Turkey: "TR",
  Israel: "IL", Canada: "CA", Mexico: "MX", Brazil: "BR", Argentina: "AR", Chile: "CL",
  Colombia: "CO", Peru: "PE", Venezuela: "VE", Uruguay: "UY", Cuba: "CU", Jamaica: "JM",
  "Puerto Rico": "PR", Japan: "JP", "South Korea": "KR", Korea: "KR", China: "CN", Taiwan: "TW",
  "Hong Kong": "HK", India: "IN", Indonesia: "ID", Malaysia: "MY", Philippines: "PH",
  Singapore: "SG", Thailand: "TH", Australia: "AU", "New Zealand": "NZ", "South Africa": "ZA",
  Nigeria: "NG", Egypt: "EG", Lebanon: "LB", Iran: "IR", Luxembourg: "LU", Scandinavia: "",
};

// Bandera del país de Discogs: "Spain" → 🇪🇸; "UK & Europe" → 🇬🇧🇪🇺. "" si no se conoce.
export function countryFlag(country) {
  return (country || "")
    .split(/\s*&\s*/)
    .map((name) => COUNTRY_CODES[name] || "")
    .map((code) => code.replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)))
    .join("");
}

// Códigos de dos letras del país de Discogs: "UK & Europe" → ["GB", "EU"]. [] si no se conoce.
export function countryCodes(country) {
  return (country || "")
    .split(/\s*&\s*/)
    .map((name) => COUNTRY_CODES[name] || "")
    .filter(Boolean);
}

// "Spain 🇪🇸", o solo el país si no hay bandera.
export function countryWithFlag(country) {
  const flag = countryFlag(country);
  return flag ? `${country} ${flag}` : country;
}
