// «¿Sabías que…?» de la ficha: un dato curioso del disco, de esta edición en vinilo o de una canción.
// Lo escribe Gemini con la búsqueda de Google activada. Google devuelve qué páginas respaldan cada
// frase (groundingMetadata): si el dato no viene respaldado por páginas reales, no se enseña.
// Si la búsqueda de Google no tiene cupo en ningún modelo, plan B: se lee un artículo de Wikipedia
// del disco o de una canción, la IA elige un dato y copia la frase que lo prueba, y solo se enseña si esa
// frase está, letra por letra, en el artículo (el enlace lleva justo a ella).
// Cada vez que se abre la ficha sale un dato nuevo: se le pasan a la IA los ya contados para que no los repita.
import { askWithGoogleSearch, askPlain } from "./ai.js";

const SEEN_KEY = "vinilos_trivia_seen";
const SEEN_PER_DISC = 10;
const SEEN_DISCS = 300;
// Parte mínima del texto que tiene que estar respaldada por alguna página.
const MIN_COVERAGE = 0.6;
const MAX_SOURCES = 4;
const NO_FACT = "SIN DATO";

function readSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

// Los datos son del álbum casi siempre, así que se agrupan por álbum (master) si lo hay.
const discKey = (release) => String(release.masterId || release.id);

function rememberFact(release, text) {
  const all = readSeen();
  const key = discKey(release);
  const list = [...(all[key] || []).filter((t) => t !== text), text].slice(-SEEN_PER_DISC);
  delete all[key];
  all[key] = list;
  // Se olvidan los discos más antiguos para no llenar el móvil.
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - SEEN_DISCS))) delete all[old];
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // Sin espacio: como mucho se repetirá algún dato.
  }
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Tema del dato, al azar, para que cada vez sea distinto.
function chooseTopic(release) {
  const tracks = (release.tracklist || []).map((t) => t.title).filter(Boolean);
  const label = (release.labels || [])[0];
  const edition = [label && label.name, label && label.catno, release.country, release.year].filter(Boolean).join(", ");
  const topics = [
    { weight: 3, text: `la canción «${pick(tracks)}» de este disco (su composición, grabación, letra o historia)`, ok: tracks.length > 0 },
    { weight: 2, text: "la grabación o la producción del álbum (estudio, músicos, productor, anécdotas de las sesiones)", ok: true },
    { weight: 2, text: `esta edición concreta en vinilo (${edition || "prensaje, sello y país"}): el prensaje, el sello, la fábrica, diferencias con otras ediciones o su rareza para coleccionistas`, ok: true },
    { weight: 1, text: "la portada o el diseño gráfico del disco (fotógrafo, diseñador, historia de la imagen)", ok: true },
    { weight: 1, text: "el lanzamiento y la recepción del álbum (ventas, listas, críticas, polémicas)", ok: true },
  ].filter((t) => t.ok);
  const total = topics.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const topic of topics) {
    roll -= topic.weight;
    if (roll <= 0) return topic.text;
  }
  return topics[0].text;
}

