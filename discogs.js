import { CONFIG } from "./config.js";

const MIN_GAP_MS = 1100; // Discogs permite unas 60 peticiones por minuto con token
let lastRequestAt = 0;

function interpretStatus(status) {
  if (status === 401 || status === 403) {
    return "El token de Discogs no es válido. Revisa que lo copiaste bien.";
  }
  if (status === 429) {
    return "Se ha alcanzado el límite de peticiones de Discogs por ahora. Espera un minuto.";
  }
  return `Discogs respondió con un error inesperado (código ${status}).`;
}

async function discogsGet(path, params, discogsToken) {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  const query = params ? `?${new URLSearchParams(params)}` : "";
  let response;
  try {
    response = await fetch(`${CONFIG.DISCOGS.baseUrl}${path}${query}`, {
      headers: { Authorization: `Discogs token=${discogsToken}` },
    });
  } catch {
    throw new Error("No se pudo contactar con Discogs. Comprueba tu conexión a internet.");
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
  /\b(red|blue|green|yellow|orange|pink|purple|violet|white|clear|transparent|translucent|gold|golden|silver|gr[ae]y|brown|cream|beige|turquoise|teal|magenta|aqua|mint|coral|marbled?|splatter|swirl|smoke|smoky|colou?red|picture disc|rojo|azul|verde|amarillo|naranja|rosa|morado|blanco|transparente|dorado|plateado|gris)\b/i;

// Devuelve el texto del color del vinilo (p. ej. "Orange Translucent"), o "" si es negro o no se sabe.
export function vinylColor(texts) {
  const hit = texts.find((t) => t && COLOR_WORDS.test(t));
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

export async function getRelease(id, discogsToken) {
  const r = await discogsGet(`/releases/${id}`, null, discogsToken);
  const images = r.images || [];
  const cover = images.find((i) => i.type === "primary") || images[0];
  return {
    id: r.id,
    masterId: r.master_id || null,
    artist: r.artists_sort || "",
    title: r.title || "",
    year: r.year || "",
    country: r.country || "",
    labels: (r.labels || []).map((l) => ({ name: l.name, catno: l.catno })),
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
    tracklist: (r.tracklist || [])
      .filter((t) => t.type_ === "track")
      .map((t) => ({ position: t.position, title: t.title, duration: t.duration || "" })),
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
  };
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

// "Spain 🇪🇸", o solo el país si no hay bandera.
export function countryWithFlag(country) {
  const flag = countryFlag(country);
  return flag ? `${country} ${flag}` : country;
}
