import {
  getAiKey,
  setAiKey,
  clearAiKey,
  markAiVerified,
  getDiscogsToken,
  setDiscogsToken,
  clearDiscogsToken,
  markDiscogsVerified,
  hasTokens,
  areTokensVerified,
} from "./tokens.js";
import { CONFIG } from "./config.js";
import { GUIDE_TEXT, isValidAiKeyFormat } from "./guide.js";
import { testAiConnection, identify } from "./ai.js";
import { testDiscogsConnection, findCandidates, searchByText, getRelease, getPrices, vinylColor, releaseWeight } from "./discogs.js";
import { prepareImage } from "./imaging.js";
import { rankCandidates } from "./scoring.js";
import { startScanner, describeCameraError } from "./barcode.js";
import { getHistory, addToHistory, removeFromHistory, clearHistory } from "./history.js";
import { renderGallery, updateSlide } from "./gallery.js";
import { fillMissingLabels, stopLabelSearch } from "./labels.js";
import { initCloud, takeAuthError, onCloudStatus, onCloudHistoryChanged, onCloudTokensChanged, sendMagicLink, signInWithPassword, setPassword, signOut, syncAll, isCloudReady } from "./cloud.js";

const SEARCH_STEP_LABELS = {
  barcode: "por código de barras",
  catno: "por número de catálogo",
  "artist-title": "por artista y título",
  text: "por texto libre",
  master: "todas las ediciones del álbum",
};

const VIEWS = ["guide", "settings", "capture", "results", "detail", "collection"];
const GUIDE_SCREENS = ["intro", "ai", "discogs"];
// Pestaña que se marca en la barra inferior para cada pantalla.
const TAB_FOR_VIEW = { capture: "capture", results: "capture", collection: "collection", settings: "settings" };

function showView(name) {
  if (name !== "capture") stopScanner();
  if (name === "collection") renderCollection();
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
  }
  // En la primera visita la guía va sin barra: antes de nada hay que conseguir las llaves.
  document.body.classList.toggle("no-tabbar", name === "guide" && !hasTokens());
  for (const tab of document.querySelectorAll("#tabbar button")) {
    // La ficha se marca en la pestaña desde la que se abrió.
    const activeTab = name === "detail" ? TAB_FOR_VIEW[detailReturnView] : TAB_FOR_VIEW[name];
    tab.classList.toggle("active", tab.dataset.view === activeTab);
  }
}

// Muestra un error en `statusEl`; si es un problema de llaves, añade un botón para ir a Ajustes.
function showError(statusEl, message, authError = false) {
  statusEl.textContent = `❌ ${message} `;
  if (authError) {
    const button = el("button", "inline-link", "Revisar mis llaves en Ajustes");
    button.type = "button";
    button.addEventListener("click", () => showView("settings"));
    statusEl.append(button);
  }
}

function showGuideScreen(name) {
  for (const screen of GUIDE_SCREENS) {
    document.getElementById(`guide-screen-${screen}`).hidden = screen !== name;
  }
}

function openGuide() {
  // Rellenar con lo ya guardado evita que "Guardar" en la guía borre una llave existente.
  document.getElementById("guide-ai-input").value = getAiKey();
  document.getElementById("guide-discogs-input").value = getDiscogsToken();
  showView("guide");
  showGuideScreen("intro");
}

// En el iPhone, al abrir el teclado la barra de abajo se sube con él y tapa la caja en la que
// escribes. Mientras hay una caja de texto activa, la barra se esconde.
function isTextField(target) {
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "file"].includes(target.type);
}

function initTypingMode() {
  document.addEventListener("focusin", (event) => {
    if (isTextField(event.target)) document.body.classList.add("typing");
  });
  document.addEventListener("focusout", (event) => {
    if (!isTextField(event.target)) return;
    // Si el foco salta directamente a otra caja, la barra sigue escondida.
    setTimeout(() => {
      if (!isTextField(document.activeElement)) document.body.classList.remove("typing");
    }, 0);
  });
}

function initTabbar() {
  document.getElementById("tabbar").addEventListener("click", (event) => {
    const tab = event.target.closest("button");
    if (tab) {
      showView(tab.dataset.view);
      window.scrollTo(0, 0);
    }
  });
}

function populateKeyScreen(prefix, text) {
  document.getElementById(`guide-${prefix}-title`).textContent = text.title;
  document.getElementById(`guide-${prefix}-steps`).replaceChildren(
    ...text.steps.map((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    })
  );
  const link = document.getElementById(`guide-${prefix}-link`);
  link.href = text.linkUrl;
  link.textContent = text.linkLabel;
  document.getElementById(`guide-${prefix}-notice`).textContent = GUIDE_TEXT.privacyNotice;
  document.getElementById(`guide-${prefix}-paste-label`).textContent = text.pasteLabel;
  document.getElementById(`guide-${prefix}-input`).placeholder = text.placeholder;
  document.getElementById(`guide-${prefix}-save`).textContent = text.saveLabel;
}

