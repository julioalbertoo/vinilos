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

// Tarjeta de un bloque: icono en un círculo pastel, título y una línea que explica qué se ve.
// head: { icon, title, sub, accent, nav }. accent: lilac | peach | mint | butter | pink | sky.
// nav: la entrada de la barra de accesos a la que pertenece.
export function card(head, ...children) {
  const box = el("section", `stats-card stats-card--${head.accent || "lilac"}`);
  if (head.nav) box.dataset.nav = head.nav;
  const top = el("header", "stats-head");
  const text = el("div", "stats-head-text");
  text.append(el("h3", "stats-title", head.title));
  if (head.sub) text.append(el("p", "stats-subtitle", head.sub));
  top.append(el("span", "stats-icon", head.icon), text);
  box.append(top, ...children.filter(Boolean));
  return box;
}

// Cifra suelta con su etiqueta. accent: el pastel de fondo (por defecto, lila).
export function tile(value, label, { icon, accent } = {}) {
  const box = el("div", `stats-tile${accent ? ` stats-tile--${accent}` : ""}`);
  if (icon) box.append(el("span", "stats-tile-icon", icon));
  // Las cifras largas («27 min», «1.250») van algo más pequeñas para que quepan en la casilla.
  box.append(el("span", `stats-tile-value${value.length > 4 ? " long" : ""}`, value), el("span", "stats-tile-label", label));
  return box;
}

export const note = (text) => el("p", "stats-note", text);
export const hint = (text) => el("p", "stats-hint", `👆 ${text}`);

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

const itemName = (item) => `${item.title || ""}${item.artist ? ` · ${item.artist}` : ""}`;

// Fila de portadas que se desliza en horizontal; tocar una abre su ficha.
export function coverStrip(items, onOpen, label) {
  const box = el("div", "stats-pick");
  if (label) box.append(el("p", "stats-pick-label", label));
  const row = el("div", "stats-strip");
  for (const item of items) {
    const button = el("button", "stats-strip-item");
    button.type = "button";
    button.setAttribute("aria-label", itemName(item));
    button.append(coverImg(item, "stats-strip-cover"), el("span", "stats-strip-title", item.title || ""));
    button.addEventListener("click", () => onOpen(item));
    row.append(button);
  }
  box.append(row);
  return box;
}

// Ranking con barras. entries: [[nombre, cuántos]]. Si se pasa byKey (Map nombre → discos),
// cada fila se puede tocar y debajo salen sus portadas.
export function rankList(entries, total, { max = 6, format = (k) => k, byKey, selected, onSelect, onOpen, more = "más" } = {}) {
  const list = el("div", "stats-bars");
  const top = entries.slice(0, max);
  const peak = top.length ? top[0][1] : 1;
  for (const [key, count] of top) {
    const pickable = Boolean(byKey && onSelect);
    const row = el(pickable ? "button" : "div", "stats-bar");
    if (pickable) {
      row.type = "button";
      row.setAttribute("aria-expanded", String(key === selected));
      row.addEventListener("click", () => onSelect(key === selected ? null : key));
    }
    if (key === selected) row.classList.add("active");
    const track = el("span", "stats-bar-track");
    const fill = el("span", "stats-bar-fill");
    fill.style.width = `${Math.max(4, (count / peak) * 100)}%`;
    track.append(fill);
    const value = el("span", "stats-bar-count");
    value.append(el("b", null, count.toLocaleString("es-ES")));
    if (total) value.append(` · ${Math.round((count / total) * 100)}%`);
    row.append(el("span", "stats-bar-name", format(key)), track, value);
    list.append(row);
    if (key === selected) list.append(coverStrip(byKey.get(key) || [], onOpen));
  }
  if (entries.length > max) list.append(note(`y ${entries.length - max} ${more}`));
  return list;
}

// Los tres primeros, como un podio con sus portadas. rows: [{ item, value }].
export function podium(rows, onOpen) {
  const box = el("div", "stats-podium");
  rows.forEach(({ item, value }, i) => {
    const button = el("button", "stats-podium-item");
    button.type = "button";
    button.setAttribute("aria-label", `${i + 1}º: ${itemName(item)}, ${value}`);
    const art = el("span", "stats-podium-art");
    art.append(coverImg(item, "stats-podium-cover"), el("span", "stats-podium-rank", ["🥇", "🥈", "🥉"][i]));
    button.append(art, el("span", "stats-podium-value", value), el("span", "stats-podium-title", item.title || ""));
    button.addEventListener("click", () => onOpen(item));
    box.append(button);
  });
  return box;
}

