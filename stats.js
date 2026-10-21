// Pestaña «Datos» de «Mis discos»: valor estimado, géneros, duración, años, portadas, mapa, curiosidades…
// Lo que no está en el historial (géneros, país, precios, canciones…) sale de la ficha de Discogs de cada disco.
// Se guarda un resumen pequeño en el móvil; con cuenta, se leen de golpe las fichas guardadas en la nube
// y lo que falte se pide a Discogs poco a poco, en segundo plano, mientras la pestaña está abierta.
import { CONFIG } from "./config.js";
import { cachedRelease, cachedPrices } from "./details.js";
import { loadDetailSummaries, cloudUser } from "./cloud.js";
import { releaseWeight, isHeavy, countryFlag, countryCodes } from "./discogs.js";
import {
  el, card, tile, mini, plural, level, legend,
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

function bars(entries, total, { max = 8, format = (k) => k } = {}) {
  const list = el("div", "stats-bars");
  const top = entries.slice(0, max);
  const peak = top.length ? top[0][1] : 1;
  for (const [key, count] of top) {
    const row = el("div", "stats-bar");
    const track = el("span", "stats-bar-track");
    const fill = el("span", "stats-bar-fill");
    fill.style.width = `${Math.max(4, (count / peak) * 100)}%`;
    track.append(fill);
    const pct = total ? Math.round((count / total) * 100) : 0;
    row.append(el("span", "stats-bar-name", format(key)), track, el("span", "stats-bar-count", `${count} · ${pct}%`));
    list.append(row);
  }
  if (entries.length > max) list.append(el("p", "stats-note", `y ${entries.length - max} más`));
  return list;
}

// Abre la ficha del disco de una fila .stats-mini tocada dentro de `list`.
function openable(list, items, onOpen) {
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".stats-mini");
    const item = row && items.find((i) => String(i.release_id) === row.dataset.id);
    if (item) onOpen(item);
  });
  return list;
}

// Estado de la pantalla que se mantiene entre repintados.
let yearMode = "original";
let selectedYear = null;

function yearsCard(data, rerender) {
  const switcher = el("div", "segmented segmented--small stats-switch");
  for (const [mode, text] of [["original", "Año original"], ["edition", "Año de tu edición"]]) {
    const button = el("button", mode === yearMode ? "active" : "", text);
    button.type = "button";
    button.setAttribute("aria-pressed", String(mode === yearMode));
    button.addEventListener("click", () => {
      if (yearMode === mode) return;
      yearMode = mode;
      selectedYear = null;
      rerender();
    });
    switcher.append(button);
  }

  const byYear = new Map();
  for (const r of data.rows) if (r.year) byYear.set(r.year, [...(byYear.get(r.year) || []), r.item]);
  const years = [...byYear.keys()];
  if (!years.length) return card("📅 Años", switcher, el("p", "stats-note", "Aún no se sabe el año de ningún disco."));

  const first = Math.floor(Math.min(...years) / 10) * 10;
  const last = Math.floor(Math.max(...years) / 10) * 10;
  const peak = Math.max(...[...byYear.values()].map((list) => list.length));

  const grid = el("div", "stats-years");
  const head = el("div", "stats-years-row stats-years-head");
  head.append(el("span", "stats-years-decade"));
  for (let d = 0; d < 10; d++) head.append(el("span", "stats-years-digit", String(d)));
  grid.append(head);

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
    grid.append(row);
  }

  const caption = el("p", "stats-caption");
  if (selectedYear) {
    const list = byYear.get(selectedYear) || [];
    caption.textContent = list.length
      ? `${selectedYear}: ${list.map((i) => `${i.title}${i.artist ? ` (${i.artist})` : ""}`).join(" · ")}`
      : `${selectedYear}: ningún disco`;
  } else {
    caption.textContent = "Toca una casilla para ver qué discos son de ese año.";
  }

  // Década favorita, el más antiguo y el más nuevo.
  const decades = countBy(data.rows.filter((r) => r.year).map((r) => `${Math.floor(r.year / 10) * 10}`));
  const sorted = data.rows.filter((r) => r.year).sort((a, b) => a.year - b.year);
  const facts = el("div", "stats-facts");
  if (decades.length) {
    facts.append(el("p", null, `⭐ Tu década: los ${decades[0][0].slice(2)} (${plural(decades[0][1], "disco", "discos")})`));
  }
  facts.append(
    el("p", null, `⏳ El más antiguo: ${sorted[0].item.title} (${sorted[0].year})`),
    el("p", null, `🆕 El más nuevo: ${sorted[sorted.length - 1].item.title} (${sorted[sorted.length - 1].year})`)
  );

  return card("📅 Años", switcher, grid, legend(), caption, facts);
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
  const months = el("div", "stats-calendar-months");
  months.append(
    el("span", null, start.toLocaleDateString("es-ES", { month: "short", year: "numeric" })),
    el("span", null, "hoy")
  );
  return card(
    "🗓️ Cuándo los añadiste",
    el("p", "stats-note", `${plural(total, "disco añadido", "discos añadidos")} en los últimos 6 meses`),
    grid,
    months,
    legend()
  );
}

