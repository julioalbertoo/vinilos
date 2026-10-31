// «¿Sabías que…?» de la ficha: un dato curioso del disco, de esta edición en vinilo o de una canción.
// Nunca se enseña nada sin fuente. Por orden:
// 1. Reserva: cada consulta pide varios datos; los que no se enseñan se guardan para las próximas
//    veces (sin gastar cupo).
// 2. Gemini con la búsqueda de Google: Google dice qué páginas respaldan cada frase
//    (groundingMetadata); el dato solo vale si sus frases están respaldadas.
// 3. Si la búsqueda no tiene cupo: textos que la app lee ella misma. Primero los del disco (Wikipedia
//    del álbum en castellano, inglés u otro idioma, localizada con Wikidata; notas de esta edición y de la
//    original en Discogs; MusicBrainz; TheAudioDB; una canción en Wikipedia o en Genius). Si no salen,
//    los del artista (Wikipedia, TheAudioDB, Discogs) y la historia del sello. Gemini elige un dato y copia la frase que lo prueba; solo vale si esa frase está en el texto.
// Para no repetir, se le pasan a la IA los datos ya contados de ese álbum.
import { askWithGoogleSearch, askPlain } from "./ai.js";
import { getArtist, masterMainNotes, getLabelProfile } from "./discogs.js";
import { geniusSongStory } from "./genius.js";
import { audioDbAlbum, audioDbArtist } from "./audiodb.js";
import { mbAlbumAnnotation } from "./musicbrainz.js";
import { cloudCached, MONTH_MS } from "./details.js";

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

function editionLine(release) {
  const label = (release.labels || [])[0];
  return [label && label.name, label && label.catno, release.country, release.year].filter(Boolean).join(", ");
}

// Datos por consulta. La búsqueda de Google pide más: su cupo es pequeño y los que sobran se guardan.
const FACTS_PER_CALL = 3;
const FACTS_PER_SEARCH = 6;

