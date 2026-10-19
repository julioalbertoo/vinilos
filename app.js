import {
  getGithubToken,
  setGithubToken,
  clearGithubToken,
  getDiscogsToken,
  setDiscogsToken,
  clearDiscogsToken,
} from "./tokens.js";

const VIEWS = ["guide", "settings", "capture", "results", "detail", "history"];

function showView(name) {
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
  }
}

function initDebugNav() {
  const nav = document.getElementById("debug-nav");
  nav.addEventListener("click", (event) => {
    const view = event.target.dataset.view;
    if (view) showView(view);
  });
}

function initSettings() {
  const githubInput = document.getElementById("github-token-input");
  const discogsInput = document.getElementById("discogs-token-input");
  const status = document.getElementById("settings-status");

  githubInput.value = getGithubToken();
  discogsInput.value = getDiscogsToken();

  document.getElementById("settings-save").addEventListener("click", () => {
    githubInput.value = setGithubToken(githubInput.value);
    discogsInput.value = setDiscogsToken(discogsInput.value);
    status.textContent = "Guardado.";
  });

  document.getElementById("settings-clear").addEventListener("click", () => {
    clearGithubToken();
    clearDiscogsToken();
    githubInput.value = "";
    discogsInput.value = "";
    status.textContent = "Llaves borradas.";
  });
}

initDebugNav();
initSettings();
showView("guide");
