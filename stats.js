// Pestaña «Datos» de «Mis discos»: valor estimado, géneros, duración, años, portadas, mapa, curiosidades…
// Lo que no está en el historial (géneros, país, precios, canciones…) sale de la ficha de Discogs de cada disco.
// Se guarda un resumen pequeño en el móvil; con cuenta, se leen de golpe las fichas guardadas en la nube
// y lo que falte se pide a Discogs poco a poco, en segundo plano, mientras la pestaña está abierta.
import { CONFIG } from "./config.js";
import { cachedRelease, cachedPrices } from "./details.js";
import { loadDetailSummaries, cloudUser } from "./cloud.js";
import { releaseWeight, isHeavy, countryFlag, countryCodes } from "./discogs.js";
import {
  el, card, tile, note, hint, pill, plural, level, legend, segmented, coverStrip, rankList, podium, factGrid, navBar,
  genreVinylCard, rainbowCard, coverColor, durationCard, timelineCard, mapCard,
} from "./charts.js";

const CACHE_KEY = CONFIG.STORAGE_KEYS.statsCache;
const PRICES_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Sube cuando el resumen guarda campos nuevos: los resúmenes antiguos se rehacen (2: canciones y duración).
const SUMMARY_VERSION = 2;
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

// Lo que interesa de una ficha (completa, o el resumen que llega de la nube).
function summarize(source) {
  const community = source.community || null;
  const labels = Array.isArray(source.labels) ? source.labels : [];
  const formats = Array.isArray(source.formats) ? source.formats : [];
  const tracks = (Array.isArray(source.tracklist) ? source.tracklist : []).filter((t) => !t.type_ || t.type_ === "track");
  const timed = tracks.map((t) => seconds(t.duration)).filter((s) => s > 0);
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

function needsWork(item) {
  const id = String(item.release_id);
  if (failed.has(id)) return false;
  const entry = cache[id];
  return !entry || !entry.dataAt || entry.v !== SUMMARY_VERSION || !isFresh(entry.pricesAt);
}

async function runFill() {
  running = true;
  try {
    // Primero lo que haya en la nube: suele traerlo casi todo sin preguntar a Discogs.
    if (await primeFromCloud()) latest.onUpdate();
    while (active && latest.token) {
      const { items, token } = latest;
      const pending = items.filter(needsWork);
      if (!pending.length) break;
      const item = pending[0];
      const id = String(item.release_id);
      latest.onStatus(`🔄 Completando datos con Discogs… ${items.length - pending.length + 1} de ${items.length}`);
      const entry = cache[id] || {};
      try {
        if (!entry.dataAt || entry.v !== SUMMARY_VERSION) {
          // Con cuenta, la ficha suele salir de la nube sin preguntar a Discogs.
          const release = await cachedRelease(item.release_id, token);
          Object.assign(entry, summarize(release), { dataAt: entry.dataAt || new Date().toISOString() });
        }
        if (!isFresh(entry.pricesAt)) {
          const { prices, at } = await cachedPrices(item.release_id, token);
          Object.assign(entry, { prices, pricesAt: at });
        }
      } catch (err) {
        failed.add(id);
        if (err.authError) {
          latest.onStatus("❌ El token de Discogs no es válido: revisa tus llaves en Ajustes.");
          return;
        }
      }
      cache[id] = entry;
      writeCache();
      if (active) latest.onUpdate();
    }
    latest.onStatus(latest.token ? "" : "Añade tu token de Discogs en Ajustes para ver precios, géneros y duración.");
  } finally {
    running = false;
  }
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
  if (!coloring) runColors().catch(() => {});
}

// ---------- Cálculos ----------

const yearOf = (value) => {
  const n = Number.parseInt(value, 10);
  return n > 1800 && n < 2200 ? n : null;
};

// Precio estimado de un disco: el sugerido para VG+ (estado típico de un disco usado);
// si no hay, lo más barato a la venta; si no, otro sugerido.
function estimate(prices) {
  if (!prices) return null;
  const suggested = Array.isArray(prices.suggested) ? prices.suggested : [];
  const vgPlus = suggested.find((s) => s.grade === "VG+");
  const pick = vgPlus || prices.lowest || suggested[0];
  return pick && pick.value ? { value: Number(pick.value), currency: pick.currency || "EUR" } : null;
}

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
const picks = { country: null, artists: null, labels: null };

// Entradas de la barra de accesos, en el orden de la página.
const NAV = [
  ["value", "💶 Valor"],
  ["genres", "🎸 Géneros"],
  ["duration", "⏱️ Duración"],
  ["years", "📅 Años"],
  ["colors", "🌈 Colores"],
  ["map", "🌍 Mapa"],
  ["people", "🎤 Artistas"],
  ["fun", "✨ Curiosidades"],
  ["added", "🗓️ Añadidos"],
];

// Las cuatro cifras de arriba: discos, artistas, países y horas de música.
function summaryTiles(items, artists, countries, lengths) {
  const seconds = lengths.reduce((sum, r) => sum + r.seconds, 0);
  const music = !seconds ? "—" : seconds >= 3600 ? `${Math.round(seconds / 3600).toLocaleString("es-ES")} h` : `${Math.max(1, Math.round(seconds / 60))} min`;
  const box = el("div", "stats-tiles stats-summary");
  box.append(
    tile(items.length.toLocaleString("es-ES"), items.length === 1 ? "disco" : "discos", { icon: "💿", accent: "lilac" }),
    tile(artists.length.toLocaleString("es-ES"), artists.length === 1 ? "artista" : "artistas", { icon: "🎤", accent: "peach" }),
    tile(countries.length ? String(countries.length) : "—", countries.length === 1 ? "país" : "países", { icon: "🌍", accent: "sky" }),
    tile(music, "de música", { icon: "🎧", accent: "mint" })
  );
  return box;
}

function valueCard(data, items, onOpen) {
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
    note(
      `Con precio: ${data.priced.length} de ${items.length}. ` +
        "Es el precio sugerido por Discogs para un disco en estado VG+ (o el más barato a la venta)."
    )
  );
  box.classList.add("stats-card--hero");
  return box;
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

  return card(
    head,
    switcher,
    grid,
    legend(),
    picked,
    pill(`⭐ Tu década: ${decadeName(topDecade)} · ${plural(perDecade(topDecade), "disco", "discos")}`, "mint"),
    factGrid(facts, onOpen)
  );
}