function buildPrompt(release, topic, seen) {
  const format = (release.formats || []).map((f) => [f.name, ...(f.descriptions || []), f.text].filter(Boolean).join(", ")).join(" + ");
  const tracks = (release.tracklist || []).map((t) => t.title).filter(Boolean).slice(0, 30).join("; ");
  const lines = [
    `Busca en internet ${FACTS_PER_SEARCH} datos curiosos, sorprendentes y poco conocidos, distintos entre sí, sobre ${topic} o, si no hay bastantes, sobre el disco en general.`,
    "",
    "El disco:",
    `- Artista: ${release.artist || "?"}`,
    `- Título: ${release.title || "?"}`,
    release.originalYear ? `- Año del álbum original: ${release.originalYear}` : null,
    `- Esta edición: ${editionLine(release) || "?"}`,
    format ? `- Formato: ${format}` : null,
    tracks ? `- Canciones: ${tracks}` : null,
    "",
    "Reglas:",
    "- Usa solo lo que digan las páginas que encuentres. No añadas nada de memoria ni supongas.",
    "- Escribe en castellano. Cada dato en su propia línea, empezando por «- », en 1 a 3 frases y como mucho 60 palabras.",
    "- Sin introducción («¿Sabías que…?», «Un dato curioso…»), sin markdown y sin citar las fuentes en el texto.",
    seen.length ? "- No repitas ninguno de estos datos, ya contados:\n" + seen.map((t) => `  · ${t}`).join("\n") : null,
    `- Si no encuentras nada respaldado por páginas fiables, responde solo: ${NO_FACT}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

const squash = (text) => String(text || "").replace(/\s+/g, " ").trim();

// Texto de la respuesta (sin los «pensamientos» del modelo), con sus saltos de línea.
function rawAnswer(candidate) {
  const parts = (candidate.content && candidate.content.parts) || [];
  return parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
}

const tidy = (text) =>
  squash(
    String(text || "")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "")
  );

// Datos de una respuesta con búsqueda de Google: cada línea es un dato, y solo vale si sus frases
// están respaldadas por páginas (al menos MIN_COVERAGE del texto). Devuelve [{ text, sources }].
function groundedFacts(candidate) {
  const meta = candidate.groundingMetadata || {};
  const chunks = meta.groundingChunks || [];
  const supports = (meta.groundingSupports || []).filter((s) => (s.groundingChunkIndices || []).length && s.segment && s.segment.text);
  const raw = rawAnswer(candidate);
  if (!raw || raw.includes(NO_FACT)) return [];
  const lines = raw
    .split(/\n+/)
    .map((line) => squash(line.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "")))
    .filter((line) => line.length > 20);
  const facts = [];
  for (const line of lines) {
    const mine = supports.filter((s) => line.includes(squash(s.segment.text)));
    const covered = new Set(mine.map((s) => squash(s.segment.text)));
    const coverage = Math.min(1, [...covered].reduce((sum, t) => sum + t.length, 0) / line.length);
    const sources = [];
    for (const i of mine.flatMap((s) => s.groundingChunkIndices)) {
      const web = chunks[i] && chunks[i].web;
      if (!web || !web.uri || !/^https:\/\//.test(web.uri)) continue;
      const title = String(web.title || web.domain || "Fuente").trim();
      if (!sources.some((s) => s.title === title)) sources.push({ title, url: web.uri });
    }
    if (sources.length && coverage >= MIN_COVERAGE) facts.push({ text: tidy(line), sources: sources.slice(0, MAX_SOURCES) });
  }
  return facts;
}

const ATTEMPTS = 2;

// ---------- Reserva de datos ya comprobados ----------

const POOL_KEY = "vinilos_trivia_pool";
// Los enlaces de Google caducan con el tiempo: la reserva dura pocos días.
const POOL_MAX_AGE = 3 * 24 * 3600 * 1000;
const POOL_MAX = 12;

function readPool() {
  try {
    return JSON.parse(localStorage.getItem(POOL_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writePool(pool) {
  const now = Date.now();
  for (const [key, list] of Object.entries(pool)) {
    pool[key] = list.filter((f) => now - new Date(f.at).getTime() < POOL_MAX_AGE);
    if (!pool[key].length) delete pool[key];
  }
  try {
    localStorage.setItem(POOL_KEY, JSON.stringify(pool));
  } catch {
    // Sin espacio: se perderá la reserva, nada más.
  }
}

function savePool(release, facts) {
  if (!facts.length) return;
  const pool = readPool();
  const key = discKey(release);
  const at = new Date().toISOString();
  pool[key] = [...(pool[key] || []), ...facts.map((f) => ({ ...f, at }))].slice(-POOL_MAX);
  writePool(pool);
}

function takeFromPool(release, seen) {
  const pool = readPool();
  const key = discKey(release);
  const list = (pool[key] || []).filter((f) => Date.now() - new Date(f.at).getTime() < POOL_MAX_AGE);
  const index = list.findIndex((f) => !seen.includes(f.text.slice(0, 220)));
  if (index === -1) return null;
  const [fact] = list.splice(index, 1);
  pool[key] = list;
  writePool(pool);
  return fact;
}

// ---------- Plan B: textos que lee la propia app ----------

// Textos que se leen como mucho: del disco y, si ninguno da un dato, del artista y el sello.
const DOC_ATTEMPTS = 4;
const ARTIST_ATTEMPTS = 2;
const DOC_WINDOW = 9000;

// Minúsculas, sin acentos, comillas ni signos raros y con los espacios juntos, para comparar textos.
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

const words = (text) => plain(text).match(/[a-z0-9]+/g) || [];

// «Prince (2)» o «Siouxsie*» en Discogs → «Prince», «Siouxsie».
const cleanArtist = (name) => String(name || "").replace(/\s*\(\d+\)/g, "").replace(/\*/g, "").trim();
// Título sin lo que va entre paréntesis («Abbey Road (Remastered)» → «Abbey Road»).
const coreTitle = (title) => String(title || "").replace(/\s*[([].*?[)\]]/g, "").trim() || String(title || "");
// Nombre del artista sin «The» delante, para que «The Beatles» y «Beatles» cuenten igual.
const coreArtist = (name) => cleanArtist(name).replace(/^(the|los|las|el|la)\s+/i, "").replace(/,\s*(the|los|las|el|la)$/i, "");

async function wikiJson(host, params) {
  const query = new URLSearchParams({ ...params, format: "json", origin: "*" });
  const response = await fetch(`https://${host}/w/api.php?${query}`);
  if (!response.ok) throw new Error(`${host} respondió ${response.status}`);
  return response.json();
}

async function wikiText(lang, params) {
  const data = await wikiJson(`${lang}.wikipedia.org`, { action: "query", prop: "extracts", explaintext: "1", redirects: "1", ...params });
  const page = Object.values((data.query && data.query.pages) || {})[0];
  return page && page.extract && !("missing" in page) ? { title: page.title, text: page.extract } : null;
}

const wikiUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

// Idiomas de Wikipedia que se leen. Además del castellano y el inglés, otros donde muchos grupos
// están mejor contados (los de su país). Gemini traduce el dato al castellano.
const MAIN_LANGS = ["es", "en"];
const OTHER_LANGS = ["de", "fr", "it", "pt"];
const LANG_NAMES = { de: "alemán", fr: "francés", it: "italiano", pt: "portugués" };

// Artículos de Wikipedia de una ficha de Wikidata localizada por un número de Discogs:
// del álbum (P1954, master), de una edición (P2206) o del artista (P1953). [{ lang, title }].
async function wikidataArticles(claims) {
  for (const claim of claims.filter(Boolean)) {
    const found = await wikiJson("www.wikidata.org", { action: "query", list: "search", srsearch: `haswbstatement:${claim}`, srlimit: "1" });
    const hit = found.query && found.query.search && found.query.search[0];
    if (!hit) continue;
    const langs = [...MAIN_LANGS, ...OTHER_LANGS];
    const entity = await wikiJson("www.wikidata.org", { action: "wbgetentities", ids: hit.title, props: "sitelinks", sitefilter: langs.map((l) => `${l}wiki`).join("|") });
    const links = (entity.entities && entity.entities[hit.title] && entity.entities[hit.title].sitelinks) || {};
    return langs.filter((lang) => links[`${lang}wiki`]).map((lang) => ({ lang, title: links[`${lang}wiki`].title }));
  }
  return [];
}

// Primer artículo de una búsqueda que hable de verdad de ese disco o canción (nombra al artista y el título).
async function searchArticle(lang, search, mustHave) {
  const found = await wikiJson(`${lang}.wikipedia.org`, { action: "query", list: "search", srsearch: search, srlimit: "3" });
  for (const hit of (found.query && found.query.search) || []) {
    const page = await wikiText(lang, { pageids: String(hit.pageid) });
    if (!page || page.text.length < 400) continue;
    const head = plain(`${page.title} ${page.text.slice(0, 2000)}`);
    if (mustHave.every((w) => head.includes(plain(w)))) return { ...page, lang };
  }
  return null;
}

const shuffle = (list) => list.sort(() => Math.random() - 0.5);

// Planes de Wikipedia para un tema (álbum o artista): en castellano y en inglés (por Wikidata o, si no,
// buscando) y uno en otro idioma (solo si Wikidata lo enlaza: buscar a ciegas en alemán sería un lío).
function wikiPlans(links, search, topic, focus) {
  const plans = shuffle([...MAIN_LANGS]).map((lang) => async () => {
    const link = (await links()).find((a) => a.lang === lang);
    const page = link ? await wikiText(lang, { titles: link.title }) : await search(lang);
    return page && { name: `Wikipedia (${lang}): ${page.title}`, url: wikiUrl(lang, page.title), text: page.text, topic, focus };
  });
  plans.push(async () => {
    const others = (await links()).filter((a) => OTHER_LANGS.includes(a.lang));
    if (!others.length) return null;
    const link = pick(others);
    const page = await wikiText(link.lang, { titles: link.title });
    return page && { name: `Wikipedia (${LANG_NAMES[link.lang]}): ${page.title}`, url: wikiUrl(link.lang, page.title), text: page.text, topic, focus };
  });
  return plans;
}

// Fuentes posibles, en orden y sin pedirlas todavía (cada una es una función que trae su texto).
// Cada fuente: { name, url, text, topic, focus? }. Si una fuente falla o no tiene texto, se pasa a la siguiente.
function documentPlans(release, { discogsToken, geniusToken }) {
  const artist = cleanArtist(release.artist);
  const title = coreTitle(release.title);
  const album = "este álbum, su grabación, su portada o esta edición en vinilo";
  const tracks = (release.tracklist || []).map((t) => coreTitle(t.title)).filter((t) => t && t.length > 2);
  const mainArtist = (release.artists || [])[0];
  const isVarious = !artist || /^various$/i.test(artist);
  const enough = (text, min = 150) => String(text || "").length >= min;

  // --- Del disco ---
  let albumLinks = null;
  const albumArticles = () =>
    (albumLinks = albumLinks || wikidataArticles([release.masterId && `P1954=${release.masterId}`, release.id && `P2206=${release.id}`]).catch(() => []));
  const [mainAlbumArticle, ...otherAlbumArticles] = wikiPlans(
    albumArticles,
    (lang) => searchArticle(lang, `${title} ${artist} ${lang === "es" ? "álbum" : "album"}`, [coreArtist(artist), title]),
    album
  );
  const albumPlans = [...otherAlbumArticles];

  // Notas de esta edición en Discogs (prensaje, grabación, créditos…).
  if (enough(release.notes)) {
    const url = /^https:\/\//.test(release.url || "") ? release.url : `https://www.discogs.com/release/${release.id}`;
    albumPlans.push(async () => ({ name: "Discogs: notas de esta edición", url, text: release.notes, topic: "esta edición en vinilo" }));
  }

  if (release.masterId) {
    // Notas de la edición principal del álbum (casi siempre la primera, la más documentada).
    albumPlans.push(async () => {
      const main = await cloudCached("mainNotes", `${release.masterId}|${release.id}`, MONTH_MS, () => masterMainNotes(release.masterId, discogsToken, release.id));
      return main && enough(main.text) && { name: `Discogs: notas de la edición original${main.where ? ` (${main.where})` : ""}`, url: main.url, text: main.text, topic: album };
    });
    // Nota del álbum en MusicBrainz (pocos la tienen, pero suele ser buena).
    albumPlans.push(async () => {
      const note = await cloudCached("mbAnnotation", release.masterId, MONTH_MS, () => mbAlbumAnnotation(release.masterId));
      return note && enough(note.text) && { name: `MusicBrainz: ${note.title || title}`, url: note.url, text: note.text, topic: album };
    });
  }

  if (!isVarious) {
    // Reseña del álbum en TheAudioDB.
    albumPlans.push(async () => {
      const found = await cloudCached("audioDbAlbum", `${artist}|${title}`.toLowerCase(), MONTH_MS, () => audioDbAlbum(artist, title));
      return found && enough(found.text) && { name: `TheAudioDB: ${found.title}`, url: found.url, text: found.text, topic: album };
    });
  }

  // Una canción al azar en Wikipedia.
  if (tracks.length) {
    const track = pick(tracks);
    albumPlans.push(async () => {
      const page =
        (await searchArticle("en", `${track} ${artist} song`, [coreArtist(artist), track])) ||
        (await searchArticle("es", `${track} ${artist} canción`, [coreArtist(artist), track]));
      return page && { name: `Wikipedia: ${page.title}`, url: wikiUrl(page.lang, page.title), text: page.text, topic: `la canción «${track}»` };
    });
  }

  // Otra canción al azar en Genius (si hay llave de Genius).
  if (tracks.length && geniusToken && !isVarious) {
    const track = pick(tracks);
    albumPlans.push(async () => {
      const story = await cloudCached("genius", `${artist}|${track}`.toLowerCase(), MONTH_MS, () => geniusSongStory(geniusToken, artist, track));
      return story && enough(story.text, 120) && { name: `Genius: ${story.title}`, url: story.url, text: story.text, topic: `la canción «${track}»` };
    });
  }

  // Un poco de azar en el orden, pero el artículo del álbum casi siempre primero (es el más completo).
  const ordered = Math.random() < 0.7 ? [mainAlbumArticle, ...shuffle(albumPlans)] : shuffle([mainAlbumArticle, ...albumPlans]);

  // --- Último recurso: el artista y el sello ---
  // Sirve para discos nuevos o poco conocidos, sin textos propios. Se lee de preferencia el trozo que nombra el disco.
  const artistTopic = `${artist} (mejor si tiene que ver con «${title}» o con su época)`;
  const artistPlans = [];
  if (!isVarious) {
    let artistLinks = null;
    const artistArticles = () =>
      (artistLinks = artistLinks || wikidataArticles([mainArtist && mainArtist.id && `P1953=${mainArtist.id}`]).catch(() => []));
    artistPlans.push(
      ...wikiPlans(
        artistArticles,
        (lang) => searchArticle(lang, `${artist} ${lang === "es" ? "músico banda" : "band musician"}`, [coreArtist(artist)]),
        artistTopic,
        title
      )
    );
    artistPlans.push(async () => {
      const found = await cloudCached("audioDbArtist", artist.toLowerCase(), MONTH_MS, () => audioDbArtist(artist));
      return found && enough(found.text, 200) && { name: `TheAudioDB: ${found.title}`, url: found.url, text: found.text, topic: artistTopic, focus: title };
    });
  }
  if (mainArtist && mainArtist.id) {
    artistPlans.push(async () => {
      const info = await cloudCached("artistInfo", mainArtist.id, MONTH_MS, () => getArtist(mainArtist.id, discogsToken));
      return enough(info.profile, 200) && { name: `Discogs: ${cleanArtist(info.name)}`, url: info.url, text: info.profile, topic: artistTopic, focus: title };
    });
  }
  const label = (release.labels || []).find((l) => l.id);
  if (label) {
    artistPlans.push(async () => {
      const found = await cloudCached("label", label.id, MONTH_MS, () => getLabelProfile(label.id, discogsToken));
      return found && enough(found.text, 200) && { name: `Discogs: sello ${cleanArtist(found.name)}`, url: found.url, text: found.text, topic: `el sello ${cleanArtist(found.name)}, que publicó esta edición` };
    });
  }
  // Del artista, casi siempre primero su Wikipedia (la más completa).
  const [mainArtistArticle, ...otherArtistPlans] = artistPlans;
  const artistOrdered = mainArtistArticle && Math.random() < 0.7 ? [mainArtistArticle, ...shuffle(otherArtistPlans)] : shuffle(artistPlans);
  return [
    { plans: ordered, max: DOC_ATTEMPTS },
    { plans: artistOrdered, max: ARTIST_ATTEMPTS },
  ];
}

// Trozo al azar del texto (empezando en un párrafo), para que cada vez salga un dato distinto.
// Con focus (el título del disco), casi siempre empieza en un párrafo que lo nombra.
function randomWindow(text, focus) {
  if (text.length <= DOC_WINDOW) return text;
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1 && i < text.length - 2000; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  const key = focus && plain(focus).length >= 3 ? plain(focus) : "";
  const near = key ? starts.filter((s) => plain(text.slice(s, text.indexOf("\n", s) === -1 ? undefined : text.indexOf("\n", s))).includes(key)) : [];
  const pool = near.length && Math.random() < 0.8 ? near : starts;
  const start = pool[Math.floor(Math.random() * pool.length)];
  return text.slice(start, start + DOC_WINDOW);
}

function docPrompt(release, doc, excerpt, seen) {
  return [
    `Te doy un texto (${doc.name}) relacionado con el disco «${release.title}» de ${cleanArtist(release.artist)}.`,
    `Elige hasta ${FACTS_PER_CALL} datos curiosos, sorprendentes y poco conocidos, distintos entre sí, sobre ${doc.topic}, que aparezcan en el texto.`,
    "Devuelve SOLO un JSON, sin texto alrededor:",
    '{"datos": [{"dato": "el dato en castellano, 1 a 3 frases, como mucho 60 palabras, sin introducción ni markdown", "cita": "la frase del texto que lo demuestra, copiada tal cual, en su idioma original"}]}',
    "Usa solo lo que dice el texto; no añadas nada de memoria.",
    seen.length ? "No repitas ninguno de estos datos, ya contados:\n" + seen.map((t) => `· ${t}`).join("\n") : null,
    'Si el texto no tiene nada curioso, devuelve {"datos": []}.',
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

// Frase (o par de frases seguidas) del texto que más se parece a la cita. Vale si contiene al menos
// el 85 % de sus palabras: la IA a veces cambia una coma o unas comillas, pero no se inventa la frase.
function findQuote(cita, excerpt) {
  const target = [...new Set(words(cita).filter((w) => w.length > 2))];
  if (target.length < 5) return null;
  const sentences = excerpt.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const score = (text) => {
    const have = new Set(words(text));
    return target.filter((w) => have.has(w)).length / target.length;
  };
  let best = null;
  let bestScore = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const one = score(sentences[i]);
    // La cita puede ocupar dos frases seguidas: el enlace lleva a la que más se parece.
    const two = sentences[i + 1] ? score(`${sentences[i]} ${sentences[i + 1]}`) : 0;
    if (Math.max(one, two) > bestScore) {
      bestScore = Math.max(one, two);
      best = two > one && score(sentences[i + 1]) > one ? sentences[i + 1] : sentences[i];
    }
  }
  return bestScore >= 0.85 ? best : null;
}

// El dato solo vale si su cita está en el texto y sus cifras (años, puestos…) también.
function verifiedFacts(answer, excerpt) {
  const list = Array.isArray(answer && answer.datos) ? answer.datos : answer && answer.dato ? [answer] : [];
  const source = plain(excerpt);
  const facts = [];
  for (const item of list) {
    const dato = tidy(item && item.dato);
    if (!dato) continue;
    const quote = findQuote(String((item && item.cita) || ""), excerpt);
    if (!quote) continue;
    if ((dato.match(/\d+/g) || []).some((n) => !source.includes(n))) continue;
    facts.push({ text: dato, quote });
  }
  return facts;
}

// Enlace que abre la página justo en la frase citada (Safari y Chrome la resaltan).
function quoteLink(url, quote) {
  if (!/wikipedia\.org/.test(url)) return url;
  const start = quote.split(/\s+/).slice(0, 8).join(" ");
  const fragment = encodeURIComponent(start).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  return `${url}#:~:text=${fragment}`;
}

// Devuelve { ok: true, facts } o { ok: false, quota, stop, detail, tried }.
async function documentTrivia(release, aiKey, keys, seen, onStep) {
  const tried = [];
  // Si los textos del disco no dan un dato, se sigue con los del artista, con su propio tope.
  for (const group of documentPlans(release, keys)) {
    let calls = 0;
    for (const plan of group.plans) {
      if (calls >= group.max) break;
      let doc = null;
      try {
        doc = await plan();
      } catch {
        doc = null;
      }
      if (!doc) continue;
      const excerpt = randomWindow(doc.text, doc.focus);
      calls += 1;
      tried.push(doc.name);
      const answer = await askPlain(docPrompt(release, doc, excerpt, seen), aiKey, (model) => onStep(`Leyendo ${doc.name} con ${model}…`));
      if (!answer.ok) return { ok: false, quota: answer.quota, stop: answer.stop, detail: answer.detail, tried };
      const facts = verifiedFacts(parseJson(rawAnswer(answer.candidate)), excerpt).filter((f) => !seen.includes(f.text.slice(0, 220)));
      if (facts.length) {
        return { ok: true, facts: facts.map((f) => ({ text: f.text, sources: [{ title: doc.name, url: quoteLink(doc.url, f.quote) }] })) };
      }
    }
  }
  return { ok: false, tried };
}

// ---------- Dato curioso ----------

function show(release, facts, extra = {}) {
  const [first, ...rest] = facts;
  rememberFact(release, first.text.slice(0, 220));
  savePool(release, rest);
  return { ok: true, text: first.text, sources: first.sources, searchHtml: "", ...extra };
}

// Devuelve { ok: true, text, sources, searchHtml, note } o { ok: false, message }. note: por qué el
// dato no sale de la búsqueda de Google. onStep(texto): en qué paso va.
// keys: { discogsToken, geniusToken } para las fuentes del plan B.
export async function loadTrivia(release, aiKey, onStep = () => {}, keys = {}) {
  if (!aiKey) return { ok: false, message: "Hace falta la llave de Google Gemini para buscar datos curiosos." };
  const seen = readSeen()[discKey(release)] || [];

  // 1. Un dato ya comprobado que quedó guardado de otra vez.
  const saved = takeFromPool(release, seen);
  if (saved) {
    rememberFact(release, saved.text.slice(0, 220));
    return { ok: true, text: saved.text, sources: saved.sources, searchHtml: "" };
  }

  // 2. Gemini con la búsqueda de Google.
  let why = "";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const answer = await askWithGoogleSearch(buildPrompt(release, chooseTopic(release), seen), aiKey, (model) =>
      onStep(`Buscando en Google con ${model}…`)
    );
    if (!answer.ok) {
      if (answer.stop) return { ok: false, message: answer.detail };
      why = answer.quota
        ? "la búsqueda de Google de Gemini no tiene cupo ahora"
        : `la búsqueda de Google de Gemini falló (${answer.detail.split(" · ")[0].slice(0, 140)})`;
      break;
    }
    const facts = groundedFacts(answer.candidate).filter((f) => !seen.includes(f.text.slice(0, 220)));
    if (facts.length) {
      const meta = answer.candidate.groundingMetadata || {};
      return show(release, facts, { searchHtml: (meta.searchEntryPoint && meta.searchEntryPoint.renderedContent) || "" });
    }
    why = "Google no encontró páginas que respaldaran un dato nuevo";
  }

  // 3. Textos que lee la propia app: Wikipedia y las notas de Discogs.
  onStep("Buscando en Wikipedia, Discogs y otras fuentes…");
  const docs = await documentTrivia(release, aiKey, keys, seen, onStep);
  if (docs.ok) return show(release, docs.facts, { note: `Sin búsqueda de Google: ${why}.` });
  if (docs.stop) return { ok: false, message: docs.detail };
  if (docs.quota) return { ok: false, message: `${capital(why)}, y Gemini está sin cupo o saturado en todos sus modelos. Inténtalo en un rato.` };
  const read = docs.tried.length ? `He leído ${docs.tried.join(", ")}, pero no salió un dato comprobable.` : "No encontré textos sobre este disco ni sobre el artista en Wikipedia, Discogs, MusicBrainz ni TheAudioDB.";
  return { ok: false, message: `${capital(why)}. ${read} Prueba con «Otro dato».` };
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
