// Galería horizontal: cada disco asoma de su funda y el que queda en el centro sale y gira.

import { isHeavy, yearText } from "./discogs.js";

let selectedId = null; // Se recuerda para volver al mismo disco después de abrir su ficha.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function coverImg(src, className) {
  const img = el("img", className);
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  return img;
}

// Colores de galleta genérica; cada disco tiene siempre el mismo.
const LABEL_COLORS = ["#f6d6c4", "#e3dcff", "#cdeedd", "#ffe9a8", "#ffd3e1", "#cfe4ff"];

// Galleta real (foto de Discogs recortada) o, si aún no se tiene, una genérica con título y artista.
function fillLabel(label, item) {
  label.replaceChildren();
  label.classList.remove("is-real");
  const real = item.label && item.label.src && item.label.box;
  if (real) {
    const { ymin, xmin, ymax, xmax } = item.label.box;
    // La caja va en escala 0-1000. Se amplía la foto para que la caja llene el círculo.
    const w = (xmax - xmin) / 1000;
    const h = (ymax - ymin) / 1000;
    const img = coverImg(item.label.src, "gallery-label-photo");
    img.style.width = `${100 / w}%`;
    img.style.height = `${100 / h}%`;
    img.style.left = `${-(xmin / 1000 / w) * 100}%`;
    img.style.top = `${-(ymin / 1000 / h) * 100}%`;
    label.classList.add("is-real");
    label.append(img);
    return;
  }
  label.style.background = LABEL_COLORS[Number(item.release_id) % LABEL_COLORS.length] || LABEL_COLORS[0];
  label.append(el("span", "gallery-label-title", item.title || ""), el("span", "gallery-label-artist", item.artist || ""));
}

// ---------- Color del vinilo ----------

// Colores base de cada palabra que usa Discogs (inglés y español). El orden importa: primero las
// palabras más largas para que "turquoise" no se lea como otra cosa.
const VINYL_COLORS = [
  [/\b(turquoise|teal|aqua|cyan|turquesa)\b/i, "#1fa6a0"],
  [/\b(magenta|fuchsia|fucsia)\b/i, "#c2187a"],
  [/\b(purple|violet|lilac|lavender|morado|violeta|lila)\b/i, "#7a4bb5"],
  [/\b(pink|rosa)\b/i, "#f08cb4"],
  [/\b(red|crimson|rojo|burgundy|granate|oxblood)\b/i, "#c8202e"],
  [/\b(orange|naranja|tangerine)\b/i, "#f07c1f"],
  [/\b(gold|golden|dorado|mustard)\b/i, "#c9a227"],
  [/\b(yellow|amarillo|lemon)\b/i, "#f2c530"],
  [/\b(mint)\b/i, "#93dfbb"],
  [/\b(green|verde|olive|emerald|jade)\b/i, "#2e9e5b"],
  [/\b(blue|azul|navy|cobalt|sky)\b/i, "#2c64b5"],
  [/\b(brown|marr[oó]n|coffee|cola|bronze|copper)\b/i, "#7b4a2a"],
  [/\b(cream|beige|bone|ivory|crema|hueso)\b/i, "#efe3c2"],
  [/\b(silver|plateado)\b/i, "#b9bdc6"],
  [/\b(gr[ae]y|gris|smoke|smoky|ahumado)\b/i, "#8a8d93"],
  [/\b(white|blanco)\b/i, "#f3f1ea"],
  [/\b(black|negro)\b/i, "#1b1b1f"],
];

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Colores que nombra el texto, en el orden en que aparecen (p. ej. "Red & Blue Marbled" → rojo, azul).
function colorsIn(text) {
  const found = [];
  for (const [re, hex] of VINYL_COLORS) {
    const m = text.match(re);
    if (m) found.push({ at: m.index, hex });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.hex).filter((hex, i, all) => all.indexOf(hex) === i);
}