function buildPrompt(release, topic, seen) {
  const label = (release.labels || [])[0];
  const format = (release.formats || []).map((f) => [f.name, ...(f.descriptions || []), f.text].filter(Boolean).join(", ")).join(" + ");
  const tracks = (release.tracklist || []).map((t) => t.title).filter(Boolean).slice(0, 30).join("; ");
  const lines = [
    "Busca en internet un dato curioso, sorprendente y poco conocido sobre " + topic + ".",
    "",
    "El disco:",
    `- Artista: ${release.artist || "?"}`,
    `- Título: ${release.title || "?"}`,
    release.originalYear ? `- Año del álbum original: ${release.originalYear}` : null,
    `- Esta edición: ${[label && label.name, label && label.catno, release.country, release.year].filter(Boolean).join(", ") || "?"}`,
    format ? `- Formato: ${format}` : null,
    tracks ? `- Canciones: ${tracks}` : null,
    "",
    "Reglas:",
    "- Usa solo lo que digan las páginas que encuentres. No añadas nada de memoria ni supongas.",
    "- Escribe en castellano, en 1 a 3 frases y como mucho 60 palabras.",
    "- Sin introducción («¿Sabías que…?», «Un dato curioso…»), sin markdown y sin citar las fuentes en el texto.",
    seen.length ? "- No repitas ninguno de estos datos, ya contados:\n" + seen.map((t) => `  · ${t}`).join("\n") : null,
    `- Si no encuentras nada respaldado por páginas fiables, responde solo: ${NO_FACT}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

// Texto de la respuesta, sin los «pensamientos» del modelo ni restos de formato.
function answerText(candidate) {
  const parts = (candidate.content && candidate.content.parts) || [];
  return parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Comprueba que el texto está respaldado por páginas y devuelve las que lo respaldan.
function groundedSources(candidate, text) {
  const meta = candidate.groundingMetadata || {};
  const chunks = meta.groundingChunks || [];
  const supports = meta.groundingSupports || [];
  const used = [];
  const covered = new Set();
  for (const support of supports) {
    const indices = support.groundingChunkIndices || [];
    if (!indices.length) continue;
    const segment = (support.segment && support.segment.text) || "";
    if (segment) covered.add(segment.trim());
    for (const i of indices) if (!used.includes(i)) used.push(i);
  }
  const coveredLength = [...covered].reduce((sum, s) => sum + s.length, 0);
  const coverage = text.length ? Math.min(1, coveredLength / text.length) : 0;
  const sources = [];
  for (const i of used) {
    const web = chunks[i] && chunks[i].web;
    if (!web || !web.uri || !/^https:\/\//.test(web.uri)) continue;
    const title = String(web.title || web.domain || "Fuente").trim();
    if (sources.some((s) => s.title === title)) continue;
    sources.push({ title, url: web.uri });
  }
  return { coverage, sources: sources.slice(0, MAX_SOURCES), searchHtml: (meta.searchEntryPoint && meta.searchEntryPoint.renderedContent) || "" };
}

const ATTEMPTS = 2;

// ---------- Plan B: Wikipedia ----------

const WIKI_ATTEMPTS = 2;
const WIKI_WINDOW = 9000;

// Minúsculas, sin acentos ni comillas tipográficas y con los espacios juntos, para comparar textos.
const plain = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’´`]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

// «Prince (2)» o «Siouxsie*» en Discogs → «Prince», «Siouxsie».
const cleanArtist = (name) => String(name || "").replace(/\s*\(\d+\)/g, "").replace(/\*/g, "").trim();

async function wikiJson(lang, params) {
  const query = new URLSearchParams({ ...params, format: "json", origin: "*" });
  const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${query}`);
  if (!response.ok) throw new Error(`Wikipedia respondió ${response.status}`);
  return response.json();
}

// Primer artículo de la búsqueda que hable de verdad de ese disco o canción (nombra al artista y el título).
async function findArticle(lang, search, mustHave) {
  const found = await wikiJson(lang, { action: "query", list: "search", srsearch: search, srlimit: "3" });
  for (const hit of (found.query && found.query.search) || []) {
    const data = await wikiJson(lang, { action: "query", prop: "extracts", explaintext: "1", pageids: String(hit.pageid) });
    const page = data.query && data.query.pages && data.query.pages[hit.pageid];
    const text = page && page.extract;
    if (!text || text.length < 400) continue;
    const head = plain(`${hit.title} ${text.slice(0, 1500)}`);
    if (mustHave.every((word) => head.includes(plain(word)))) return { lang, title: hit.title, text };
  }
  return null;
}

// Trozo al azar del artículo (empezando en un párrafo), para que cada vez salga un dato distinto.
function randomWindow(text) {
  if (text.length <= WIKI_WINDOW) return text;
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1 && i < text.length - 2000; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const start = starts[Math.floor(Math.random() * starts.length)];
  return text.slice(start, start + WIKI_WINDOW);
}

function wikiPlans(release) {
  const artist = cleanArtist(release.artist);
  const tracks = (release.tracklist || []).map((t) => t.title).filter((t) => t && t.length > 2);
  const plans = [
    { lang: "es", search: `${release.title} ${artist} álbum`, must: [artist, release.title], topic: "este álbum o esta edición en vinilo" },
    { lang: "en", search: `${release.title} ${artist} album`, must: [artist, release.title], topic: "este álbum o esta edición en vinilo" },
  ];
  if (tracks.length) {
    const track = pick(tracks);
    plans.push(
      { lang: "en", search: `${track} ${artist} song`, must: [artist, track], topic: `la canción «${track}»` },
      { lang: "es", search: `${track} ${artist} canción`, must: [artist, track], topic: `la canción «${track}»` }
    );
  }
  // Orden al azar, para que no salga siempre del mismo artículo.
  return plans.sort(() => Math.random() - 0.5);
}

function wikiPrompt(release, topic, excerpt, seen) {
  return [
    `Te doy un fragmento de un artículo de Wikipedia relacionado con el disco «${release.title}» de ${cleanArtist(release.artist)}.`,
    `Elige UN dato curioso, sorprendente y poco conocido sobre ${topic} que aparezca en el texto.`,
    "Devuelve SOLO un JSON, sin texto alrededor:",
    '{"dato": "el dato en castellano, 1 a 3 frases, como mucho 60 palabras, sin introducción ni markdown", "cita": "la frase del texto que lo demuestra, copiada letra por letra, en su idioma original"}',
    "Usa solo lo que dice el texto; no añadas nada de memoria.",
    seen.length ? "No repitas ninguno de estos datos, ya contados:\n" + seen.map((t) => `· ${t}`).join("\n") : null,
    `Si el texto no tiene nada curioso, devuelve {"dato": null, "cita": null}.`,
    "",
    "Texto:",
    excerpt,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

function parseJson(text) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// El dato solo vale si la cita está tal cual en el artículo y sus cifras (años, puestos…) también.
function verifiedFact(answer, excerpt) {
  const dato = String((answer && answer.dato) || "").trim();
  const cita = String((answer && answer.cita) || "").trim().replace(/^["'«“]+|["'»”.]+$/g, "");
  if (!dato || cita.length < 25) return null;
  const source = plain(excerpt);
  if (!source.includes(plain(cita))) return null;
  const numbers = dato.match(/\d+/g) || [];
  if (numbers.some((n) => !source.includes(n))) return null;
  return { dato, cita };
}

// Enlace que abre el artículo justo en la frase citada (Safari y Chrome lo resaltan).
function wikiLink(article, cita) {
  const page = `https://${article.lang}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, "_"))}`;
  const words = cita.split(/\s+/).slice(0, 8).join(" ");
  const fragment = encodeURIComponent(words).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  return `${page}#:~:text=${fragment}`;
}

async function wikipediaTrivia(release, aiKey, seen) {
  let calls = 0;
  for (const plan of wikiPlans(release)) {
    if (calls >= WIKI_ATTEMPTS) break;
    let article = null;
    try {
      article = await findArticle(plan.lang, plan.search, plan.must);
    } catch {
      continue;
    }
    if (!article) continue;
    const excerpt = randomWindow(article.text);
    calls += 1;
    const answer = await askPlain(wikiPrompt(release, plan.topic, excerpt, seen), aiKey);
    if (!answer.ok) return { ok: false, quota: answer.quota, stop: answer.stop, detail: answer.detail };
    const fact = verifiedFact(parseJson(answerText(answer.candidate)), excerpt);
    if (!fact) continue;
    return {
      ok: true,
      text: fact.dato,
      sources: [{ title: `Wikipedia (${article.lang}): ${article.title}`, url: wikiLink(article, fact.cita) }],
      searchHtml: "",
    };
  }
  return { ok: false };
}

// ---------- Dato curioso ----------

// Devuelve { ok: true, text, sources, searchHtml } o { ok: false, message }.
export async function loadTrivia(release, aiKey) {
  if (!aiKey) return { ok: false, message: "Hace falta la llave de Google Gemini para buscar datos curiosos." };
  const seen = readSeen()[discKey(release)] || [];
  let lastProblem = "No se encontró un dato curioso con fuentes que lo respalden.";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const answer = await askWithGoogleSearch(buildPrompt(release, chooseTopic(release), seen), aiKey);
    if (!answer.ok) {
      if (answer.stop) return { ok: false, message: answer.detail };
      // Sin cupo de búsqueda en ningún modelo (o error): se pasa al plan B.
      lastProblem = answer.quota
        ? "La búsqueda de Google está sin cupo gratuito en todos los modelos de Gemini."
        : `No se pudo buscar el dato: ${answer.detail}.`;
      break;
    }
    const text = answerText(answer.candidate);
    if (!text || text.includes(NO_FACT)) continue;
    const grounded = groundedSources(answer.candidate, text);
    if (!grounded.sources.length || grounded.coverage < MIN_COVERAGE) {
      lastProblem = "La IA encontró algo, pero sin fuentes suficientes que lo respalden, así que no se enseña.";
      continue;
    }
    rememberFact(release, text.slice(0, 220));
    return { ok: true, text, sources: grounded.sources, searchHtml: grounded.searchHtml };
  }
  const wiki = await wikipediaTrivia(release, aiKey, seen);
  if (wiki.ok) {
    rememberFact(release, wiki.text.slice(0, 220));
    return wiki;
  }
  if (wiki.stop) return { ok: false, message: wiki.detail };
  if (wiki.quota) return { ok: false, message: "Gemini está sin cupo gratuito o saturado ahora mismo, en todos sus modelos. Inténtalo en un rato." };
  return { ok: false, message: `${lastProblem} Tampoco salió un dato comprobable en Wikipedia. Inténtalo en un rato.` };
}
