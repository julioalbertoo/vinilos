// Notas de la crítica de un álbum («76/100 en Metacritic, 7,5/10 en Pitchfork…»).
// Salen de la tabla de críticas del artículo del álbum en la Wikipedia en inglés (la plantilla
// «Music ratings», antes «Album ratings»), que cita cada nota. El artículo se localiza con Wikidata
// por el número del álbum en Discogs y, si no, buscando. Se guarda un mes en la nube.
import { wikiJson, wikiUrl, wikidataArticles, searchArticle, cleanArtist, coreTitle, coreArtist, plain } from "./trivia.js";
import { cloudCached, MONTH_MS } from "./details.js";

// Sube si cambia la forma de lo guardado: lo antiguo se vuelve a pedir.
const RATINGS_VERSION = 1;

// Quita notas al pie, comentarios y etiquetas HTML.
const stripRefs = (text) =>
  String(text || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<[^>]+>/g, "");

// Trozo de texto de una plantilla «{{…}}» que empieza en start, respetando las anidadas.
function balanced(text, start) {
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === "{" && text[i + 1] === "{") {
      depth += 1;
      i += 1;
    } else if (text[i] === "}" && text[i + 1] === "}") {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Parte el interior de una plantilla por las «|» de primer nivel (no las de [[…]] ni {{…}}).
function splitParams(inner) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < inner.length; i += 1) {
    const two = inner.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      depth += 1;
      current += two;
      i += 1;
    } else if (two === "}}" || two === "]]") {
      depth -= 1;
      current += two;
      i += 1;
    } else if (inner[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += inner[i];
    }
  }
  parts.push(current);
  return parts;
}

const decimal = (n) => String(n).trim().replace(".", ",");

// «''[[Pitchfork (website)|Pitchfork]]''» → «Pitchfork».
function cleanName(text) {
  return stripRefs(text)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/'{2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// «{{Rating|4.5|5}}» → «4,5/5»; «{{Rating-10|8}}» → «8/10»; «7.5/10» → «7,5/10»; «A−» tal cual.
export function cleanScore(text) {
  let s = stripRefs(text);
  s = s.replace(/\{\{\s*rating-(\d+)\s*\|\s*([\d.]+)\s*(?:\|[^{}]*)?\}\}/gi, (_, max, n) => `${decimal(n)}/${max}`);
  s = s.replace(/\{\{\s*rating\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*(?:\|[^{}]*)?\}\}/gi, (_, n, max) => `${decimal(n)}/${max}`);
  s = s.replace(/\{\{\s*(?:nowrap|nobr)\s*\|([^{}]*)\}\}/gi, "$1");
  s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = cleanName(s).replace(/(\d)\.(\d)/g, "$1,$2").replace(/\s*\/\s*/g, "/");
  return s.length > 0 && s.length <= 25 ? s : "";
}

// Nombres de los agregadores en los campos cortos de la plantilla.
const AGGREGATORS = { MC: "Metacritic", ADM: "AnyDecentMusic?", AOTY: "Album of the Year" };

// Notas de la plantilla de críticas de un wikitexto: { aggregates: [{ name, score }], reviews: [...] }.
// null si no hay plantilla o no tiene notas.
export function parseRatings(wikitext) {
  const text = String(wikitext || "");
  const match = /\{\{\s*(?:music|album) ratings\b/i.exec(text);
  if (!match) return null;
  const block = balanced(text, match.index);
  if (!block) return null;
  const params = {};
  for (const part of splitParams(block.slice(2, -2)).slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1);
  }
  const aggregates = [];
  for (const [key, name] of Object.entries(AGGREGATORS)) {
    const score = cleanScore(params[key.toLowerCase()]);
    if (score) aggregates.push({ name, score });
  }
  const reviews = [];
  for (const kind of ["agg", "rev"]) {
    for (let i = 1; i <= 40; i += 1) {
      const name = cleanName(params[`${kind}${i}`] || "");
      const score = cleanScore(params[`${kind}${i}score`]);
      if (!name || !score) continue;
      const list = kind === "agg" ? aggregates : reviews;
      if (!list.some((r) => r.name === name)) list.push({ name, score });
    }
  }
  return aggregates.length || reviews.length ? { aggregates, reviews } : null;
}

async function wikitext(title) {
  const data = await wikiJson("en.wikipedia.org", { action: "parse", page: title, prop: "wikitext", redirects: "1", formatversion: "2" });
  return data.parse ? { title: data.parse.title, text: data.parse.wikitext } : null;
}

// Busca el artículo del álbum en la Wikipedia en inglés y lee sus notas. null si no hay.
async function fetchRatings(release) {
  const artist = cleanArtist(release.artist);
  const title = coreTitle(release.title);
  const links = await wikidataArticles([release.masterId && `P1954=${release.masterId}`, release.id && `P2206=${release.id}`]).catch(() => []);
  let pageTitle = (links.find((a) => a.lang === "en") || {}).title;
  if (!pageTitle && artist && !/^various$/i.test(artist)) {
    const found = await searchArticle("en", `${title} ${artist} album`, [coreArtist(artist), title]);
    // Solo vale si el artículo es del disco (lleva su título), no del artista u otro álbum.
    if (found && plain(found.title).includes(plain(title))) pageTitle = found.title;
  }
  if (!pageTitle) return { v: RATINGS_VERSION, ratings: null };
  const page = await wikitext(pageTitle);
  const ratings = page && parseRatings(page.text);
  return { v: RATINGS_VERSION, ratings: ratings && { ...ratings, source: { title: page.title, url: wikiUrl("en", page.title) } } };
}

// Devuelve { aggregates, reviews, source: { title, url } } o null.
export async function loadRatings(release) {
  const key = release.masterId ? `m${release.masterId}` : `r${release.id}`;
  const value = await cloudCached("ratings", key, MONTH_MS, () => fetchRatings(release), (v) => v && v.v === RATINGS_VERSION);
  return (value && value.ratings) || null;
}
