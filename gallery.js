// Galería horizontal: cada disco asoma de su funda y el que queda en el centro sale y gira.

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

// Cambia la galleta de un disco ya pintado (cuando se encuentra la real en segundo plano).
export function updateSlideLabel(item) {
  const label = document.querySelector(`.gallery-slide[data-id="${item.release_id}"] .gallery-label`);
  if (label) fillLabel(label, item);
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

  const sleeve = el("span", "gallery-sleeve");
  sleeve.append(item.thumb ? coverImg(item.thumb, "") : el("span", "gallery-sleeve-empty", "💿"));

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
    meta.textContent = [item.artist, item.year].filter(Boolean).join(" · ");
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
