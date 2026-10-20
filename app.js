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
import { GUIDE_TEXT, isValidAiKeyFormat } from "./guide.js";
import { testAiConnection, identify } from "./ai.js";
import { testDiscogsConnection, findCandidates, searchByText, getRelease } from "./discogs.js";
import { prepareImage } from "./imaging.js";
import { rankCandidates } from "./scoring.js";
import { startScanner, describeCameraError } from "./barcode.js";
import { getHistory, addToHistory, removeFromHistory, clearHistory } from "./history.js";

const SEARCH_STEP_LABELS = {
  barcode: "por código de barras",
  catno: "por número de catálogo",
  "artist-title": "por artista y título",
  text: "por texto libre",
  master: "todas las ediciones del álbum",
};

const VIEWS = ["guide", "settings", "capture", "results", "detail", "history"];
const GUIDE_SCREENS = ["intro", "ai", "discogs"];
// Pestaña que se marca en la barra inferior para cada pantalla.
const TAB_FOR_VIEW = { capture: "capture", results: "capture", detail: "capture", history: "history", settings: "settings" };

function showView(name) {
  if (name !== "capture") stopScanner();
  if (name === "history") renderHistory();
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
  }
  // En la primera visita la guía va sin barra: antes de nada hay que conseguir las llaves.
  document.body.classList.toggle("no-tabbar", name === "guide" && !hasTokens());
  for (const tab of document.querySelectorAll("#tabbar button")) {
    tab.classList.toggle("active", tab.dataset.view === TAB_FOR_VIEW[name]);
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

function renderResults(ranked, total, strategy, clues) {
  lastClues = clues;
  const how = SEARCH_STEP_LABELS[strategy] || "";
  document.getElementById("results-summary").textContent =
    `${total} ediciones encontradas ${how}. Las ${ranked.length} que mejor encajan:`;
  document.getElementById("results-list").replaceChildren(...ranked.map(renderCard));
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
  document.getElementById("detail-open").href = release.url;
}

let detailRequest = 0;
let detailReturnView = "results";

// fromHistory: se abre desde el historial, así que no se vuelve a guardar y "Volver" lleva allí.
async function openDetail(candidate, { fromHistory = false } = {}) {
  detailReturnView = fromHistory ? "history" : "results";
  document.getElementById("detail-back").textContent = fromHistory
    ? "← Volver al historial"
    : "← Volver a los candidatos";
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
    if (request === detailRequest) renderDetail(release);
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
  if (item.thumb) {
    const img = el("img", "history-cover");
    img.src = item.thumb;
    img.alt = "";
    img.loading = "lazy";
    open.append(img);
  } else {
    open.append(el("span", "history-cover", "💿"));
  }
  open.append(el("span", "history-title", item.title));
  open.append(el("span", "history-meta", [item.year, item.artist].filter(Boolean).join(" · ")));
  open.addEventListener("click", () => openDetail(historyItemToCandidate(item), { fromHistory: true }));

  const remove = el("button", "history-remove", "✕");
  remove.type = "button";
  remove.setAttribute("aria-label", `Borrar ${item.title} del historial`);
  remove.addEventListener("click", () => {
    removeFromHistory(item.release_id);
    renderHistory();
  });

  wrapper.append(open, remove);
  return wrapper;
}

function renderHistory() {
  const items = getHistory();
  document.getElementById("history-grid").replaceChildren(...items.map(renderHistoryItem));
  document.getElementById("history-empty").hidden = items.length > 0;
  document.getElementById("history-clear").hidden = items.length === 0;
}

function initHistory() {
  document.getElementById("history-start").addEventListener("click", () => showView("capture"));
  document.getElementById("history-clear").addEventListener("click", () => {
    if (window.confirm("¿Borrar todos los discos del historial? No se puede deshacer.")) {
      clearHistory();
      renderHistory();
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
        renderResults(rankCandidates(candidates, lastClues), candidates.length, strategy, lastClues);
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

function initDetail(resetCapture) {
  document.getElementById("detail-back").addEventListener("click", () => showView(detailReturnView));
  document.getElementById("detail-new").addEventListener("click", () => {
    resetCapture();
    showView("capture");
  });
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
        renderResults(rankCandidates(candidates, clues), candidates.length, strategy, clues);
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
  clearTimeout(scanTipTimer);
  if (stopActiveScanner) {
    stopActiveScanner();
    stopActiveScanner = null;
  }
  document.getElementById("scanner").hidden = true;
}

initTabbar();
populateGuideText();
initGuideNavigation();
initSettings();
const resetCapture = initCapture();
initResults(resetCapture);
initDetail(resetCapture);
initHistory();
if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