function populateGuideText() {
  document.getElementById("guide-intro-title").textContent = GUIDE_TEXT.intro.title;
  document.getElementById("guide-intro-body").textContent = GUIDE_TEXT.intro.body;
  document.getElementById("guide-intro-next").textContent = GUIDE_TEXT.intro.nextLabel;
  populateKeyScreen("ai", GUIDE_TEXT.ai);
  populateKeyScreen("discogs", GUIDE_TEXT.discogs);
  document.getElementById("settings-open-guide").textContent = GUIDE_TEXT.reopenLinkLabel;
}

function initGuideNavigation() {
  document.getElementById("guide-intro-next").addEventListener("click", () => {
    showGuideScreen("ai");
  });

  document.getElementById("guide-ai-back").addEventListener("click", () => {
    showGuideScreen("intro");
  });

  document.getElementById("guide-ai-save").addEventListener("click", () => {
    const input = document.getElementById("guide-ai-input");
    const hint = document.getElementById("guide-ai-hint");
    hint.textContent = isValidAiKeyFormat(input.value) ? "" : GUIDE_TEXT.ai.formatHint;
    input.value = setAiKey(input.value);
    document.getElementById("ai-key-input").value = input.value;
    showGuideScreen("discogs");
  });

  document.getElementById("guide-discogs-back").addEventListener("click", () => {
    showGuideScreen("ai");
  });

  document.getElementById("guide-discogs-save").addEventListener("click", () => {
    const input = document.getElementById("guide-discogs-input");
    input.value = setDiscogsToken(input.value);
    document.getElementById("discogs-token-input").value = input.value;
    showView("settings");
  });
}