// Récords («El más raro», «El más largo»…): portada, qué récord es, el dato y el disco. facts: [{ icon, label, item, value }].
export function factGrid(facts, onOpen) {
  const list = el("div", "stats-facts");
  for (const fact of facts) {
    const button = el("button", "stats-fact");
    button.type = "button";
    button.setAttribute("aria-label", `${fact.label}: ${itemName(fact.item)}, ${fact.value}`);
    const text = el("span", "stats-fact-text");
    text.append(
      el("span", "stats-fact-label", `${fact.icon} ${fact.label}`),
      el("span", "stats-fact-value", fact.value),
      el("span", "stats-fact-name", itemName(fact.item))
    );
    button.append(coverImg(fact.item, "stats-fact-cover"), text);
    button.addEventListener("click", () => onOpen(fact.item));
    list.append(button);
  }
  return list;
}

// Dato destacado en una pastilla de color, como «✈️ Como un vuelo a Tokio».
export const pill = (text, accent = "butter") => el("p", `stats-pill stats-pill--${accent}`, text);

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

export function segmented(options, current, onPick) {
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

// ---------- Barra de accesos: salta a cada bloque y marca en cuál estás ----------

let nav = null;
let navKey = null;
let navScroll = 0;
let navLockUntil = 0; // mientras dura el salto animado, la barra no sigue al scroll
let navTicking = false;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const headerHeight = () => {
  const header = document.querySelector(".app-header");
  return header ? header.getBoundingClientRect().height : 0;
};

function markNav(key, follow = true) {
  if (!nav) return;
  navKey = key;
  for (const chip of nav.querySelectorAll(".stats-nav-chip")) {
    const on = chip.dataset.key === key;
    chip.classList.toggle("active", on);
    if (on) chip.setAttribute("aria-current", "true");
    else chip.removeAttribute("aria-current");
    // La entrada activa se desliza a la vista dentro de la barra (sin mover la página).
    if (on && follow) {
      const left = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2;
      nav.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }
}

// El bloque en el que estás es el último cuyo comienzo ya ha pasado bajo la barra.
function spyNav() {
  if (!nav || !nav.isConnected || nav.closest("[hidden]") || !nav.closest(".view.active")) return;
  const navBox = nav.getBoundingClientRect();
  nav.classList.toggle("stuck", navBox.top <= headerHeight() + 1);
  if (Date.now() < navLockUntil) return;
  const line = navBox.bottom + 24;
  let current = null;
  for (const section of nav.parentElement.querySelectorAll("[data-nav]")) {
    if (section.getBoundingClientRect().top > line) break;
    current = section.dataset.nav;
  }
  // Al llegar al final de la página, el último bloque, aunque no llegue arriba.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
    const all = nav.parentElement.querySelectorAll("[data-nav]");
    if (all.length) current = all[all.length - 1].dataset.nav;
  }
  current = current || nav.querySelector(".stats-nav-chip")?.dataset.key;
  if (current && current !== navKey) markNav(current);
}

window.addEventListener(
  "scroll",
  () => {
    if (navTicking || !nav) return;
    navTicking = true;
    requestAnimationFrame(() => {
      navTicking = false;
      spyNav();
    });
  },
  { passive: true }
);

// sections: [[clave, texto]] en el orden de la página. container: donde están los bloques con data-nav.
export function navBar(sections, container) {
  nav = el("nav", "stats-nav");
  nav.setAttribute("aria-label", "Ir a un bloque");
  nav.style.setProperty("--stick", `${Math.max(0, headerHeight() - 1)}px`);
  for (const [key, text] of sections) {
    const chip = el("button", "stats-nav-chip", text);
    chip.type = "button";
    chip.dataset.key = key;
    chip.addEventListener("click", () => {
      const target = container.querySelector(`[data-nav="${key}"]`);
      if (!target) return;
      const offset = headerHeight() + nav.getBoundingClientRect().height + 10;
      navLockUntil = Date.now() + 900;
      markNav(key);
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: reducedMotion() ? "auto" : "smooth" });
    });
    nav.append(chip);
  }
  nav.addEventListener("scroll", () => (navScroll = nav.scrollLeft), { passive: true });
  // Al repintar, la barra sigue donde estaba.
  const current = nav;
  requestAnimationFrame(() => {
    current.scrollLeft = navScroll;
    if (navKey && sections.some(([key]) => key === navKey)) markNav(navKey, false);
    spyNav();
  });
  return nav;
}