// Artistas y sellos que más se repiten, con un selector para cambiar de uno a otro.
function peopleCard(artists, labels, byArtist, byLabel, rerender, onOpen) {
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
    if (singles) {
      nodes.push(note(isArtists ? `Y ${plural(singles, "artista", "artistas")} con un solo disco.` : `Y ${plural(singles, "sello", "sellos")} con un solo disco.`));
    }
  }
  return card({ icon: "🎤", title: "Artistas y sellos", sub: "Los que más se repiten en tu colección", accent: "peach", nav: "people" }, ...nodes);
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
  const months = new Map();
  for (const item of items) {
    if (!item.date) continue;
    const d = new Date(item.date);
    d.setHours(0, 0, 0, 0);
    if (d < start || d > today) continue;
    const key = d.toDateString();
    counts.set(key, (counts.get(key) || 0) + 1);
    const month = d.toLocaleDateString("es-ES", { month: "long" });
    months.set(month, (months.get(month) || 0) + 1);
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
  const best = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] > 1) nodes.push(pill(`📈 Tu mejor mes: ${best[0]} · ${plural(best[1], "disco", "discos")}`, "lilac"));
  return card({ icon: "🗓️", title: "Cuándo los añadiste", sub: "Cada casilla es un día", accent: "lilac", nav: "added" }, ...nodes);
}

function curiositiesCard(data, items, onOpen) {
  const facts = [];
  const withCommunity = data.withData.filter((r) => r.s.have !== null && r.s.have !== undefined);
  if (withCommunity.length) {
    const rarest = [...withCommunity].sort((a, b) => a.s.have - b.s.have)[0];
    facts.push({ icon: "💎", label: "El más raro", item: rarest.item, value: `lo tienen ${rarest.s.have.toLocaleString("es-ES")}` });
    const wanted = [...withCommunity].sort((a, b) => b.s.want - a.s.want)[0];
    facts.push({ icon: "🔥", label: "El más deseado", item: wanted.item, value: `lo buscan ${wanted.s.want.toLocaleString("es-ES")}` });
  }
  const rated = data.withData.filter((r) => r.s.rating && r.s.rating.count >= 3);
  if (rated.length) {
    const best = [...rated].sort((a, b) => b.s.rating.average - a.s.rating.average)[0];
    const stars = best.s.rating.average.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    facts.push({ icon: "⭐", label: "Mejor valorado", item: best.item, value: `${stars} de 5` });
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
    tile(String(gaps.length), gaps.length === 1 ? "reedición" : "reediciones", { icon: "🔁", accent: "mint" })
  );
  return card(
    { icon: "✨", title: "Curiosidades", sub: "Récords de tu colección según Discogs", accent: "butter", nav: "fun" },
    tiles,
    facts.length ? factGrid(facts, onOpen) : null
  );
}

// Pinta la pestaña «Datos». onOpen(item) abre la ficha de un disco.
export function renderStats(container, items, { discogsToken, onOpen, statusEl }) {
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

    const nodes = [summaryTiles(items, artists, countries, lengths), valueCard(data, items, onOpen)];

    // 🎸 Géneros como un vinilo, y los estilos debajo.
    if (genres.length) {
      const byGenre = groupBy(data.withData, (r) => r.s.genres);
      const genreCard = genreVinylCard(genres, byGenre, data.withData.length, draw, onOpen);
      if (styles.length) {
        genreCard.append(el("p", "stats-sub", "Estilos más repetidos"));
        const chips = el("div", "stats-chips");
        for (const [name, count] of styles.slice(0, 12)) {
          const chip = el("span", "stats-chip", name);
          chip.append(el("b", null, String(count)));
          chips.append(chip);
        }
        genreCard.append(chips);
      }
      const pending = items.length - data.withData.length;
      if (pending) genreCard.append(note(`Faltan datos de ${plural(pending, "disco", "discos")}.`));
      nodes.push(genreCard);
    }

    // ⏱️ Duración.
    nodes.push(durationCard(lengths, items.length, onOpen));

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

    // 🎤 Artistas y sellos.
    if (artists.length) {
      const byArtist = groupBy(data.rows, (r) => [cleanName(r.item.artist)]);
      const byLabel = groupBy(data.withData, (r) => [r.s.label]);
      nodes.push(peopleCard(artists, labels, byArtist, byLabel, draw, onOpen));
    }

    nodes.push(curiositiesCard(data, items, onOpen));
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
