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

const SEARCH_STEP_LABELS = {
  barcode: "por código de barras",
  catno: "por número de catálogo",
  "artist-title": "por artista y título",
  text: "por texto libre",
  master: "todas las ediciones del álbum",
};

const VIEWS = ["guide", "settings", "capture", "results", "detail", "history"];
const GUIDE_SCREENS = ["intro", "ai", "discogs"];

function showView(name) {
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
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

function initDebugNav() {
  const nav = document.getElementById("debug-nav");
  nav.addEventListener("click", (event) => {
    const view = event.target.dataset.view;
    if (view === "guide") openGuide();
    else if (view) showView(view);
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

function renderCard(candidate) {
  const card = el("article", "card");

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
  const select = el("button", "card-select", "✓ Es este");
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

async function openDetail(candidate) {
  // Mientras llega la ficha completa se enseña lo que ya sabemos del candidato.
  renderDetail({
    artist: "",
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
  try {
    const release = await getRelease(candidate.id, getDiscogsToken());
    if (request === detailRequest) renderDetail(release);
  } catch (err) {
    if (request === detailRequest) {
      document
        .getElementById("detail-content")
        .append(el("p", "status", `❌ No se pudo cargar la ficha completa: ${err.message}`));
    }
  }
}

function initResults() {
  const manual = document.getElementById("results-manual");
  const input = document.getElementById("results-manual-input");
  const status = document.getElementById("results-manual-status");
  const searchButton = document.getElementById("results-manual-search");

  document.getElementById("results-back").addEventListener("click", () => showView("capture"));

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
      status.textContent = `❌ ${err.message}`;
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
  document.getElementById("detail-back").addEventListener("click", () => showView("results"));
  document.getElementById("detail-new").addEventListener("click", () => {
    resetCapture();
    showView("capture");
  });
}

function initCapture() {
  const cameraInput = document.getElementById("capture-camera-input");
  const galleryInput = document.getElementById("capture-gallery-input");
  const preview = document.getElementById("capture-preview");
  const identifyButton = document.getElementById("capture-identify");
  const status = document.getElementById("capture-status");
  const rawJson = document.getElementById("capture-raw-json");

  let preparedImage = null;

  async function handleFile(file) {
    if (!file) {
      status.textContent = "No se ha recibido ninguna foto (¿se canceló la cámara?).";
      return;
    }
    status.textContent = "Preparando imagen...";
    rawJson.hidden = true;
    try {
      preparedImage = await prepareImage(file);
      preview.src = preparedImage;
      preview.hidden = false;
      identifyButton.hidden = false;
      status.textContent = "";
    } catch (err) {
      status.textContent = `❌ No se pudo preparar la imagen: ${err && err.message ? err.message : err}`;
    }
  }

  cameraInput.addEventListener("change", (event) => handleFile(event.target.files[0]));
  galleryInput.addEventListener("change", (event) => handleFile(event.target.files[0]));

  identifyButton.addEventListener("click", async () => {
    if (!preparedImage) return;
    rawJson.hidden = true;
    identifyButton.disabled = true;

    let currentModel = "";
    let startedAt = Date.now();
    const renderProgress = () => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      status.textContent = `Probando con ${currentModel}... ${seconds} s`;
    };
    const ticker = setInterval(renderProgress, 1000);

    const result = await identify(preparedImage, getAiKey(), (model) => {
      currentModel = model;
      startedAt = Date.now();
      renderProgress();
    });

    clearInterval(ticker);

    if (!result.ok) {
      identifyButton.disabled = false;
      status.textContent = `❌ ${result.reason}`;
      rawJson.textContent = `Diagnóstico:\n${result.attempts.map((a) => `• ${a.model}: ${a.detail}`).join("\n")}`;
      rawJson.hidden = false;
      return;
    }

    const clues = result.data;
    try {
      const { candidates, strategy } = await findCandidates(clues, getDiscogsToken(), (step) => {
        status.textContent = `Buscando en Discogs ${SEARCH_STEP_LABELS[step]}...`;
      });
      if (candidates.length === 0) {
        status.textContent =
          "❌ No encontré este disco en Discogs. Prueba a fotografiar el lomo o la galleta central, o escanea el código de barras.";
        rawJson.textContent = `Lo que leyó la IA:\n${JSON.stringify(clues, null, 2)}`;
        rawJson.hidden = false;
      } else {
        status.textContent = "";
        resetManualSearch(clues);
        renderResults(rankCandidates(candidates, clues), candidates.length, strategy, clues);
      }
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      identifyButton.disabled = false;
    }
  });

  return function resetCapture() {
    preparedImage = null;
    cameraInput.value = "";
    galleryInput.value = "";
    preview.hidden = true;
    preview.removeAttribute("src");
    identifyButton.hidden = true;
    status.textContent = "";
    rawJson.hidden = true;
  };
}

initDebugNav();
populateGuideText();
initGuideNavigation();
initSettings();
const resetCapture = initCapture();
initResults();
initDetail(resetCapture);
if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
