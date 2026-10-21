// Piezas visuales de la pestaña «Datos»: el vinilo de géneros, el arcoíris de portadas, la duración,
// la línea del tiempo y el mapa. stats.js calcula los datos y decide el orden.
import { vinylBackground } from "./gallery.js";

// ---------- Utilidades compartidas ----------

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

export const plural = (n, one, many) => `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;

export function card(title, ...children) {
  const box = el("section", "stats-card");
  box.append(el("h3", "stats-title", title), ...children);
  return box;
}

export function tile(value, label) {
  const box = el("div", "stats-tile");
  box.append(el("span", "stats-tile-value", value), el("span", "stats-tile-label", label));
  return box;
}

function coverImg(item, className) {
  const src = item.thumb || item.cover;
  if (!src) return el("span", className, "💿");
  const img = el("img", className);
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

// Fila pequeña con portada, título, artista y un dato. data-id para abrir su ficha.
export function mini(item, extra) {
  const row = el("div", "stats-mini");
  row.append(coverImg(item, "stats-mini-cover"));
  const text = el("span", "stats-mini-text");
  text.append(el("span", "stats-mini-title", item.title || ""), el("span", "stats-mini-meta", item.artist || ""));
  row.append(text, el("span", "stats-mini-extra", extra));
  row.dataset.id = item.release_id;
  return row;
}

// Nivel de color de una casilla, como en GitHub: 0 (vacía) a 4 (la que más).
export function level(count, peak) {
  if (!count) return 0;
  if (peak <= 1) return 4;
  return Math.min(4, Math.ceil((count / peak) * 4));
}

export function legend() {
  const row = el("div", "stats-legend");
  row.append(el("span", null, "Menos"));
  for (let i = 0; i <= 4; i++) row.append(el("span", `stats-cell lvl${i}`));
  row.append(el("span", null, "Más"));
  return row;
}

function segmented(options, current, onPick) {
  const box = el("div", "segmented segmented--small stats-switch");
  for (const [value, text] of options) {
    const button = el("button", value === current ? "active" : "", text);
    button.type = "button";
    button.setAttribute("aria-pressed", String(value === current));
    button.addEventListener("click", () => value !== current && onPick(value));
    box.append(button);
  }
  return box;
}

const titleList = (items) => items.map((i) => `${i.title}${i.artist ? ` (${i.artist})` : ""}`).join(" · ");

// ---------- 1. Géneros dibujados como un vinilo ----------

const GENRE_COLORS = ["#7262d8", "#f0866a", "#36b37e", "#f2b93b", "#e5689a", "#4aa3df", "#a77ad6"];
const OTHER_COLOR = "#9a96a8";
const MAX_SLICES = 7;

let selectedGenre = null;

// genres: [[nombre, cuántos]], byGenre: Map nombre → discos, records: discos con datos.
export function genreVinylCard(genres, byGenre, records, rerender) {
  const slices = genres.slice(0, MAX_SLICES).map(([name, count], i) => ({ name, count, color: GENRE_COLORS[i] }));
  const rest = genres.slice(MAX_SLICES);
  if (rest.length) {
    slices.push({ name: "Otros", count: rest.reduce((sum, [, n]) => sum + n, 0), color: OTHER_COLOR, others: rest.map(([n]) => n) });
  }
  if (selectedGenre && !slices.some((s) => s.name === selectedGenre)) selectedGenre = null;
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const current = slices.find((s) => s.name === selectedGenre) || slices[0];

  const svg = svgEl("svg", { viewBox: "-100 -100 200 200", class: "stats-vinyl", role: "img" });
  svg.setAttribute("aria-label", `Géneros: ${slices.map((s) => `${s.name} ${s.count}`).join(", ")}`);
  svg.append(svgEl("circle", { r: 98, class: "stats-vinyl-disc" }));

  // Anillo de colores: cada género ocupa su parte de la vuelta, con un pequeño hueco entre ellos.
  const R = 70;
  const C = 2 * Math.PI * R;
  const gap = slices.length > 1 ? 1.2 : 0;
  let offset = 0;
  for (const s of slices) {
    const len = (s.count / total) * C;
    const arc = svgEl("circle", {
      r: R,
      class: "stats-vinyl-slice",
      stroke: s.color,
      "stroke-width": 50,
      "stroke-dasharray": `${Math.max(0.5, len - gap)} ${C}`,
      "stroke-dashoffset": String(-offset),
      transform: "rotate(-90)",
    });
    if (selectedGenre && s.name !== selectedGenre) arc.classList.add("dim");
    arc.addEventListener("click", () => {
      selectedGenre = selectedGenre === s.name ? null : s.name;
      rerender();
    });
    svg.append(arc);
    offset += len;
  }

  // Surcos por encima del color, para que se vea que es un disco.
  for (let r = 48; r <= 96; r += 3.2) svg.append(svgEl("circle", { r, class: "stats-vinyl-groove" }));
  svg.append(svgEl("circle", { r: 98, class: "stats-vinyl-shine" }));

  // Galleta con el género principal (o el elegido).
  svg.append(svgEl("circle", { r: 42, fill: current.color, class: "stats-vinyl-label" }));
  const pct = records ? Math.round(((byGenre.get(current.name) || []).length / records) * 100) : 0;
  const words = current.name.length > 12 ? current.name.split(/\s*[,/&]\s*|\s+/).filter(Boolean) : [current.name];
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words;
  const nameText = svgEl("text", { class: "stats-vinyl-name", "text-anchor": "middle", y: current.others ? -6 - (lines.length - 1) * 5 : -12 - (lines.length - 1) * 11 });
  lines.forEach((line, i) => {
    const span = svgEl("tspan", { x: 0, dy: i ? 11 : 0 });
    span.textContent = line;
    nameText.append(span);
  });
  svg.append(nameText);
  if (!current.others) {
    const pctText = svgEl("text", { class: "stats-vinyl-pct", "text-anchor": "middle", y: 25 });
    pctText.textContent = `${pct}%`;
    svg.append(pctText);
  }
  svg.append(svgEl("circle", { r: 3.5, class: "stats-vinyl-hole" }));

  const keys = el("div", "stats-genre-keys");
  for (const s of slices) {
    const key = el("button", "stats-genre-key");
    key.type = "button";
    if (s.name === selectedGenre) key.classList.add("active");
    const dot = el("span", "stats-genre-dot");
    dot.style.background = s.color;
    key.append(dot, el("span", null, s.name), el("b", null, String(s.count)));
    key.addEventListener("click", () => {
      selectedGenre = selectedGenre === s.name ? null : s.name;
      rerender();
    });
    keys.append(key);
  }

  const caption = el("p", "stats-caption");
  if (selectedGenre) {
    const list = current.others
      ? [...new Set(current.others.flatMap((n) => byGenre.get(n) || []))]
      : byGenre.get(selectedGenre) || [];
    caption.textContent = current.others
      ? `${current.others.join(", ")}: ${titleList(list)}`
      : `${plural(list.length, "disco", "discos")}: ${titleList(list)}`;
  } else {
    caption.textContent = "Toca un color para ver qué discos son de ese género.";
  }

  const wrap = el("div", "stats-vinyl-wrap");
  wrap.append(svg);
  return card("🎸 Géneros", wrap, keys, caption);
}

// ---------- 2. Arcoíris de portadas ----------

// Color principal de una portada: el tono con más color (se ignoran blancos, negros y grises
// salvo que la portada sea toda así). Devuelve { hex, h, s, l } o null si no se puede leer la foto.
export function coverColor(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const timer = setTimeout(() => resolve(null), 15000);
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.onload = () => {
      clearTimeout(timer);
      try {
        resolve(dominantColor(img));
      } catch {
        resolve(null); // la web de las fotos no deja leerlas
      }
    };
    img.src = src;
  });
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function dominantColor(img) {
  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data; // lanza un error si la foto no se puede leer
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  const all = { r: 0, g: 0, b: 0, n: 0 };
  let chroma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    all.r += r;
    all.g += g;
    all.b += b;
    all.n++;
    const [h, s, l] = rgbToHsl(r, g, b);
    const w = s * (1 - Math.abs(l - 0.5) * 2); // cuánto color tiene de verdad
    if (w < 0.15) continue;
    const bin = bins[Math.floor(h / 30) % 12];
    bin.w += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
    chroma += w;
  }
  let r;
  let g;
  let b;
  const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
  if (chroma / all.n > 0.06 && best.w > 0) {
    [r, g, b] = [best.r / best.w, best.g / best.w, best.b / best.w];
  } else {
    [r, g, b] = [all.r / all.n, all.g / all.n, all.b / all.n];
  }
  [r, g, b] = [r, g, b].map(Math.round);
  const [h, s, l] = rgbToHsl(r, g, b);
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { hex, h: Math.round(h), s: Number(s.toFixed(2)), l: Number(l.toFixed(2)) };
}

const isChromatic = (c) => c.s >= 0.18 && c.l > 0.12 && c.l < 0.92;

// Orden del arcoíris: primero los de color (del rojo al rosa), luego blancos → negros, al final los desconocidos.
function rainbowOrder(a, b) {
  const rank = (c) => (!c ? 2 : isChromatic(c) ? 0 : 1);
  const ra = rank(a.color);
  const rb = rank(b.color);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return ((a.color.h + 15) % 360) - ((b.color.h + 15) % 360) || b.color.l - a.color.l;
  if (ra === 1) return b.color.l - a.color.l;
  return 0;
}

// entries: [{ item, color }] (color null si no se sabe).
export function rainbowCard(entries, colored, onOpen, pending) {
  const sorted = [...entries].sort(rainbowOrder);
  const known = sorted.filter((e) => e.color);
  const nodes = [];

  if (known.length) {
    const strip = el("div", "stats-palette");
    for (const e of known) {
      const band = el("span");
      band.style.background = e.color.hex;
      strip.append(band);
    }
    nodes.push(strip);
  }

  const mosaic = el("div", "stats-mosaic");
  for (const e of sorted) {
    const cell = el("button", "stats-mosaic-cell");
    cell.type = "button";
    cell.title = `${e.item.title}${e.item.artist ? ` · ${e.item.artist}` : ""}`;
    cell.setAttribute("aria-label", cell.title);
    if (e.color) cell.style.background = e.color.hex;
    cell.append(coverImg(e.item, "stats-mosaic-img"));
    cell.addEventListener("click", () => onOpen(e.item));
    mosaic.append(cell);
  }
  nodes.push(mosaic);

  if (pending) nodes.push(el("p", "stats-note", `🎨 Leyendo los colores de las portadas… faltan ${pending}.`));
  else if (known.length < entries.length) {
    nodes.push(el("p", "stats-note", `No se pudo leer el color de ${plural(entries.length - known.length, "portada", "portadas")}: van al final.`));
  }

  // Vinilos de color, con su color de verdad.
  nodes.push(el("p", "stats-sub", colored.length ? `Tus vinilos de color (${colored.length})` : "Tus vinilos de color"));
  if (!colored.length) {
    nodes.push(el("p", "stats-note", "Aún no tienes ninguno: todos son negros."));
  } else {
    const row = el("div", "stats-discs");
    for (const item of colored) {
      const disc = el("button", "stats-disc");
      disc.type = "button";
      const face = el("span", "stats-disc-face");
      face.style.background = vinylBackground(item.color) || "#1b1b1f";
      face.append(el("span", "stats-disc-hole"));
      disc.append(face, el("span", "stats-disc-title", item.title), el("span", "stats-disc-color", item.color));
      disc.addEventListener("click", () => onOpen(item));
      row.append(disc);
    }
    nodes.push(row);
  }
  return card("🌈 Tus portadas por colores", ...nodes);
}

// ---------- 3. Cuánto dura tu colección ----------

// Comparaciones de duración, en minutos.
const COMPARISONS = [
  [90, "un partido de fútbol"],
  [195, "ver Titanic"],
  [360, "ir de Madrid a Barcelona en coche"],
  [480, "un vuelo de Madrid a Nueva York"],
  [682, "la trilogía de El Señor de los Anillos en versión extendida"],
  [840, "un vuelo de Madrid a Tokio"],
  [1440, "un día entero sin parar"],
  [4200, "ver Juego de Tronos entera"],
  [10080, "una semana entera sin parar"],
];

function comparison(minutes) {
  const fit = COMPARISONS.filter(([m]) => m <= minutes).pop();
  if (!fit) return `Casi lo que dura ${COMPARISONS[0][1]}`;
  const times = minutes / fit[0];
  if (times < 1.25) return `Como ${fit[1]}`;
  return `${times.toLocaleString("es-ES", { maximumFractionDigits: 1 })} veces ${fit[1]}`;
}

export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// rows: [{ item, seconds, tracks, estimated }] de los discos con canciones conocidas.
export function durationCard(rows, totalRecords, onOpen) {
  if (!rows.length) {
    return card("⏱️ Cuánto dura tu colección", el("p", "stats-note", "Aún no se sabe: falta la lista de canciones de tus discos."));
  }
  const seconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  const tracks = rows.reduce((sum, r) => sum + r.tracks, 0);
  const estimated = rows.filter((r) => r.estimated).length;
  const nodes = [
    el("p", "stats-big", formatDuration(seconds)),
    el("p", "stats-note", `de música en ${plural(tracks, "canción", "canciones")}`),
    el("p", "stats-analogy", `✈️ ${comparison(seconds / 60)}`),
  ];
  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(formatDuration(seconds / rows.length), "media por disco"),
    tile(String(Math.round(tracks / rows.length)), "canciones por disco"),
    tile(formatDuration(seconds / tracks), "por canción")
  );
  nodes.push(tiles);
  const byLength = [...rows].sort((a, b) => b.seconds - a.seconds);
  const list = el("div", "stats-minis");
  list.append(mini(byLength[0].item, `🐢 El más largo · ${formatDuration(byLength[0].seconds)}`));
  if (byLength.length > 1) {
    const last = byLength[byLength.length - 1];
    list.append(mini(last.item, `🐇 El más corto · ${formatDuration(last.seconds)}`));
  }
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".stats-mini");
    const hit = row && rows.find((r) => String(r.item.release_id) === row.dataset.id);
    if (hit) onOpen(hit.item);
  });
  nodes.push(list);
  const notes = [];
  if (rows.length < totalRecords) notes.push(`Sin contar ${plural(totalRecords - rows.length, "disco", "discos")} sin lista de canciones todavía.`);
  if (estimated) notes.push(`En ${plural(estimated, "disco", "discos")} Discogs no da la duración de todas las canciones: se calcula aproximada.`);
  if (notes.length) nodes.push(el("p", "stats-note", notes.join(" ")));
  return card("⏱️ Cuánto dura tu colección", ...nodes);
}

// ---------- 5. Línea del tiempo con portadas ----------

const YEAR_W = 30;
const COVER = 28;
const MAX_STACK = 5;
let timelineScroll = null;

// rows: [{ item, year }]
export function timelineCard(rows, yearMode, onOpen) {
  const dated = rows.filter((r) => r.year);
  const title = "🕰️ Línea del tiempo";
  if (!dated.length) return card(title, el("p", "stats-note", "Aún no se sabe el año de ningún disco."));
  const first = Math.floor(Math.min(...dated.map((r) => r.year)) / 5) * 5;
  const last = Math.ceil((Math.max(...dated.map((r) => r.year)) + 1) / 5) * 5;
  const byYear = new Map();
  for (const r of dated) byYear.set(r.year, [...(byYear.get(r.year) || []), r.item]);
  const tallest = Math.min(MAX_STACK, Math.max(...[...byYear.values()].map((l) => l.length)));

  const scroller = el("div", "stats-timeline");
  const track = el("div", "stats-timeline-track");
  track.style.width = `${(last - first + 1) * YEAR_W}px`;
  track.style.height = `${tallest * (COVER + 3) + 26}px`;

  for (let year = first; year <= last; year++) {
    const x = (year - first) * YEAR_W;
    const tick = el("span", year % 10 === 0 ? "stats-tick decade" : year % 5 === 0 ? "stats-tick five" : "stats-tick");
    tick.style.left = `${x + YEAR_W / 2}px`;
    track.append(tick);
    if (year % 5 === 0) {
      const label = el("span", year % 10 === 0 ? "stats-tick-label decade" : "stats-tick-label", String(year));
      label.style.left = `${x + YEAR_W / 2}px`;
      track.append(label);
    }
    const list = byYear.get(year) || [];
    list.slice(0, MAX_STACK).forEach((item, k) => {
      const more = k === MAX_STACK - 1 && list.length > MAX_STACK;
      const cover = el("button", "stats-timeline-cover");
      cover.type = "button";
      cover.style.left = `${x + (YEAR_W - COVER) / 2}px`;
      cover.style.bottom = `${24 + k * (COVER + 3)}px`;
      cover.title = `${year} · ${item.title}`;
      cover.setAttribute("aria-label", cover.title);
      cover.append(coverImg(item, "stats-timeline-img"));
      if (more) cover.append(el("span", "stats-timeline-more", `+${list.length - MAX_STACK + 1}`));
      cover.addEventListener("click", () => onOpen(item));
      track.append(cover);
    });
  }
  scroller.append(track);
  scroller.addEventListener("scroll", () => (timelineScroll = scroller.scrollLeft), { passive: true });
  // Se mantiene donde estaba al repintar; la primera vez se abre por el final (lo más reciente).
  requestAnimationFrame(() => {
    scroller.scrollLeft = timelineScroll === null ? scroller.scrollWidth : timelineScroll;
  });
  const what = yearMode === "edition" ? "año de tu edición" : "año original";
  return card(title, el("p", "stats-note", `Cada portada en su ${what}. Desliza para recorrerla y toca un disco para abrirlo.`), scroller);
}

// ---------- 7. Mapa del mundo ----------

let mapModule = null;
let mapLoading = null;
let mapView = null; // "world" | "europe"; null = se elige solo

const EUROPE_BOX = [360, 50, 124, 96];
const EUROPE = new Set("ES PT FR GB IE DE NL BE LU CH AT IT SE NO DK FI IS GR PL CZ SK HU RO BG RS HR SI UA RU TR".split(" "));

// counts: Map código → número de discos. names: Map código → nombre con bandera. extras: [[nombre, número]] sin país en el mapa (p. ej. «Europa»).
export function mapCard(counts, names, extras, bars, rerender) {
  const title = "🌍 Dónde se editaron";
  if (!mapModule) {
    if (!mapLoading) {
      mapLoading = import("./worldmap.js")
        .then((m) => {
          mapModule = m;
          rerender();
        })
        .catch(() => {
          mapLoading = null;
        });
    }
    return card(title, el("p", "stats-note", "Cargando el mapa…"), bars);
  }
  const { VIEWBOX, OTHER, COUNTRIES } = mapModule;
  const located = [...counts.entries()].filter(([code]) => COUNTRIES[code]);
  const europeShare = located.reduce((n, [code, c]) => n + (EUROPE.has(code) ? c : 0), 0);
  const totalLocated = located.reduce((n, [, c]) => n + c, 0);
  const view = mapView || (totalLocated && europeShare / totalLocated > 0.5 ? "europe" : "world");

  const switcher = segmented([["world", "🌍 Mundo"], ["europe", "🇪🇺 Europa"]], view, (value) => {
    mapView = value;
    rerender();
  });

  const box = view === "europe" ? EUROPE_BOX : VIEWBOX.split(" ").map(Number);
  const scale = box[2] / 800; // para que los círculos y el texto se vean igual de grandes con zoom
  const svg = svgEl("svg", { viewBox: box.join(" "), class: "stats-map", role: "img" });
  svg.setAttribute("aria-label", `Países: ${located.map(([c, n]) => `${c} ${n}`).join(", ")}`);
  svg.append(svgEl("path", { d: OTHER, class: "stats-map-land" }));
  const peak = Math.max(1, ...located.map(([, c]) => c));
  for (const [code, shape] of Object.entries(COUNTRIES)) {
    if (!shape.d) continue;
    const n = counts.get(code) || 0;
    svg.append(svgEl("path", { d: shape.d, class: n ? `stats-map-land lvl${level(n, peak)}` : "stats-map-land" }));
  }
  // Un círculo con el número encima de cada país.
  for (const [code, n] of located.sort((a, b) => b[1] - a[1])) {
    const [cx, cy] = COUNTRIES[code].c;
    const r = (7 + Math.sqrt(n) * 3) * scale * 2.2;
    const g = svgEl("g", { class: "stats-map-bubble" });
    g.append(svgEl("circle", { cx, cy, r }));
    const text = svgEl("text", { x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", "font-size": r * 1.1 });
    text.textContent = String(n);
    g.append(text);
    const label = svgEl("title");
    label.textContent = `${names.get(code) || code}: ${plural(n, "disco", "discos")}`;
    g.append(label);
    svg.append(g);
  }

  const nodes = [switcher, svg];
  if (extras.length) {
    const chips = el("div", "stats-chips");
    for (const [name, n] of extras) chips.append(el("span", "stats-chip stats-chip--soft", `${name}: ${n}`));
    nodes.push(el("p", "stats-note", "No salen en el mapa (Discogs no dice un país concreto):"), chips);
  }
  nodes.push(bars);
  return card(title, ...nodes);
}