// ---------- 1. Géneros dibujados como un vinilo ----------

// Orden fijo, comprobado para que los vecinos se distingan también con daltonismo, sobre el disco negro.
const GENRE_COLORS = ["#7262d8", "#e0663a", "#1a9f72", "#c98500", "#d55181", "#3987e5", "#3f9a2f"];
const OTHER_COLOR = "#8d899c";
const MAX_SLICES = 7;

let selectedGenre = null;

// genres: [[nombre, cuántos]], byGenre: Map nombre → discos, records: discos con datos.
export function genreVinylCard(genres, byGenre, records, rerender, onOpen) {
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

  let picked;
  if (selectedGenre) {
    const list = current.others
      ? [...new Set(current.others.flatMap((n) => byGenre.get(n) || []))]
      : byGenre.get(selectedGenre) || [];
    const label = current.others
      ? `${current.others.join(", ")} · ${plural(list.length, "disco", "discos")}`
      : `${selectedGenre} · ${plural(list.length, "disco", "discos")}`;
    picked = coverStrip(list, onOpen, label);
  } else {
    picked = hint("Toca un color para ver sus discos.");
  }

  const wrap = el("div", "stats-vinyl-wrap");
  wrap.append(svg);
  return card(
    { icon: "🎸", title: "Géneros", sub: "Tu colección, dibujada como un vinilo", accent: "lilac", nav: "genres" },
    wrap,
    keys,
    picked
  );
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

  if (pending) nodes.push(note(`🎨 Leyendo los colores de las portadas… faltan ${pending}.`));
  else if (known.length < entries.length) {
    nodes.push(note(`No se pudo leer el color de ${plural(entries.length - known.length, "portada", "portadas")}: van al final.`));
  }

  // Vinilos de color, con su color de verdad.
  nodes.push(el("p", "stats-sub", colored.length ? `💿 Tus vinilos de color (${colored.length})` : "💿 Tus vinilos de color"));
  if (!colored.length) {
    nodes.push(note("Aún no tienes ninguno: todos son negros."));
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
  return card(
    { icon: "🌈", title: "Tus portadas por colores", sub: "Del rojo al violeta; toca una para abrirla", accent: "pink", nav: "colors" },
    ...nodes
  );
}

// ---------- 3. Cuánto dura tu colección ----------

// Comparaciones de duración, en minutos, con su dibujo.
const COMPARISONS = [
  [90, "un partido de fútbol", "⚽"],
  [195, "ver Titanic", "🎬"],
  [360, "ir de Madrid a Barcelona en coche", "🚗"],
  [480, "un vuelo de Madrid a Nueva York", "✈️"],
  [682, "la trilogía de El Señor de los Anillos en versión extendida", "🧙"],
  [840, "un vuelo de Madrid a Tokio", "✈️"],
  [1440, "un día entero sin parar", "🌞"],
  [4200, "ver Juego de Tronos entera", "🐉"],
  [10080, "una semana entera sin parar", "📅"],
];

function comparison(minutes) {
  const fit = COMPARISONS.filter(([m]) => m <= minutes).pop();
  if (!fit) return `${COMPARISONS[0][2]} Casi lo que dura ${COMPARISONS[0][1]}`;
  const times = minutes / fit[0];
  if (times < 1.25) return `${fit[2]} Como ${fit[1]}`;
  return `${fit[2]} ${times.toLocaleString("es-ES", { maximumFractionDigits: 1 })} veces ${fit[1]}`;
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
  const head = { icon: "⏱️", title: "Cuánto dura tu colección", accent: "peach", nav: "duration" };
  if (!rows.length) return card(head, note("Aún no se sabe: falta la lista de canciones de tus discos."));
  const seconds = rows.reduce((sum, r) => sum + r.seconds, 0);
  const tracks = rows.reduce((sum, r) => sum + r.tracks, 0);
  const estimated = rows.filter((r) => r.estimated).length;
  const nodes = [
    el("p", "stats-big", formatDuration(seconds)),
    el("p", "stats-big-note", `de música en ${plural(tracks, "canción", "canciones")}`),
    pill(comparison(seconds / 60)),
  ];
  const tiles = el("div", "stats-tiles");
  tiles.append(
    tile(formatDuration(seconds / rows.length), "media por disco", { accent: "peach" }),
    tile(String(Math.round(tracks / rows.length)), "canciones por disco", { accent: "peach" }),
    tile(formatDuration(seconds / tracks), "por canción", { accent: "peach" })
  );
  nodes.push(tiles);
  const byLength = [...rows].sort((a, b) => b.seconds - a.seconds);
  const facts = [{ icon: "🐢", label: "El más largo", item: byLength[0].item, value: formatDuration(byLength[0].seconds) }];
  if (byLength.length > 1) {
    const last = byLength[byLength.length - 1];
    facts.push({ icon: "🐇", label: "El más corto", item: last.item, value: formatDuration(last.seconds) });
  }
  nodes.push(factGrid(facts, onOpen));
  const notes = [];
  if (rows.length < totalRecords) notes.push(`Sin contar ${plural(totalRecords - rows.length, "disco", "discos")} sin lista de canciones todavía.`);
  if (estimated) notes.push(`En ${plural(estimated, "disco", "discos")} Discogs no da la duración de todas las canciones: se calcula aproximada.`);
  if (notes.length) nodes.push(note(notes.join(" ")));
  return card({ ...head, sub: "Todo seguido, sin dar la vuelta al disco" }, ...nodes);
}

// ---------- 5. Línea del tiempo con portadas ----------

const YEAR_W = 30;
const COVER = 28;
const MAX_STACK = 5;
let timelineScroll = null;

// rows: [{ item, year }]
export function timelineCard(rows, yearMode, onOpen) {
  const dated = rows.filter((r) => r.year);
  const what = yearMode === "edition" ? "año de tu edición" : "año original";
  const head = { icon: "🕰️", title: "Línea del tiempo", sub: `Cada portada en su ${what}`, accent: "mint", nav: "years" };
  if (!dated.length) return card(head, note("Aún no se sabe el año de ningún disco."));
  const first = Math.floor(Math.min(...dated.map((r) => r.year)) / 5) * 5;
  const last = Math.ceil((Math.max(...dated.map((r) => r.year)) + 1) / 5) * 5;
  const byYear = new Map();
  for (const r of dated) byYear.set(r.year, [...(byYear.get(r.year) || []), r.item]);
  const tallest = Math.min(MAX_STACK, Math.max(...[...byYear.values()].map((l) => l.length)));

  const scroller = el("div", "stats-timeline");
  const track = el("div", "stats-timeline-track");
  track.style.width = `${(last - first + 1) * YEAR_W}px`;
  track.style.height = `${tallest * (COVER + 3) + 26}px`;

  // Una década sí y otra no, con un fondo suave, para leer de un vistazo en qué década cae cada disco.
  for (let decade = Math.floor(first / 10) * 10; decade <= last; decade += 10) {
    if ((decade / 10) % 2) continue;
    const from = Math.max(first, decade);
    const to = Math.min(last + 1, decade + 10);
    const band = el("span", "stats-timeline-band");
    band.style.left = `${(from - first) * YEAR_W}px`;
    band.style.width = `${(to - from) * YEAR_W}px`;
    track.append(band);
  }

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
  return card(head, scroller, hint("Desliza para recorrerla y toca un disco para abrirlo."));
}

// ---------- 7. Mapa del mundo ----------

let mapModule = null;
let mapLoading = null;
let mapView = null; // "world" | "europe"; null = se elige solo

const EUROPE_BOX = [360, 50, 124, 96];
const EUROPE = new Set("ES PT FR GB IE DE NL BE LU CH AT IT SE NO DK FI IS GR PL CZ SK HU RO BG RS HR SI UA RU TR".split(" "));

// counts: Map código → número de discos. names: Map código → nombre con bandera. extras: [[nombre, número]] sin país en el mapa (p. ej. «Europa»).
export function mapCard(counts, names, extras, bars, rerender) {
  const title = { icon: "🌍", title: "Dónde se editaron", sub: "El país de cada edición, según Discogs", accent: "sky", nav: "map" };
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
    return card(title, note("Cargando el mapa…"), bars);
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
    nodes.push(note("No salen en el mapa (Discogs no dice un país concreto):"), chips);
  }
  nodes.push(el("p", "stats-sub", "Países con más discos"), bars);
  return card(title, ...nodes);
}