function initSettings() {
  const aiInput = document.getElementById("ai-key-input");
  const discogsInput = document.getElementById("discogs-token-input");
  const status = document.getElementById("settings-status");

  aiInput.value = getAiKey();
  discogsInput.value = getDiscogsToken();

  document.getElementById("settings-save").addEventListener("click", () => {
    aiInput.value = setAiKey(aiInput.value);
    discogsInput.value = setDiscogsToken(discogsInput.value);
    status.textContent = "Guardado.";
  });

  document.getElementById("settings-clear").addEventListener("click", () => {
    clearAiKey();
    clearDiscogsToken();
    aiInput.value = "";
    discogsInput.value = "";
    status.textContent = "Llaves borradas.";
  });

  document.getElementById("settings-open-guide").addEventListener("click", openGuide);

  document.getElementById("settings-test-ai").addEventListener("click", async () => {
    const result = document.getElementById("settings-test-ai-status");
    result.textContent = "Probando...";
    const { ok, reason } = await testAiConnection(getAiKey());
    markAiVerified(ok);
    result.textContent = `${ok ? "✅" : "❌"} ${reason}`;
  });

  document.getElementById("settings-test-discogs").addEventListener("click", async () => {
    const result = document.getElementById("settings-test-discogs-status");
    result.textContent = "Probando...";
    const { ok, reason } = await testDiscogsConnection(getDiscogsToken());
    markDiscogsVerified(ok);
    result.textContent = `${ok ? "✅" : "❌"} ${reason}`;
  });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function renderCard(candidate, index) {
  const best = index === 0;
  const card = el("article", best ? "card card--best" : "card");
  if (best) card.append(el("span", "card-badge", "★ Mejor coincidencia"));

  if (candidate.thumb) {
    const img = el("img", "card-thumb");
    img.src = candidate.thumb;
    img.alt = "";
    img.loading = "lazy";
    card.append(img);
  } else {
    card.append(el("div", "card-thumb", "💿"));
  }

  const body = el("div", "card-body");
  body.append(el("h3", null, candidate.title));
  body.append(el("p", null, [candidate.year || "Año ?", candidate.country || "País ?"].join(" · ")));
  body.append(el("p", null, [candidate.label || "Sello ?", candidate.catno || "Nº cat. ?"].join(" · ")));
  body.append(el("p", null, candidate.formats.join(", ")));
  if (candidate.color) body.append(el("p", "card-color", `🎨 ${candidate.color}`));
  if (candidate.weight) body.append(el("p", "card-weight", `⚖️ ${candidate.weight}`));
  if (candidate.matches.length) {
    body.append(el("p", "card-matches", candidate.matches.map((m) => `✓ ${m}`).join("  ")));
  }
  // Solo el mejor candidato lleva el botón lila: es la acción más probable.
  const select = el("button", best ? "card-select" : "card-select secondary", "✓ Es este");
  select.type = "button";
  select.addEventListener("click", () => openDetail(candidate));
  body.append(select);

  const link = el("a", null, "Ver en Discogs ↗");
  link.href = candidate.url;
  link.target = "_blank";
  link.rel = "noopener";
  body.append(link);

  card.append(body);
  return card;
}

let lastClues = {};

const RESULTS_STEP = 5;

// ranked: todas las ediciones ordenadas de mejor a peor. Se enseñan de 5 en 5 con «Ver 5 más».
function renderResults(ranked, total, strategy, clues) {
  lastClues = clues;
  const how = SEARCH_STEP_LABELS[strategy] || "";
  const summary = document.getElementById("results-summary");
  const list = document.getElementById("results-list");
  const more = document.getElementById("results-more");
  let shown = 0;
  function showMore() {
    const next = ranked.slice(shown, shown + RESULTS_STEP);
    list.append(...next.map((candidate, i) => renderCard(candidate, shown + i)));
    shown += next.length;
    summary.textContent = `${total} ediciones encontradas ${how}. Las ${shown} que mejor encajan:`;
    const left = ranked.length - shown;
    more.hidden = left <= 0;
    more.textContent =
      left > RESULTS_STEP ? `Ver ${RESULTS_STEP} más (quedan ${left})` : left === 1 ? "Ver la que queda" : `Ver las ${left} que quedan`;
  }
  list.replaceChildren();
  more.onclick = showMore;
  showMore();
  document.getElementById("results-clues-json").textContent = JSON.stringify(clues, null, 2);
  showView("results");
  window.scrollTo(0, 0);
}

function resetManualSearch(clues) {
  document.getElementById("results-manual").hidden = true;
  document.getElementById("results-manual-input").value = [clues.artist, clues.title].filter(Boolean).join(" ");
  document.getElementById("results-manual-status").textContent = "";
}

function formatLine(format) {
  const qty = format.qty && format.qty !== "1" ? `${format.qty} × ` : "";
  return qty + [format.name, ...format.descriptions].filter(Boolean).join(", ");
}

function renderDetail(release) {
  const nodes = [];
  if (release.image) {
    const img = el("img", "detail-cover");
    img.src = release.image;
    img.alt = "Portada";
    nodes.push(img);
  }
  nodes.push(el("h2", null, release.artist ? `${release.artist} – ${release.title}` : release.title));
  nodes.push(el("p", "detail-meta", [release.year || "Año ?", release.country || "País ?"].join(" · ")));
  for (const label of release.labels) {
    nodes.push(el("p", "detail-meta", `${label.name || "Sello ?"} · ${label.catno || "Nº cat. ?"}`));
  }
  for (const format of release.formats) {
    nodes.push(el("p", "detail-meta", formatLine(format)));
    if (format.text) nodes.push(el("p", "detail-meta detail-color", `Edición: ${format.text}`));
  }
  // La caja del precio solo se pone con la ficha completa (tiene id); se rellena al llegar los datos.
  if (release.id) {
    const price = el("div", "detail-price");
    price.id = "detail-price";
    price.append(el("p", "detail-price-title", "💶 Precio de esta edición"), el("p", "detail-price-note", "Buscando precio en Discogs…"), spainLink(release.id));
    nodes.push(price);
  }
  if (release.tracklist.length) {
    nodes.push(el("h3", null, "Canciones"));
    const list = el("ul", "detail-tracks");
    for (const track of release.tracklist) {
      const li = el("li");
      li.append(el("span", "pos", track.position), track.title);
      list.append(li);
    }
    nodes.push(list);
  }
  document.getElementById("detail-content").replaceChildren(...nodes);
}

function formatMoney({ value, currency }) {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(value);
  } catch {
    return `${Number(value).toFixed(2)} ${currency || ""}`.trim();
  }
}

