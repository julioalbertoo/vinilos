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
    year: v.released || "",
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
      .map((t) => ({ position: t.position, title: t.title })),
    url: r.uri || releaseUrl(r.id),
  };
}

async function runSearchSteps(steps, discogsToken, onStep) {
  for (const step of steps) {
    if (onStep) onStep(step.by);
    const data = await discogsGet(
      "/database/search",
      { ...step.params, type: "release", per_page: "50" },
      discogsToken
    );
    const results = data.results || [];
    if (results.length === 0) continue;

    if (step.expandMaster) {
      const masterId = mostCommonMasterId(results);
      if (masterId) {
        if (onStep) onStep("master");
        const versions = await discogsGet(`/masters/${masterId}/versions`, { per_page: "100" }, discogsToken);
        return { candidates: (versions.versions || []).map(fromMasterVersion), strategy: step.by, masterId };
      }
    }
    return { candidates: results.map(fromSearchResult), strategy: step.by, masterId: null };
  }
  return { candidates: [], strategy: null, masterId: null };
}
