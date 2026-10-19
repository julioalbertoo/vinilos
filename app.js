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
import { testDiscogsConnection, findCandidates } from "./discogs.js";
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
  const link = el("a", null, "Ver en Discogs ↗");
  link.href = candidate.url;
  link.target = "_blank";
  link.rel = "noopener";
  body.append(link);

  card.append(body);
  return card;
}

function renderResults(ranked, total, strategy, clues) {
  const how = SEARCH_STEP_LABELS[strategy] || "";
  document.getElementById("results-summary").textContent =
    `${total} ediciones encontradas ${how}. Las ${ranked.length} que mejor encajan:`;
  document.getElementById("results-list").replaceChildren(...ranked.map(renderCard));
  document.getElementById("results-clues-json").textContent = JSON.stringify(clues, null, 2);
  showView("results");
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
        renderResults(rankCandidates(candidates, clues), candidates.length, strategy, clues);
      }
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
    } finally {
      identifyButton.disabled = false;
    }
  });

  document.getElementById("results-back").addEventListener("click", () => showView("capture"));
}

initDebugNav();
populateGuideText();
initGuideNavigation();
initSettings();
initCapture();
if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