// Abre en Discogs las copias de esta edición a la venta que se envían desde España.
function spainLink(id) {
  const link = el("a", "detail-price-spain", "🇪🇸 Ver las que se venden desde España ↗");
  link.href = `https://www.discogs.com/sell/release/${id}?ships_from=Spain`;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function renderPrices(id, prices) {
  const box = document.getElementById("detail-price");
  if (!box) return;
  const nodes = [el("p", "detail-price-title", "💶 Precio de esta edición")];
  if (prices.blocked) {
    nodes.push(el("p", "detail-price-note", "Discogs no permite vender esta edición."));
  } else if (prices.lowest) {
    const copies = prices.forSale === 1 ? "1 copia" : `${prices.forSale} copias`;
    nodes.push(el("p", "detail-price-main", `En venta desde ${formatMoney(prices.lowest)}`));
    nodes.push(el("p", "detail-price-note", `${copies} a la venta ahora`));
  } else {
    nodes.push(el("p", "detail-price-note", "Ahora mismo nadie la vende en Discogs."));
  }
  if (prices.suggested.length) {
    nodes.push(el("p", "detail-price-sub", "Precio sugerido según el estado:"));
    const row = el("div", "detail-price-grades");
    for (const s of prices.suggested) {
      const chip = el("span", "detail-price-chip");
      chip.append(el("b", null, s.grade), ` ${formatMoney(s)}`);
      row.append(chip);
    }
    nodes.push(row);
  }
  nodes.push(spainLink(id));
  box.replaceChildren(...nodes);
}

async function loadPrices(id, request) {
  try {
    const prices = await getPrices(id, getDiscogsToken());
    if (request === detailRequest) renderPrices(id, prices);
  } catch (err) {
    const box = document.getElementById("detail-price");
    if (request === detailRequest && box) {
      box.replaceChildren(el("p", "detail-price-title", "💶 Precio de esta edición"),
        el("p", "detail-price-note", `No se pudo consultar el precio: ${err.message}`), spainLink(id));
    }
  }
}

let detailRequest = 0;
let detailReturnView = "results";

const BACK_LABELS = {
  results: "← Volver a los candidatos",
  collection: "← Volver a mis discos",
};

// returnView: pantalla a la que lleva "Volver". Desde «Mis discos» el disco ya está
// guardado, así que no se vuelve a guardar.
async function openDetail(candidate, { returnView = "results" } = {}) {
  const fromHistory = returnView !== "results";
  detailReturnView = returnView;
  document.getElementById("detail-back").textContent = BACK_LABELS[returnView];
  const savedNote = document.getElementById("detail-saved");
  savedNote.textContent = "";

  // Mientras llega la ficha completa se enseña lo que ya sabemos del candidato.
  renderDetail({
    artist: candidate.artist || "",
    title: candidate.title,
    year: candidate.year,
    country: candidate.country,
    labels: [{ name: candidate.label, catno: candidate.catno }],
    formats: [{ name: candidate.formats.join(", "), qty: "1", descriptions: [], text: "" }],
    image: candidate.thumb,
    tracklist: [],
    url: candidate.url,
  });
  showView("detail");
  window.scrollTo(0, 0);

  const request = ++detailRequest;
  let release = null;
  try {
    release = await getRelease(candidate.id, getDiscogsToken());
    if (request === detailRequest) {
      renderDetail(release);
      loadPrices(release.id, request);
    }
  } catch (err) {
    if (request === detailRequest) {
      const note = el("p", "status");
      showError(note, `No se pudo cargar la ficha completa: ${err.message}`, err.authError);
      document.getElementById("detail-content").append(note);
    }
  }

  if (!fromHistory) {
    // Si la ficha no llegó, se guarda con los datos del candidato para no perder la confirmación.
    try {
      addToHistory({
        release_id: candidate.id,
        artist: release ? release.artist : candidate.artist || "",
        title: release ? release.title : candidate.title,
        year: String((release ? release.year : candidate.year) || ""),
        thumb: (release && release.thumb) || candidate.thumb || "",
        cover: (release && release.image) || "",
        // Color del vinilo ("" si es negro); sin ficha se usa el del candidato si lo traía.
        color: release ? vinylColor(release.formats.map((f) => f.text)) : candidate.color || undefined,
        // Gramaje ("180 g"; "" si Discogs no lo dice).
        weight: release ? releaseWeight(release) : candidate.weight || undefined,
      });
      if (request === detailRequest) savedNote.textContent = "✓ Guardado en tu historial";
    } catch {
      if (request === detailRequest) savedNote.textContent = "❌ No se pudo guardar en el historial (¿memoria del navegador llena?).";
    }
  }
}

function historyItemToCandidate(item) {
  return {
    id: item.release_id,
    artist: item.artist,
    title: item.title,
    year: item.year,
    country: "",
    label: "",
    catno: "",
    formats: [],
    thumb: item.thumb,
    url: `https://www.discogs.com/release/${item.release_id}`,
  };
}

function renderHistoryItem(item) {
  const wrapper = el("div", "history-item");

  const open = el("button", "history-open");
  open.type = "button";
  if (item.cover || item.thumb) {
    const img = el("img", "history-cover");
    img.src = item.cover || item.thumb;
    img.alt = "";
    img.loading = "lazy";
    open.append(img);
  } else {
    open.append(el("span", "history-cover", "💿"));
  }
  open.append(el("span", "history-title", item.title));
  open.append(el("span", "history-meta", [item.year, item.artist].filter(Boolean).join(" · ")));
  open.addEventListener("click", () => openDetail(historyItemToCandidate(item), { returnView: "collection" }));

  const remove = el("button", "history-remove", "✕");
  remove.type = "button";
  remove.setAttribute("aria-label", `Borrar ${item.title} del historial`);
  remove.addEventListener("click", () => {
    if (!window.confirm(`¿Borrar «${item.title}» de tus discos? No se puede deshacer.`)) return;
    removeFromHistory(item.release_id);
    renderCollection();
  });

  wrapper.append(open, remove);
  return wrapper;
}

// «Mis discos» se abre en galería; el modo elegido se mantiene al volver de una ficha.
let collectionMode = "gallery";

// Orden de «Mis discos». "recent" es el del historial (último confirmado primero). Se recuerda en el móvil.
const SORT_KEY = CONFIG.STORAGE_KEYS.collectionSort;
let collectionSort = "recent";
try {
  collectionSort = localStorage.getItem(SORT_KEY) || "recent";
} catch {
  // Sin almacenamiento: se queda en «Recientes».
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

// Quita "The " / "Los " / "El "... del principio para que "The Beatles" vaya en la B.
function sortName(text) {
  return String(text || "").replace(/^(the|los|las|el|la)\s+/i, "").trim();
}

function sortItems(items) {
  const list = [...items];
  const byText = (field) => (a, b) => {
    const x = sortName(a[field]);
    const y = sortName(b[field]);
    if (!x !== !y) return x ? -1 : 1; // los vacíos al final
    return collator.compare(x, y);
  };
  if (collectionSort === "year") {
    // Del más antiguo al más nuevo; los que no tienen año, al final. A igual año, por artista.
    const year = (item) => Number.parseInt(item.year, 10) || Infinity;
    list.sort((a, b) => year(a) - year(b) || byText("artist")(a, b));
  } else if (collectionSort === "artist") {
    // A igual artista, sus discos por año.
    const year = (item) => Number.parseInt(item.year, 10) || Infinity;
    list.sort((a, b) => byText("artist")(a, b) || year(a) - year(b));
  } else if (collectionSort === "title") {
    list.sort(byText("title"));
  }
  return list;
}

function renderCollection() {
  const items = sortItems(getHistory());
  const empty = items.length === 0;
  const grid = collectionMode === "grid";
  document.getElementById("collection-empty").hidden = !empty;
  document.getElementById("collection-switch").hidden = empty;
  document.getElementById("collection-sort").hidden = empty;
  for (const button of document.querySelectorAll("#collection-sort button")) {
    const active = button.dataset.sort === collectionSort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.getElementById("gallery-content").hidden = empty || grid;
  document.getElementById("history-grid").hidden = empty || !grid;
  document.getElementById("history-clear").hidden = empty || !grid;
  for (const button of document.querySelectorAll("#collection-switch button")) {
    const active = button.dataset.mode === collectionMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (empty) {
    document.getElementById("history-grid").replaceChildren();
    document.getElementById("gallery-track").replaceChildren();
    return;
  }
  // Busca en segundo plano la galleta real de los discos que aún no la tienen.
  fillMissingLabels(getAiKey(), getDiscogsToken(), updateSlide, (text) => {
    document.getElementById("gallery-label-status").textContent = text;
  });
  if (grid) {
    document.getElementById("history-grid").replaceChildren(...items.map(renderHistoryItem));
  } else {
    renderGallery(items, (item) => openDetail(historyItemToCandidate(item), { returnView: "collection" }));
  }
}

function initHistory() {
  document.getElementById("collection-start").addEventListener("click", () => showView("capture"));
  document.getElementById("collection-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.dataset.mode === collectionMode) return;
    collectionMode = button.dataset.mode;
    renderCollection();
  });
  document.getElementById("collection-sort").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.dataset.sort === collectionSort) return;
    collectionSort = button.dataset.sort;
    try {
      localStorage.setItem(SORT_KEY, collectionSort);
    } catch {
      // Si no se puede guardar, el orden vale hasta cerrar la app.
    }
    renderCollection();
  });
  document.getElementById("history-clear").addEventListener("click", () => {
    const where = cloudSignedIn ? " También se borrarán de la nube." : "";
    if (window.confirm(`¿Borrar todos tus discos guardados?${where} No se puede deshacer.`)) {
      clearHistory();
      renderCollection();
    }
  });
}

