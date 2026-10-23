// MusicBrainz: base de datos musical abierta y gratuita (sin llave).
// Se usa para la discografía del artista porque clasifica cada álbum: LP, directo, recopilatorio,
// single, EP… (Discogs no marca los directos). Pide como mucho 1 consulta por segundo.
// Las portadas salen de Cover Art Archive, el archivo de portadas de MusicBrainz.
const BASE = "https://musicbrainz.org/ws/2";
const MIN_GAP_MS = 1100;
let lastRequestAt = 0;

async function mbGet(path, params = {}) {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const query = new URLSearchParams({ ...params, fmt: "json" });
  let response;
  try {
    response = await fetch(`${BASE}${path}?${query}`, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("No se pudo contactar con MusicBrainz.");
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`MusicBrainz respondió con un error (código ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const norm = (name) =>
  String(name || "")
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\*/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

// Id de Discogs al que enlaza un artista de MusicBrainz (null si no enlaza a ninguno).
function linkedDiscogsId(artist) {
  for (const rel of (artist && artist.relations) || []) {
    const match = /discogs\.com\/artist\/(\d+)/.exec((rel.url && rel.url.resource) || "");
    if (match) return Number(match[1]);
  }
  return null;
}

// Artista de MusicBrainz que corresponde al de Discogs: primero por el enlace a su página de Discogs;
// si no lo tiene, por el nombre (descartando a los que enlazan a otro artista de Discogs). null si no hay.
export async function findMbArtist(discogsId, name) {
  if (discogsId) {
    const url = await mbGet("/url", { resource: `https://www.discogs.com/artist/${discogsId}`, inc: "artist-rels" });
    const rel = url && (url.relations || []).find((r) => r.artist && r.artist.id);
    if (rel) return { id: rel.artist.id, name: rel.artist.name };
  }
  const found = await mbGet("/artist", { query: `artist:"${String(name).replace(/"/g, "")}"`, limit: "5" });
  const same = ((found && found.artists) || []).filter((a) => norm(a.name) === norm(name)).slice(0, 2);
  for (const candidate of same) {
    const full = await mbGet(`/artist/${candidate.id}`, { inc: "url-rels" });
    const linked = linkedDiscogsId(full);
    if (!linked || !discogsId || linked === Number(discogsId)) return { id: candidate.id, name: candidate.name };
  }
  return null;
}

// Tipo de la app a partir de los de MusicBrainz (primary-type y secondary-types).
function kindOf(group) {
  const primary = String(group["primary-type"] || "").toLowerCase();
  const secondary = (group["secondary-types"] || []).map((t) => String(t).toLowerCase());
  if (primary === "single") return "single";
  if (primary === "ep") return "ep";
  if (primary !== "album") return "other"; // emisiones de radio, «otros»…
  if (secondary.includes("live")) return "live";
  if (secondary.includes("compilation")) return "comp";
  if (secondary.some((t) => ["interview", "spokenword", "audiobook", "audio drama", "demo", "dj-mix", "mixtape/street", "remix"].includes(t))) {
    return "other";
  }
  return "album"; // también las bandas sonoras
}

// Lo que se pide, en este orden (primero los álbumes, que es lo que se enseña al abrir), y cuántas páginas de 100.
// El último paso pide los álbumes sin filtro: los que no habían salido son los piratas.
const TYPE_PAGES = [
  ["album", 3, "official"],
  ["ep", 1, "official"],
  ["single", 2, "official"],
  ["broadcast|other", 1, "official"],
  ["album", 4, "bootleg"],
];

// Discografía del artista (sus «release groups»: un álbum con todas sus ediciones), del más antiguo al más nuevo.
// onProgress({ albums, more }) tras cada tipo. more: { tipo: true } si hay más de los que se han traído.
// MusicBrainz guarda también los discos piratas (bootlegs). «website-default» deja solo lo que enseña
// su web: esconde los álbumes que solo tienen ediciones piratas. Si algún día no lo acepta, se pide sin filtro.
let statusFilter = true;

async function releaseGroups(params, filtered = true) {
  if (filtered && statusFilter) {
    try {
      return await mbGet("/release-group", { ...params, "release-group-status": "website-default" });
    } catch (err) {
      if (err.status !== 400) throw err;
      statusFilter = false;
    }
  }
  return mbGet("/release-group", params);
}

export async function mbDiscography(mbid, onProgress = () => {}) {
  const albums = [];
  const more = {};
  const seen = new Set();
  for (const [type, maxPages, mode] of TYPE_PAGES) {
    const bootlegs = mode === "bootleg";
    // Sin el filtro no se pueden separar los piratas: se queda todo junto, como antes.
    if (bootlegs && !statusFilter) continue;
    for (let page = 0; page < maxPages; page++) {
      const r = await releaseGroups({ artist: mbid, type, limit: "100", offset: String(page * 100) }, !bootlegs);
      const groups = (r && r["release-groups"]) || [];
      for (const g of groups) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        albums.push({
          id: null,
          masterId: null,
          mbid: g.id,
          title: g.title || "",
          year: (g["first-release-date"] || "").slice(0, 4),
          thumb: `https://coverartarchive.org/release-group/${g.id}/front-250`,
          kind: bootlegs ? "bootleg" : kindOf(g),
        });
      }
      const total = (r && r["release-group-count"]) || 0;
      if ((page + 1) * 100 >= total) break;
      if (page === maxPages - 1) {
        // Lo que no se ha traído es de este tipo: se marca en los tipos de la app que pueda tener.
        const kinds = bootlegs
          ? ["bootleg"]
          : type === "album"
            ? ["album", "live", "comp", "other"]
            : [type === "ep" ? "ep" : type === "single" ? "single" : "other"];
        for (const k of kinds) more[k] = true;
      }
    }
    onProgress({ albums: sortByYear(albums), more });
  }
  return { albums: sortByYear(albums), more };
}

const sortByYear = (list) => [...list].sort((a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999));
