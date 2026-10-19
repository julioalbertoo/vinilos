import {
  getGithubToken,
  setGithubToken,
  clearGithubToken,
  getDiscogsToken,
  setDiscogsToken,
  clearDiscogsToken,
  getGithubTokenAgeDays,
  hasTokens,
} from "./tokens.js";
import { GUIDE_TEXT, isValidGithubTokenFormat } from "./guide.js";
import { testGithubConnection, identify } from "./ai.js";
import { testDiscogsConnection } from "./discogs.js";
import { prepareImage } from "./imaging.js";

const VIEWS = ["guide", "settings", "capture", "results", "detail", "history"];
const GUIDE_SCREENS = ["intro", "github", "discogs"];

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
  showView("guide");
  showGuideScreen("intro");
}

function initDebugNav() {
  const nav = document.getElementById("debug-nav");
  nav.addEventListener("click", (event) => {
    const view = event.target.dataset.view;
    if (view) showView(view);
  });
}

function populateGuideText() {
  document.getElementById("guide-intro-title").textContent = GUIDE_TEXT.intro.title;
  document.getElementById("guide-intro-body").textContent = GUIDE_TEXT.intro.body;
  document.getElementById("guide-intro-next").textContent = GUIDE_TEXT.intro.nextLabel;

  document.getElementById("guide-github-title").textContent = GUIDE_TEXT.github.title;
  const githubSteps = document.getElementById("guide-github-steps");
  githubSteps.replaceChildren(
    ...GUIDE_TEXT.github.steps.map((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    })
  );
  const githubLink = document.getElementById("guide-github-link");
  githubLink.href = GUIDE_TEXT.github.linkUrl;
  githubLink.textContent = GUIDE_TEXT.github.linkLabel;
  document.getElementById("guide-github-notice").textContent = GUIDE_TEXT.privacyNotice;
  document.getElementById("guide-github-paste-label").textContent = GUIDE_TEXT.github.pasteLabel;
  document.getElementById("guide-github-input").placeholder = GUIDE_TEXT.github.placeholder;
  document.getElementById("guide-github-save").textContent = GUIDE_TEXT.github.saveLabel;

  document.getElementById("guide-discogs-title").textContent = GUIDE_TEXT.discogs.title;
  const discogsSteps = document.getElementById("guide-discogs-steps");
  discogsSteps.replaceChildren(
    ...GUIDE_TEXT.discogs.steps.map((step) => {
      const li = document.createElement("li");
      li.textContent = step;
      return li;
    })
  );
  const discogsLink = document.getElementById("guide-discogs-link");
  discogsLink.href = GUIDE_TEXT.discogs.linkUrl;
  discogsLink.textContent = GUIDE_TEXT.discogs.linkLabel;
  document.getElementById("guide-discogs-notice").textContent = GUIDE_TEXT.privacyNotice;
  document.getElementById("guide-discogs-paste-label").textContent = GUIDE_TEXT.discogs.pasteLabel;
  document.getElementById("guide-discogs-input").placeholder = GUIDE_TEXT.discogs.placeholder;
  document.getElementById("guide-discogs-save").textContent = GUIDE_TEXT.discogs.saveLabel;

  document.getElementById("settings-open-guide").textContent = GUIDE_TEXT.reopenLinkLabel;
}

function initGuideNavigation() {
  document.getElementById("guide-intro-next").addEventListener("click", () => {
    showGuideScreen("github");
  });

  document.getElementById("guide-github-back").addEventListener("click", () => {
    showGuideScreen("intro");
  });

  document.getElementById("guide-github-save").addEventListener("click", () => {
    const input = document.getElementById("guide-github-input");
    const hint = document.getElementById("guide-github-hint");
    hint.textContent = isValidGithubTokenFormat(input.value) ? "" : GUIDE_TEXT.github.formatHint;
    input.value = setGithubToken(input.value);
    document.getElementById("github-token-input").value = input.value;
    showGuideScreen("discogs");
  });

  document.getElementById("guide-discogs-back").addEventListener("click", () => {
    showGuideScreen("github");
  });

  document.getElementById("guide-discogs-save").addEventListener("click", () => {
    const input = document.getElementById("guide-discogs-input");
    input.value = setDiscogsToken(input.value);
    document.getElementById("discogs-token-input").value = input.value;
    showView("settings");
  });
}

function refreshGithubAgeWarning() {
  const warning = document.getElementById("settings-github-age-warning");
  const ageDays = getGithubTokenAgeDays();
  if (ageDays !== null && ageDays >= 80) {
    warning.hidden = false;
    warning.textContent = `⚠️ Tu token de GitHub tiene ${ageDays} días. Caduca a los 90: conviene renovarlo pronto.`;
  } else {
    warning.hidden = true;
  }
}

function initSettings() {
  const githubInput = document.getElementById("github-token-input");
  const discogsInput = document.getElementById("discogs-token-input");
  const status = document.getElementById("settings-status");

  githubInput.value = getGithubToken();
  discogsInput.value = getDiscogsToken();
  refreshGithubAgeWarning();

  document.getElementById("settings-save").addEventListener("click", () => {
    githubInput.value = setGithubToken(githubInput.value);
    discogsInput.value = setDiscogsToken(discogsInput.value);
    status.textContent = "Guardado.";
    refreshGithubAgeWarning();
  });

  document.getElementById("settings-clear").addEventListener("click", () => {
    clearGithubToken();
    clearDiscogsToken();
    githubInput.value = "";
    discogsInput.value = "";
    status.textContent = "Llaves borradas.";
    refreshGithubAgeWarning();
  });

  document.getElementById("settings-open-guide").addEventListener("click", openGuide);

  document.getElementById("settings-test-github").addEventListener("click", async () => {
    const result = document.getElementById("settings-test-github-status");
    result.textContent = "Probando...";
    const { ok, reason } = await testGithubConnection(getGithubToken());
    result.textContent = `${ok ? "✅" : "❌"} ${reason}`;
  });

  document.getElementById("settings-test-discogs").addEventListener("click", async () => {
    const result = document.getElementById("settings-test-discogs-status");
    result.textContent = "Probando...";
    const { ok, reason } = await testDiscogsConnection(getDiscogsToken());
    result.textContent = `${ok ? "✅" : "❌"} ${reason}`;
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
    if (!file) return;
    status.textContent = "Preparando imagen...";
    rawJson.hidden = true;
    preparedImage = await prepareImage(file);
    preview.src = preparedImage;
    preview.hidden = false;
    identifyButton.hidden = false;
    status.textContent = "";
  }

  cameraInput.addEventListener("change", (event) => handleFile(event.target.files[0]));
  galleryInput.addEventListener("change", (event) => handleFile(event.target.files[0]));

  identifyButton.addEventListener("click", async () => {
    if (!preparedImage) return;
    status.textContent = "Identificando (puede tardar unos segundos)...";
    rawJson.hidden = true;
    const result = await identify(preparedImage, getGithubToken());
    if (result.ok) {
      status.textContent = `Hecho (modelo: ${result.modelUsed}).`;
      rawJson.textContent = JSON.stringify(result.data, null, 2);
      rawJson.hidden = false;
    } else {
      status.textContent = `❌ ${result.reason}`;
    }
  });
}

initDebugNav();
populateGuideText();
initGuideNavigation();
initSettings();
initCapture();
showView(hasTokens() ? "settings" : "guide");