function initResults(resetCapture) {
  const manual = document.getElementById("results-manual");
  const input = document.getElementById("results-manual-input");
  const status = document.getElementById("results-manual-status");
  const searchButton = document.getElementById("results-manual-search");

  document.getElementById("results-back").addEventListener("click", () => {
    resetCapture();
    showView("capture");
  });

  document.getElementById("results-none").addEventListener("click", () => {
    manual.hidden = false;
    input.focus();
  });

  async function runManualSearch() {
    const text = input.value.trim();
    if (!text) return;
    searchButton.disabled = true;
    status.textContent = "Buscando en Discogs...";
    try {
      const { candidates, strategy } = await searchByText(text, getDiscogsToken());
      if (candidates.length === 0) {
        status.textContent = `❌ No hay resultados para "${text}". Prueba con menos palabras o con el número de catálogo.`;
      } else {
        status.textContent = "";
        renderResults(rankCandidates(candidates, lastClues, Infinity), candidates.length, strategy, lastClues);
      }
    } catch (err) {
      showError(status, err.message, err.authError);
    } finally {
      searchButton.disabled = false;
    }
  }

  searchButton.addEventListener("click", runManualSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") runManualSearch();
  });
}

function initDetail() {
  document.getElementById("detail-back").addEventListener("click", () => showView(detailReturnView));
}