// Fondo CSS del disco para un texto de color de Discogs; "" si es negro o no se reconoce.
export function vinylBackground(text) {
  if (!text) return "";
  const t = text.toLowerCase();
  if (/picture disc/.test(t)) return "";
  const clear = /\b(clear|transparent|transparente|crystal)\b/.test(t);
  const see = clear || /\b(translucent|transl[uú]cido|transparent)\b/.test(t);
  let colors = colorsIn(t);
  if (!colors.length && !clear) return "";
  if (!colors.length) colors = ["#c9d6dd"]; // transparente sin color: cristal grisáceo
  if (colors.length === 1 && colors[0] === "#1b1b1f") return ""; // negro normal
  const alpha = clear && colors[0] === "#c9d6dd" ? 0.6 : see ? 0.72 : 1;
  const c = colors.map((hex) => hexToRgba(hex, alpha));

  // Surcos: líneas finas oscuras y claras por encima del color, para que se vea que es un disco.
  const grooves = "repeating-radial-gradient(circle, rgba(0,0,0,0.16) 0 1px, rgba(255,255,255,0.06) 1px 2.5px)";
  const ring = "radial-gradient(circle, transparent 0 34%, rgba(0,0,0,0.35) 34.5% 36%, transparent 36.5%)";
  const shine = "conic-gradient(from 40deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0.18) 30deg, rgba(255,255,255,0) 70deg, rgba(255,255,255,0) 200deg, rgba(255,255,255,0.12) 230deg, rgba(255,255,255,0) 260deg)";

  let base;
  if (/\b(splatter|salpicad)/.test(t)) {
    // Fondo del primer color con manchas del segundo (o blancas si solo hay uno).
    const dot = c[1] || "rgba(255,255,255,0.85)";
    const spots = [
      [22, 30, 3.5], [68, 20, 2.5], [80, 62, 4], [28, 76, 3], [14, 52, 2], [58, 88, 2.5], [88, 38, 2],
      [40, 12, 2], [72, 80, 2], [10, 36, 1.5], [36, 92, 1.5], [90, 72, 1.5], [62, 8, 1.5], [18, 68, 1.5],
    ]
      .map(([x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, ${dot} 0 ${r}%, transparent ${r + 0.5}%)`)
      .join(", ");
    base = `${spots}, ${c[0]}`;
  } else if (c.length > 1 || /\b(marbled?|swirl|galaxy|jaspeado|mezcla)\b/.test(t)) {
    // Jaspeado: los colores se reparten en vetas alrededor del disco, que se ven al girar.
    const list = c.length > 1 ? c : [c[0], hexToRgba("#ffffff", alpha * 0.8)];
    const stops = [];
    for (let i = 0; i < 6; i++) stops.push(list[i % list.length]);
    stops.push(stops[0]);
    base = `conic-gradient(from 10deg, ${stops.join(", ")})`;
  } else {
    base = c[0];
  }
  return `${ring}, ${shine}, ${grooves}, ${base}`;
}

function fillDisc(disc, item) {
  const background = vinylBackground(item.color || "");
  disc.style.background = background;
  disc.classList.toggle("is-colored", Boolean(background));
  // Vinilo pesado (180 g o más): canto más grueso y una etiqueta con el gramaje.
  const wrap = disc.parentElement;
  const heavy = isHeavy(item.weight || "");
  wrap.classList.toggle("is-heavy", heavy);
  let badge = wrap.querySelector(".gallery-weight");
  if (heavy && !badge) {
    badge = el("span", "gallery-weight");
    wrap.append(badge);
  }
  if (badge) badge.textContent = heavy ? item.weight : "";
}

function fillSleeve(sleeve, item) {
  // Portada grande si se tiene; la miniatura de 150 px se ve pixelada a este tamaño.
  const src = item.cover || item.thumb;
  sleeve.replaceChildren(src ? coverImg(src, "") : el("span", "gallery-sleeve-empty", "💿"));
}

// Repinta la galleta y la funda de un disco ya pintado (cuando llegan en segundo plano).
export function updateSlide(item) {
  const slide = document.querySelector(`.gallery-slide[data-id="${item.release_id}"]`);
  if (!slide) return;
  fillLabel(slide.querySelector(".gallery-label"), item);
  fillDisc(slide.querySelector(".gallery-disc"), item);
  fillSleeve(slide.querySelector(".gallery-sleeve"), item);
}

function renderSlide(item) {
  const slide = el("button", "gallery-slide");
  slide.type = "button";
  slide.dataset.id = item.release_id;
  slide.setAttribute("aria-label", [item.title, item.artist].filter(Boolean).join(", "));

  // Dos capas: la de fuera desliza el disco fuera de la funda y la de dentro gira.
  const discWrap = el("span", "gallery-disc-wrap");
  const disc = el("span", "gallery-disc");
  const label = el("span", "gallery-label");
  fillLabel(label, item);
  disc.append(label);
  discWrap.append(disc, el("span", "gallery-shine"));
  fillDisc(disc, item);

  const sleeve = el("span", "gallery-sleeve");
  fillSleeve(sleeve, item);

  slide.append(discWrap, sleeve);
  return slide;
}

// items: entradas del historial. onOpen(item): se llama al pulsar el disco que ya está en el centro.
export function renderGallery(items, onOpen) {
  const track = document.getElementById("gallery-track");
  const title = document.getElementById("gallery-title");
  const meta = document.getElementById("gallery-meta");
  const count = document.getElementById("gallery-count");
  const slides = items.map(renderSlide);
  track.replaceChildren(...slides);
  if (!items.length) return;

  let current = -1;
  function select(index) {
    if (index === current) return;
    current = index;
    slides.forEach((slide, i) => {
      slide.classList.toggle("is-selected", i === index);
      slide.setAttribute("aria-current", i === index ? "true" : "false");
    });
    const item = items[index];
    selectedId = item.release_id;
    title.textContent = item.title;
    meta.textContent = [item.artist, yearText(item), isHeavy(item.weight || "") && item.weight].filter(Boolean).join(" · ");
    count.textContent = `${index + 1} de ${items.length}`;
  }

  // El seleccionado es el que tiene su centro más cerca del centro del carrusel.
  function nearestToCenter() {
    const box = track.getBoundingClientRect();
    const center = box.left + box.width / 2;
    let best = 0;
    let bestDistance = Infinity;
    slides.forEach((slide, i) => {
      const r = slide.getBoundingClientRect();
      const distance = Math.abs(r.left + r.width / 2 - center);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  let frame = 0;
  track.onscroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      select(nearestToCenter());
    });
  };

  slides.forEach((slide, i) => {
    slide.addEventListener("click", () => {
      if (i === current) onOpen(items[i]);
      else slide.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
  });

  track.onkeydown = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = slides[Math.min(slides.length - 1, Math.max(0, current + step))];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  // Vuelve al disco que estaba elegido (si sigue existiendo); si no, al primero.
  const start = Math.max(0, items.findIndex((item) => item.release_id === selectedId));
  requestAnimationFrame(() => {
    const slide = slides[start];
    track.scrollLeft = slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2;
    select(start);
  });
}