function valueCard(data, items, onOpen) {
  const title = "💶 Valor estimado de tu colección";
  if (!data.totals.size) {
    return card(title, el("p", "stats-big", "—"), el("p", "stats-note", "Aún no hay precios. Se piden a Discogs poco a poco."));
  }
  const [mainCurrency] = [...data.totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const total = [...data.totals.entries()].map(([cur, v]) => money(v, cur)).join(" + ");
  const mainPriced = data.priced.filter((r) => r.price.currency === mainCurrency);
  const avg = data.totals.get(mainCurrency) / mainPriced.length;
  const nodes = [
    el("p", "stats-big", total),
    el(
      "p",
      "stats-note",
      `Media de ${money(avg, mainCurrency)} por disco · con precio: ${data.priced.length} de ${items.length}. ` +
        "Usa el precio sugerido por Discogs para un disco en estado VG+ (o el más barato a la venta)."
    ),
  ];
  const top = [...data.priced].sort((a, b) => b.price.value - a.price.value).slice(0, 3);
  if (top.length) {
    nodes.push(el("p", "stats-sub", "Los más valiosos"));
    const list = el("div", "stats-minis");
    for (const r of top) list.append(mini(r.item, money(r.price.value, r.price.currency, 2)));
    nodes.push(openable(list, items, onOpen));
  }
  return card(title, ...nodes);
}

function curiositiesCard(data, items, onOpen) {
  const list = el("div", "stats-minis");
  const withCommunity = data.withData.filter((r) => r.s.have !== null && r.s.have !== undefined);
  if (withCommunity.length) {
    const rarest = [...withCommunity].sort((a, b) => a.s.have - b.s.have)[0];
    list.append(mini(rarest.item, `💎 El más raro · lo tienen ${rarest.s.have.toLocaleString("es-ES")}`));
    const wanted = [...withCommunity].sort((a, b) => b.s.want - a.s.want)[0];
    list.append(mini(wanted.item, `🔥 El más deseado · lo buscan ${wanted.s.want.toLocaleString("es-ES")}`));
  }
  const rated = data.withData.filter((r) => r.s.rating && r.s.rating.count >= 3);
  if (rated.length) {
    const best = [...rated].sort((a, b) => b.s.rating.average - a.s.rating.average)[0];
    list.append(mini(best.item, `⭐ Mejor valorado · ${best.s.rating.average.toFixed(2)} / 5`));
  }
  // La reedición más lejana del original.
  const gaps = data.rows.filter((r) => r.original && r.edition && r.edition > r.original);
  if (gaps.length) {
    const far = [...gaps].sort((a, b) => b.edition - b.original - (a.edition - a.original))[0];
    list.append(mini(far.item, `🔁 Reeditado ${far.edition - far.original} años después`));
  }

  const colored = items.filter((i) => i.color).length;
  const heavy = data.rows.filter((r) => isHeavy(r.item.weight || r.s.weight)).length;
  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(String(colored), "de color"),
    tile(String(heavy), "de 180 g o más"),
    tile(String(gaps.length), gaps.length === 1 ? "reedición" : "reediciones")
  );
  return card("✨ Curiosidades", tiles, openable(list, items, onOpen));
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

    const summary = el("div", "stats-tiles");
    summary.append(
      tile(String(items.length), items.length === 1 ? "disco" : "discos"),
      tile(String(artists.length), artists.length === 1 ? "artista" : "artistas"),
      tile(String(countries.length || "—"), countries.length === 1 ? "país" : "países")
    );

    const nodes = [summary, valueCard(data, items, onOpen)];

    // 🎸 Géneros como un vinilo, y los estilos debajo.
    if (genres.length) {
      const byGenre = new Map();
      for (const r of data.withData) for (const g of r.s.genres) byGenre.set(g, [...(byGenre.get(g) || []), r.item]);
      const genreCard = genreVinylCard(genres, byGenre, data.withData.length, draw);
      if (styles.length) {
        genreCard.append(el("p", "stats-sub", "Estilos más repetidos"));
        const chips = el("div", "stats-chips");
        for (const [name, count] of styles.slice(0, 12)) chips.append(el("span", "stats-chip", `${name} · ${count}`));
        genreCard.append(chips);
      }
      const pending = items.length - data.withData.length;
      if (pending) genreCard.append(el("p", "stats-note", `Faltan datos de ${plural(pending, "disco", "discos")}.`));
      nodes.push(genreCard);
    }

    // ⏱️ Duración.
    const lengths = data.withData
      .map((r) => ({ item: r.item, s: r.s, len: recordLength(r.s) }))
      .filter((r) => r.len)
      .map((r) => ({ item: r.item, seconds: r.len.seconds, estimated: r.len.estimated, tracks: r.s.tracks }));
    nodes.push(durationCard(lengths, items.length, onOpen));

    // 📅 Años y 🕰️ línea del tiempo.
    nodes.push(yearsCard(data, draw));
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
      const countryBars = bars(countries, data.withData.length, { max: 6, format: (c) => `${countryFlag(c)} ${c}`.trim() });
      nodes.push(mapCard(codeCounts, names, [...extras.entries()].map(([c, n]) => [`${countryFlag(c)} ${c}`.trim(), n]), countryBars, draw));
    }

    if (artists.length) nodes.push(card("🎤 Artistas con más discos", bars(artists, items.length, { max: 5 })));
    if (labels.length) nodes.push(card("🏷️ Sellos", bars(labels, data.withData.length, { max: 5 })));

    nodes.push(curiositiesCard(data, items, onOpen));
    nodes.push(calendarCard(items));

    container.replaceChildren(...nodes);
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