function initCapture() {
  const view = document.getElementById("view-capture");
  const cameraInput = document.getElementById("capture-camera-input");
  const galleryInput = document.getElementById("capture-gallery-input");
  const previewWrap = document.getElementById("capture-preview-wrap");
  const preview = document.getElementById("capture-preview");
  const retryButton = document.getElementById("capture-identify");
  const cameraLabel = document.getElementById("capture-camera-label");
  const status = document.getElementById("capture-status");
  const rawJson = document.getElementById("capture-raw-json");

  let preparedImage = null;
  // Cada foto nueva invalida lo que estuviera en marcha con la anterior.
  let identifyRun = 0;

  function setBusy(busy) {
    previewWrap.classList.toggle("busy", busy);
    status.classList.toggle("loading", busy);
  }

  async function handleFile(file) {
    if (!file) {
      status.textContent = "No se ha recibido ninguna foto (¿se canceló la cámara?).";
      return;
    }
    const run = ++identifyRun;
    stopScanner();
    retryButton.hidden = true;
    rawJson.hidden = true;
    setBusy(true);
    status.textContent = "Preparando la foto...";
    try {
      const image = await prepareImage(file);
      if (run !== identifyRun) return;
      preparedImage = image;
      preview.src = image;
      previewWrap.hidden = false;
      view.classList.add("has-photo");
      cameraLabel.textContent = "📷 Hacer otra foto";
      window.scrollTo(0, 0);
    } catch (err) {
      if (run !== identifyRun) return;
      setBusy(false);
      status.textContent = `❌ No se pudo preparar la imagen: ${err && err.message ? err.message : err}`;
      return;
    }
    // Se identifica nada más subir la foto: el usuario no tiene que pulsar nada más.
    await runIdentify(run);
  }

  cameraInput.addEventListener("change", (event) => {
    handleFile(event.target.files[0]);
    event.target.value = "";
  });
  galleryInput.addEventListener("change", (event) => {
    handleFile(event.target.files[0]);
    event.target.value = "";
  });

  async function runIdentify(run) {
    if (!preparedImage) return;
    if (!hasTokens()) {
      setBusy(false);
      openGuide();
      return;
    }
    rawJson.hidden = true;
    retryButton.hidden = true;
    setBusy(true);

    let currentModel = "";
    let fallbackNote = "";
    let startedAt = Date.now();
    const renderProgress = () => {
      if (run !== identifyRun) return;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      status.textContent = `${fallbackNote}Leyendo la foto${currentModel ? ` con ${currentModel}` : ""}... ${seconds} s`;
    };
    const ticker = setInterval(renderProgress, 1000);

    stopLabelSearch();
    const result = await identify(preparedImage, getAiKey(), (model, previousFailure) => {
      currentModel = model;
      fallbackNote = previousFailure ? `El modelo principal no respondió (${previousFailure}). Reintento con el de respaldo. ` : "";
      startedAt = Date.now();
      renderProgress();
    });

    clearInterval(ticker);
    if (run !== identifyRun) return;

    if (!result.ok) {
      setBusy(false);
      retryButton.hidden = false;
      showError(status, result.reason, result.authError);
      rawJson.textContent = `Diagnóstico:\n${result.attempts.map((a) => `• ${a.model}: ${a.detail}`).join("\n")}`;
      rawJson.hidden = false;
      return;
    }

    await searchAndShow(result.data, "foto", run);
    if (run === identifyRun) setBusy(false);
  }

  retryButton.addEventListener("click", () => runIdentify(++identifyRun));

  async function searchAndShow(clues, source, run = identifyRun) {
    status.classList.add("loading");
    try {
      const { candidates, strategy } = await findCandidates(clues, getDiscogsToken(), (step) => {
        if (run === identifyRun) status.textContent = `Buscando en Discogs ${SEARCH_STEP_LABELS[step]}...`;
      });
      if (run !== identifyRun) return;
      status.classList.remove("loading");
      if (candidates.length === 0) {
        status.textContent =
          source === "barcode"
            ? `❌ El código ${clues.barcode} no está en Discogs. Prueba con una foto de la portada o de la galleta central.`
            : "❌ No encontré este disco en Discogs. Prueba a fotografiar el lomo o la galleta central, o escanea el código de barras.";
        rawJson.textContent = `Pistas usadas:\n${JSON.stringify(clues, null, 2)}`;
        rawJson.hidden = false;
      } else {
        status.textContent = "";
        resetManualSearch(clues);
        renderResults(rankCandidates(candidates, clues, Infinity), candidates.length, strategy, clues);
      }
    } catch (err) {
      if (run !== identifyRun) return;
      status.classList.remove("loading");
      showError(status, err.message, err.authError);
    }
  }

  function resetCapture() {
    stopScanner();
    identifyRun++;
    preparedImage = null;
    cameraInput.value = "";
    galleryInput.value = "";
    setBusy(false);
    previewWrap.hidden = true;
    preview.removeAttribute("src");
    view.classList.remove("has-photo");
    cameraLabel.textContent = "📷 Hacer foto";
    retryButton.hidden = true;
    status.textContent = "";
    rawJson.hidden = true;
  }

  const scanButton = document.getElementById("capture-scan");
  scanButton.addEventListener("click", async () => {
    if (!getDiscogsToken()) {
      openGuide();
      return;
    }
    resetCapture();
    const session = ++scanSession;
    document.getElementById("scanner").hidden = false;
    // Mientras se escanea, la cámara ocupa la pantalla: se ocultan el disco decorativo y los botones.
    view.classList.add("scanning");
    window.scrollTo(0, 0);
    const scannerPhoto = document.getElementById("scanner-photo");
    scannerPhoto.hidden = true;
    const scannerStatus = document.getElementById("scanner-status");
    scannerStatus.textContent = "Abriendo la cámara...";
    scanButton.disabled = true;
    try {
      const stop = await startScanner(
        document.getElementById("scanner-video"),
        (code) => {
          if (session !== scanSession) return;
          stopScanner();
          status.textContent = `Código leído: ${code}.`;
          searchAndShow(barcodeClues(code), "barcode");
        },
        (error) => {
          if (session !== scanSession) return;
          stopScanner();
          status.textContent = `❌ El lector de códigos se ha detenido (${error.message}). Vuelve a intentarlo o usa «Hacer foto» con la contraportada.`;
        }
      );
      // Si se canceló o ya se leyó un código mientras arrancaba la cámara, se apaga ya.
      if (session !== scanSession) stop();
      else {
        stopActiveScanner = stop;
        scannerStatus.textContent = "Apunta la cámara al código de barras de la contraportada.";
        scanTipTimer = setTimeout(() => {
          if (session !== scanSession) return;
          scannerStatus.textContent = SCAN_TIP;
          scannerPhoto.hidden = false;
        }, SCAN_TIP_DELAY_MS);
      }
    } catch (err) {
      if (session === scanSession) {
        stopScanner();
        status.textContent = `❌ ${describeCameraError(err)}`;
      }
    } finally {
      scanButton.disabled = false;
    }
  });
  document.getElementById("scanner-cancel").addEventListener("click", stopScanner);
  document.getElementById("scanner-photo").addEventListener("click", () => {
    stopScanner();
    cameraInput.click();
  });

  return resetCapture;
}

