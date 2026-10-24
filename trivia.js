// «¿Sabías que…?» de la ficha: un dato curioso del disco, de esta edición en vinilo o de una canción.
// Lo escribe Gemini con la búsqueda de Google activada. Google devuelve qué páginas respaldan cada
// frase (groundingMetadata): si el dato no viene respaldado por páginas reales, no se enseña.
// Cada vez que se abre la ficha sale un dato nuevo: se le pasan a la IA los ya contados para que no los repita.
import { askWithGoogleSearch } from "./ai.js";

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

// Devuelve { ok: true, text, sources, searchHtml } o { ok: false, message }.
export async function loadTrivia(release, aiKey) {
  if (!aiKey) return { ok: false, message: "Hace falta la llave de Google Gemini para buscar datos curiosos." };
  const seen = readSeen()[discKey(release)] || [];
  let lastProblem = "No se encontró un dato curioso con fuentes que lo respalden.";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const answer = await askWithGoogleSearch(buildPrompt(release, chooseTopic(release), seen), aiKey);
    if (!answer.ok) {
      if (answer.stop) return { ok: false, message: answer.detail };
      if (answer.quota) return { ok: false, message: "Gemini está sin cupo gratuito o saturado ahora mismo. Inténtalo en un rato." };
      return { ok: false, message: `No se pudo buscar el dato: ${answer.detail}` };
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
  return { ok: false, message: lastProblem };
}