function barcodeClues(code) {
  return {
    artist: null,
    title: null,
    label: null,
    catalog_number: null,
    barcode: code,
    country: null,
    year_hint: null,
    format_hint: null,
    visible_text: null,
    confidence: 1,
  };
}

const SCAN_TIP_DELAY_MS = 6000;
const SCAN_TIP =
  "¿No lo lee? Acércate hasta que el código ocupe casi todo el ancho del visor e inclina un poco el disco para quitar reflejos. " +
  "O pulsa el botón de abajo: haces una foto y la IA lee los números impresos del código.";

let scanSession = 0;
let stopActiveScanner = null;
let scanTipTimer = null;

function stopScanner() {
  scanSession++;
  document.getElementById("view-capture").classList.remove("scanning");
  clearTimeout(scanTipTimer);
  if (stopActiveScanner) {
    stopActiveScanner();
    stopActiveScanner = null;
  }
  document.getElementById("scanner").hidden = true;
}

// ---------- Copia en la nube ----------

let cloudSignedIn = false;
// Aviso que no se borra con los cambios de estado de la nube (p. ej. un enlace del correo caducado).
let cloudPinnedMessage = "";

function initCloudSettings() {
  const signedOut = document.getElementById("cloud-signed-out");
  const signedIn = document.getElementById("cloud-signed-in");
  const emailInput = document.getElementById("cloud-email");
  const passwordInput = document.getElementById("cloud-password");
  const status = document.getElementById("cloud-status");
  const sendButton = document.getElementById("cloud-send");
  const loginButton = document.getElementById("cloud-login");

  onCloudStatus(({ user, state, text }) => {
    cloudSignedIn = Boolean(user);
    signedOut.hidden = cloudSignedIn;
    signedIn.hidden = !cloudSignedIn;
    if (user) document.getElementById("cloud-user-email").textContent = user.email || "";
    if (cloudSignedIn) cloudPinnedMessage = "";
    status.textContent = state === "off" ? cloudPinnedMessage : text;
    document.getElementById("collection-cloud-status").textContent = cloudSignedIn || state === "error" ? text : "";
  });

  // Si la sincronización trae o quita discos, se repinta «Mis discos» si está a la vista.
  onCloudHistoryChanged(() => {
    if (document.getElementById("view-collection").classList.contains("active")) renderCollection();
  });

  sendButton.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      status.textContent = "❌ Escribe un email válido.";
      return;
    }
    sendButton.disabled = true;
    cloudPinnedMessage = "";
    status.textContent = "Enviando…";
    try {
      await sendMagicLink(email);
      status.textContent = `✅ Correo enviado a ${email}. Pulsa el enlace una sola vez (cada enlace sirve una vez).`;
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      sendButton.disabled = false;
    }
  });

  async function login() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      status.textContent = "❌ Escribe tu email y tu contraseña.";
      return;
    }
    loginButton.disabled = true;
    cloudPinnedMessage = "";
    status.textContent = "Entrando…";
    try {
      await signInWithPassword(email, password);
      passwordInput.value = "";
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      loginButton.disabled = false;
    }
  }
  loginButton.addEventListener("click", login);
  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });

  const newPasswordInput = document.getElementById("cloud-new-password");
  const setPasswordButton = document.getElementById("cloud-set-password");
  setPasswordButton.addEventListener("click", async () => {
    const password = newPasswordInput.value;
    if (password.length < 8) {
      status.textContent = "❌ Usa al menos 8 caracteres.";
      return;
    }
    setPasswordButton.disabled = true;
    status.textContent = "Guardando…";
    try {
      await setPassword(password);
      newPasswordInput.value = "";
      status.textContent = "✅ Contraseña guardada. Úsala con tu email para entrar en la app de la pantalla de inicio.";
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      setPasswordButton.disabled = false;
    }
  });

  // Si la nube trae llaves (p. ej. en un móvil nuevo), se ponen en Ajustes y, si ya estaban
  // comprobadas, se salta la guía de bienvenida.
  onCloudTokensChanged(() => {
    document.getElementById("ai-key-input").value = getAiKey();
    document.getElementById("discogs-token-input").value = getDiscogsToken();
    const onGuide = document.getElementById("view-guide").classList.contains("active");
    const onSettings = document.getElementById("view-settings").classList.contains("active");
    if (areTokensVerified() && (onGuide || onSettings)) showView("capture");
    else if (hasTokens() && onGuide) showView("settings");
  });

  document.getElementById("guide-intro-cloud").addEventListener("click", () => {
    showView("settings");
    document.getElementById("cloud-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    if (!signedOut.hidden) emailInput.focus();
  });

  document.getElementById("cloud-sync").addEventListener("click", () => syncAll());

  document.getElementById("cloud-signout").addEventListener("click", async () => {
    await signOut();
    status.textContent = "Sesión cerrada. Tus discos siguen en este móvil.";
  });

  // Vuelta de un enlace del correo que ya no vale: se explica en Ajustes, junto al acceso con contraseña.
  const linkError = takeAuthError();
  if (linkError) {
    cloudPinnedMessage = `❌ ${linkError}`;
    status.textContent = cloudPinnedMessage;
  }

  initCloud().then(() => {
    if (!isCloudReady()) sendButton.disabled = true;
  });
}

initTabbar();
initTypingMode();
populateGuideText();
initGuideNavigation();
initSettings();
const resetCapture = initCapture();
initResults(resetCapture);
initDetail();
initHistory();
initCloudSettings();
if (cloudPinnedMessage) {
  showView("settings");
  setTimeout(() => document.getElementById("cloud-status").scrollIntoView({ block: "center" }), 0);
} else if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
