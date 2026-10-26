import {
  getAiKey,
  setAiKey,
  clearAiKey,
  markAiVerified,
  getDiscogsToken,
  setDiscogsToken,
  getGeniusToken,
  setGeniusToken,
  clearDiscogsToken,
  markDiscogsVerified,
  hasTokens,
  areTokensVerified,
} from "./tokens.js";
import { CONFIG } from "./config.js";
import { GUIDE_TEXT, isValidAiKeyFormat } from "./guide.js";
import { testAiConnection, identify, geminiModels, probeModel } from "./ai.js";
import { quotaReport, nextPacificMidnight } from "./quota.js";
import { testDiscogsConnection, vinylVersions, findCandidates, searchByText, getMasterYear, masterMainRelease, popularVinylVersions, findAlbumRelease, bothYears, countryWithFlag, vinylColor, COLOR_REV, releaseWeight, releaseDiscs } from "./discogs.js";
import { prepareImage } from "./imaging.js";
import { rankCandidates } from "./scoring.js";
import { startScanner, describeCameraError } from "./barcode.js";
import { getHistory, addToHistory, removeFromHistory, clearHistory, updateHistoryItem } from "./history.js";
import { renderGallery, updateSlide } from "./gallery.js";
import { cachedRelease, rememberRelease, cachedPrices, cachedCheapest, fillDurations, DURATIONS_CHECK } from "./details.js";
import { renderStats, setStatsActive, estimate, priceSource } from "./stats.js";
import { renderArtistIndex, renderArtistPage, hasArtistPage, cleanName as cleanArtistName } from "./artist.js";
import { fillMissingLabels, stopLabelSearch, retryLabel } from "./labels.js";
import { loadTrivia } from "./trivia.js";
import { getExplored, addExplored, removeExplored, clearExplored } from "./explored.js";
import { getWantlist, isWanted, toggleWanted, removeWanted, removeWantedRelease } from "./wantlist.js";
import { initAutoUpdate, currentVersion, latestVersion, reloadTo } from "./updater.js";
import { initCloud, takeAuthError, onCloudStatus, onCloudHistoryChanged, onCloudTokensChanged, sendMagicLink, signInWithPassword, setPassword, signOut, syncAll, isCloudReady } from "./cloud.js";

const SEARCH_STEP_LABELS = {
  barcode: "por código de barras",
  catno: "por número de catálogo",
  "artist-title": "por artista y título",
  text: "por texto libre",
  master: "todas las ediciones del álbum",
};

const VIEWS = ["guide", "settings", "capture", "results", "detail", "collection", "artist", "wantlist", "explored", "versions"];
const GUIDE_SCREENS = ["intro", "ai", "discogs"];
// Pestaña que se marca en la barra inferior para cada pantalla.
const TAB_FOR_VIEW = { capture: "capture", results: "capture", collection: "collection", settings: "settings", wantlist: "collection", explored: "capture" };

// ---------- Botón «atrás» del navegador ----------
// La app es una sola página: para que «atrás» (o deslizar desde el borde en el iPhone) haga lo mismo que
// «← Volver», cada pantalla de detalle (candidatos, ficha, artista) deja una marca en el historial.
const SUB_VIEWS = ["results", "detail", "artist", "wantlist", "explored", "versions"];
let navDepth = 0;
let skipPop = false;

function pushNav() {
  navDepth += 1;
  history.pushState({ vinilos: navDepth }, "");
}

// «← Volver» de la app: pasa por el historial para que el navegador no se descuadre.
function navBack() {
  if (navDepth > 0) history.back();
  else goBack();
}

// Lo que hace «Volver» en la pantalla que se ve ahora.
function goBack() {
  const view = activeView();
  if (view === "artist") artistBack();
  else if (view === "detail") detailBack();
  else if (view === "results") resultsBack();
  else if (view === "wantlist") wantlistBack();
  else if (view === "explored") exploredBack();
  else if (view === "versions") versionsBack();
}

window.addEventListener("popstate", (event) => {
  const depth = (event.state && event.state.vinilos) || 0;
  if (skipPop) {
    skipPop = false;
    navDepth = depth;
    return;
  }
  const back = depth < navDepth;
  navDepth = depth;
  if (back) goBack();
});

function showView(name) {
  // Al irse a una pestaña principal se borran las marcas: «atrás» ya no tiene a qué volver dentro de la app.
  if (!SUB_VIEWS.includes(name) && navDepth > 0) {
    skipPop = true;
    history.go(-navDepth);
    navDepth = 0;
  }
  if (name !== "capture") stopScanner();
  if (name === "collection") renderCollection();
  if (name === "wantlist") renderWantlist();
  if (name === "explored") renderExplored();
  if (name === "capture") updateExploredLink();
  if (name === "settings") renderQuota();
  else setStatsActive(false);
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).classList.toggle("active", view === name);
  }
  // En la primera visita la guía va sin barra: antes de nada hay que conseguir las llaves.
  document.body.classList.toggle("no-tabbar", name === "guide" && !hasTokens());
  for (const tab of document.querySelectorAll("#tabbar button")) {
    tab.classList.toggle("active", tab.dataset.view === tabFor(name));
  }
}

// Pestaña de la barra inferior que se marca: las fichas, en la pestaña desde la que se abrieron.
function tabFor(name) {
  if (name === "detail") return detailReturnView === "artist" ? artistTab : detailReturnView === "versions" ? versionsTab : TAB_FOR_VIEW[detailReturnView];
  if (name === "artist") return artistTab;
  if (name === "versions") return versionsTab;
  return TAB_FOR_VIEW[name];
}

function activeView() {
  return VIEWS.find((view) => document.getElementById(`view-${view}`).classList.contains("active"));
}

// Vuelve a donde estaba la pantalla al irse de ella.
function restoreScroll(y) {
  requestAnimationFrame(() => window.scrollTo(0, y || 0));
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
  const geniusInput = document.getElementById("genius-token-input");
  geniusInput.value = getGeniusToken();

  document.getElementById("settings-save").addEventListener("click", () => {
    aiInput.value = setAiKey(aiInput.value);
    discogsInput.value = setDiscogsToken(discogsInput.value);
    geniusInput.value = setGeniusToken(geniusInput.value);
    status.textContent = "Guardado.";
  });

  document.getElementById("settings-clear").addEventListener("click", () => {
    clearAiKey();
    clearDiscogsToken();
    aiInput.value = "";
    discogsInput.value = "";
    geniusInput.value = setGeniusToken("");
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

  document.getElementById("quota-check").addEventListener("click", checkQuotaNow);
}

// ---------- Cupo de Gemini ----------

const clock = (iso) => {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `las ${time}` : `el ${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })} a las ${time}`;
};

function quotaState(entry) {
  if (entry.state === "quota" && entry.limit === 0) return ["⛔", "no incluido en tu plan gratuito (límite: 0)"];
  const limit = entry.limit ? ` · límite: ${entry.limit} ${entry.perDay ? "al día" : "por minuto"}` : "";
  switch (entry.state) {
    case "ok":
      return ["✅", `disponible · respondió a ${clock(entry.at)}`];
    case "quota":
      return entry.perDay
        ? ["⛔", `sin cupo diario hasta ${clock(entry.until)}${limit}`]
        : ["⏳", `sin cupo por minuto hasta ${clock(entry.until)}${limit}`];
    case "back":
      return ["🔄", `debería tener cupo otra vez (se agotó a ${clock(entry.at)})${limit}`];
    case "busy":
      return ["⚠️", `saturado o sin respuesta a ${clock(entry.at)}`];
    case "gone":
      return ["🚫", "Google ya no ofrece este modelo"];
    case "error":
      return ["❌", `error a ${clock(entry.at)}: ${entry.detail || "sin detalle"}`];
    default:
      return ["·", "sin noticias todavía"];
  }
}

let quotaModels = null;

async function renderQuota() {
  const box = document.getElementById("quota-list");
  if (!getAiKey()) {
    box.replaceChildren(el("p", "quota-note", "Pon tu llave de Google Gemini para ver su cupo."));
    return;
  }
  if (!quotaModels) {
    box.replaceChildren(el("p", "quota-note", "Buscando tus modelos…"));
    try {
      quotaModels = await geminiModels(getAiKey());
    } catch {
      quotaModels = [CONFIG.AI_PROVIDER.fallbackModel, CONFIG.AI_PROVIDER.primaryModel];
    }
  }
  const rows = quotaReport(quotaModels).map((row) => {
    const [icon, text] = quotaState(row.plain);
    const li = el("li", `quota-row quota-row--${row.plain.state}`);
    const used = row.used
      ? `Hoy, desde este móvil: ${row.used} ${row.used === 1 ? "consulta" : "consultas"}${row.search ? ` (${row.search} con búsqueda de Google)` : ""}`
      : "Hoy, desde este móvil: ninguna consulta";
    const left = row.plain.perDay && row.plain.limit && row.plain.state !== "quota" ? ` · quedan como mucho ${Math.max(0, row.plain.limit - row.used)}` : "";
    const info = el("span", "quota-text");
    info.append(el("span", "quota-model", row.model), el("span", "quota-state", `Normal: ${text}`));
    // Gemma no sabe buscar en Google.
    if (!row.model.startsWith("gemma")) {
      const [webIcon, webText] = quotaState(row.web);
      info.append(el("span", "quota-state", `${webIcon} Con búsqueda de Google: ${webText}`));
    }
    info.append(el("span", "quota-used", used + left));
    li.append(el("span", "quota-icon", icon), info);
    return li;
  });
  const reset = nextPacificMidnight().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const list = el("ul", "quota-rows");
  list.append(...rows);
  const report = quotaReport(quotaModels);
  const summary = el("div", "quota-summary");
  summary.append(
    quotaSummaryCard("Cupo normal", "Identificar fotos, buscar galletas y el dato curioso desde Wikipedia",
      report.map((r) => r.plain), report.reduce((n, r) => n + r.used - r.search, 0)),
    quotaSummaryCard("Cupo de búsqueda de Google", "El dato curioso de la ficha (con fuentes de Google)",
      report.filter((r) => !r.model.startsWith("gemma")).map((r) => r.web), report.reduce((n, r) => n + r.search, 0))
  );
  box.replaceChildren(
    summary,
    el("p", "quota-note", `Los cupos diarios se renuevan a las ${reset} (medianoche en California). Debajo, el detalle de cada modelo.`),
    list
  );
}

// Resumen de un cupo: cuántos modelos lo tienen disponible, agotado, etc.
function quotaSummaryCard(title, usedFor, entries, usedToday) {
  const count = (test) => entries.filter(test).length;
  const ok = count((e) => e.state === "ok" || e.state === "back");
  const none = count((e) => e.state === "quota" && e.limit === 0);
  const out = count((e) => e.state === "quota" && e.limit !== 0);
  const failing = count((e) => e.state === "busy" || e.state === "error");
  const unknown = count((e) => e.state === "unknown");
  let head;
  if (ok) head = ["✅", `Disponible en ${ok} ${ok === 1 ? "modelo" : "modelos"}`, "ok"];
  else if (out) head = ["⛔", none ? "Agotado o no incluido en tu plan gratuito" : "Agotado por ahora", "quota"];
  else if (none) head = ["⛔", "No incluido en tu plan gratuito", "quota"];
  else if (failing) head = ["⚠️", "Sin respuesta ahora", "busy"];
  else head = ["·", "Sin comprobar: pulsa «Comprobar ahora»", "unknown"];
  const parts = [
    ok && `${ok} con cupo`,
    out && `${out} ${out === 1 ? "agotado" : "agotados"}`,
    none && `${none} no ${none === 1 ? "incluido" : "incluidos"} en el plan gratuito`,
    failing && `${failing} con fallos`,
    unknown && `${unknown} sin comprobar`,
  ].filter(Boolean);
  const card = el("div", `quota-card quota-card--${head[2]}`);
  card.append(
    el("p", "quota-card-title", title),
    el("p", "quota-card-for", `Para: ${usedFor}`),
    el("p", "quota-card-head", `${head[0]} ${head[1]}`),
    el("p", "quota-card-detail", `${parts.join(" · ") || "sin modelos"} · hoy, desde este móvil: ${usedToday} ${usedToday === 1 ? "consulta" : "consultas"}`)
  );
  return card;
}

// Pregunta a cada modelo si responde ahora. Gasta una consulta en los que tienen cupo.
async function checkQuotaNow() {
  const button = document.getElementById("quota-check");
  if (!getAiKey()) return renderQuota();
  button.disabled = true;
  button.textContent = "Comprobando…";
  try {
    if (!quotaModels) quotaModels = await geminiModels(getAiKey());
    // Cada modelo, sin y con búsqueda de Google (son cupos distintos).
    await Promise.all(
      quotaModels.flatMap((model) => [
        probeModel(model, getAiKey()).catch(() => null),
        model.startsWith("gemma") ? null : probeModel(model, getAiKey(), { search: true }).catch(() => null),
      ])
    );
  } catch {
    // Lo que se haya podido comprobar ya está apuntado.
  }
  button.disabled = false;
  button.textContent = "🔄 Comprobar ahora";
  renderQuota();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Pills de color del vinilo y gramaje («🎨 Orange Translucent», «⚖️ 180 g»), sin repetir las que ya hay.
function addVinylPills(pills, color, weight) {
  if (color && !pills.querySelector(".card-color")) pills.append(el("span", "card-color", `🎨 ${color}`));
  if (weight && !pills.querySelector(".card-weight")) pills.append(el("span", "card-weight", `⚖️ ${weight}`));
}

// La lista de ediciones de Discogs no trae el color ni el gramaje: se mira la ficha de cada
// edición que se enseña, de una en una (la ficha queda guardada para la próxima vez).
let versionPillsRun = 0;
async function fillVersionPills(cards, isCurrent) {
  const run = ++versionPillsRun;
  for (const { candidate, card } of cards) {
    if (run !== versionPillsRun || !isCurrent()) return;
    if (candidate.pillsChecked) continue;
    try {
      const release = await cachedRelease(candidate.id, getDiscogsToken());
      candidate.pillsChecked = true;
      candidate.color = candidate.color || vinylColor(release.formats.map((f) => f.text));
      candidate.weight = candidate.weight || releaseWeight(release);
      addVinylPills(card.querySelector(".card-pills"), candidate.color, candidate.weight);
    } catch {
      return; // Discogs no responde o se pasó del límite: se queda como estaba.
    }
  }
}

// versions: tarjeta de la lista de ediciones de un álbum (sin «mejor coincidencia»; solo se mira, no se guarda).
// currentId: la edición de la ficha desde la que se abrió la lista.
function renderCard(candidate, index, owned, { versions = false, currentId = null } = {}) {
  const best = index === 0 && !versions;
  const have = owned.has(String(candidate.id));
  const card = el("article", ["card", best && "card--best", have && "card--owned"].filter(Boolean).join(" "));
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
  if (versions && String(candidate.id) === String(currentId)) body.append(el("p", "card-matches", "📍 La edición que estabas viendo"));
  if (have) body.append(el("p", "card-owned", "💿 Ya lo tienes"));
  body.append(el("p", null, [candidate.year || "Año ?", countryWithFlag(candidate.country) || "País ?"].join(" · ")));
  body.append(el("p", null, [candidate.label || "Sello ?", candidate.catno || "Nº cat. ?"].join(" · ")));
  body.append(el("p", null, candidate.formats.join(", ")));
  const pills = el("div", "card-pills");
  addVinylPills(pills, candidate.color, candidate.weight);
  body.append(pills);
  if (versions && candidate.have) body.append(el("p", null, `👥 ${candidate.have.toLocaleString("es-ES")} en colecciones de Discogs`));
  if (candidate.matches && candidate.matches.length) {
    body.append(el("p", "card-matches", candidate.matches.map((m) => `✓ ${m}`).join("  ")));
  }
  // Solo el mejor candidato lleva el botón lila: es la acción más probable.
  const label = versions ? "Ver esta edición" : exploreMode ? "🧭 Explorar este" : "✓ Es este";
  const select = el("button", best ? "card-select" : "card-select secondary", label);
  select.type = "button";
  select.addEventListener("click", () => (versions ? openDetail(candidate, { returnView: "versions" }) : openDetail(candidate)));
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

const RESULTS_FIRST = 5;
const RESULTS_STEP = 10;

// ranked: todas las ediciones ordenadas de mejor a peor. Se enseñan 5 al principio y luego de 10 en 10 con «Ver 10 más».
function renderResults(ranked, total, strategy, clues) {
  lastClues = clues;
  const how = SEARCH_STEP_LABELS[strategy] || "";
  const summary = document.getElementById("results-summary");
  const list = document.getElementById("results-list");
  const more = document.getElementById("results-more");
  // Ediciones que ya están en «Mis discos», para marcarlas con «Ya lo tienes».
  const owned = new Set(getHistory().map((item) => String(item.release_id)));
  let shown = 0;
  function showMore() {
    const next = ranked.slice(shown, shown + (shown ? RESULTS_STEP : RESULTS_FIRST));
    list.append(...next.map((candidate, i) => renderCard(candidate, shown + i, owned)));
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
  if (activeView() !== "results") pushNav();
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

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Fecha de salida de Discogs ("1987-07-00") en castellano: "julio de 1987" o "30 de julio de 1987".
// "" si solo se sabe el año.
function releaseDate(released) {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})/.exec(released || "") || [];
  const name = MONTHS[Number(month) - 1];
  if (!name) return "";
  return Number(day) ? `${Number(day)} de ${name} de ${year}` : `${name} de ${year}`;
}

// Como bothYears, pero con la fecha exacta de esta edición si se sabe:
// "1985 (ed. julio de 2009)", o solo "julio de 1987" si es la original.
function detailYears(release) {
  const date = releaseDate(release.released);
  if (!date) return bothYears(release);
  const original = String(release.originalYear || "");
  if (!original) return `Ed. ${date}`;
  return original === String(release.year || "") ? date : `${original} (ed. ${date})`;
}

// "1985 (ed. julio de 2009) · UK"; el año original aparece cuando llega del master.
function detailYearLine(release) {
  return [detailYears(release) || "Año ?", countryWithFlag(release.country) || "País ?"].join(" · ");
}

// "3:32" o "1:02:10" → segundos. null si no se entiende.
function seconds(duration) {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(duration || "")) return null;
  return duration.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

// Duración total del disco: "42 min". "" si a alguna canción le falta la duración.
function totalDuration(tracks) {
  const all = tracks.map((t) => seconds(t.duration));
  if (!all.length || all.includes(null)) return "";
  return `${Math.round(all.reduce((a, b) => a + b, 0) / 60)} min`;
}

// Nombres en castellano de los códigos de Discogs; los que no están se dejan tal cual.
const IDENTIFIER_TYPES = {
  Barcode: "Código de barras",
  "Matrix / Runout": "Matriz",
  "Label Code": "Código del sello",
  "Price Code": "Código de precio",
  "Rights Society": "Sociedad de derechos",
  "Mastering SID Code": "Código SID de masterizado",
  "Mould SID Code": "Código SID del molde",
  "Pressing Plant ID": "Código de la fábrica",
  "Depósito Legal": "Depósito legal",
  Other: "Otro",
};

function identifierList(identifiers) {
  const list = el("ul", "detail-codes");
  for (const id of identifiers) {
    const li = el("li");
    const type = IDENTIFIER_TYPES[id.type] || id.type;
    li.append(el("span", "detail-code-type", id.description ? `${type} · ${id.description}` : type), el("span", "detail-code-value", id.value));
    list.append(li);
  }
  return list;
}

function renderDetail(release) {
  const nodes = [];
  if (release.image) {
    const img = el("img", "detail-cover");
    img.src = release.image;
    img.alt = "Portada";
    nodes.push(img);
  }
  nodes.push(el("h2", null, release.artist ? `${cleanArtistName(release.artist)} – ${release.title}` : release.title));
  const artistLinks = detailArtistLinks(release);
  if (artistLinks) nodes.push(artistLinks);
  nodes.push(el("p", "detail-meta detail-year", detailYearLine(release)));
  for (const label of release.labels) {
    nodes.push(el("p", "detail-meta", `${label.name || "Sello ?"} · ${label.catno || "Nº cat. ?"}`));
  }
  for (const format of release.formats) {
    nodes.push(el("p", "detail-meta", formatLine(format)));
    if (format.text) nodes.push(el("p", "detail-meta detail-color", `Edición: ${format.text}`));
  }
  // Géneros, estilos y el botón de Spotify van en la misma fila, con el mismo tamaño.
  const genres = [...(release.genres || []), ...(release.styles || [])];
  if (genres.length || release.title) {
    const chips = el("div", "detail-genres");
    for (const name of release.genres || []) chips.append(el("span", "detail-genre", name));
    for (const name of release.styles || []) chips.append(el("span", "detail-style", name));
    if (release.title) chips.append(spotifyLink(release));
    nodes.push(chips);
  }
  // La caja del precio solo se pone con la ficha completa (tiene id); se rellena al llegar los datos.
  if (release.id) {
    const price = el("div", "detail-price");
    price.id = "detail-price";
    if (release.masterId) price.dataset.master = String(release.masterId);
    price.append(el("p", "detail-price-title", "💶 Precio de esta edición"), el("p", "detail-price-note", "Buscando precio en Discogs…"), spainLink(release.id, release.masterId));
    nodes.push(price);
  }
  // Dato curioso: solo con la ficha completa; se rellena al llegar (loadTriviaBox).
  if (release.id) {
    const trivia = el("div", "detail-trivia");
    trivia.id = "detail-trivia";
    nodes.push(trivia);
  }
  if (release.tracklist.length) {
    nodes.push(tracksBox(release));
  }
  if (release.notes) {
    nodes.push(foldable("📝 Notas de la edición", el("p", "detail-notes", release.notes)));
  }
  if (release.identifiers && release.identifiers.length) {
    nodes.push(foldable("🔢 Matriz y códigos", identifierList(release.identifiers)));
  }
  if (release.community) {
    const rating = release.community.rating;
    const title = rating ? `👥 Comunidad (${ratingNumber(rating.average)}${ratingStars(rating.average)})` : "👥 Comunidad";
    nodes.push(foldable(title, communityList(release.community)));
  }
  document.getElementById("detail-content").replaceChildren(...nodes);
}

// Botón a la ficha de cada artista del disco (con su id si ya llegó la ficha completa).
function detailArtistLinks(release) {
  const artists = (release.artists && release.artists.length ? release.artists : [{ name: release.artist }]).filter((a) =>
    hasArtistPage(a.name)
  );
  if (!artists.length) return null;
  const row = el("div", "detail-artists");
  for (const artist of artists) {
    const button = el("button", "detail-artist-link");
    button.type = "button";
    button.append(el("span", null, "🎤"), el("span", "detail-artist-name", cleanArtistName(artist.name)), el("span", null, "›"));
    button.setAttribute("aria-label", `Ver la ficha de ${cleanArtistName(artist.name)}`);
    button.addEventListener("click", () => openArtist({ name: artist.name, id: artist.id || null }));
    row.append(button);
  }
  return row;
}

// Apartado plegable de la ficha: empieza cerrado y se abre al tocar el título.
// Lista de canciones plegable, con la duración de cada una y la total si se saben.
function tracksBox(release) {
  const list = el("ul", "detail-tracks");
  for (const track of release.tracklist) {
    const li = el("li");
    li.append(el("span", "pos", track.position), el("span", "detail-track-title", track.title));
    if (track.duration) li.append(el("span", "detail-track-time", track.duration));
    list.append(li);
  }
  const total = totalDuration(release.tracklist);
  const box = foldable(`🎵 Canciones (${[release.tracklist.length, total].filter(Boolean).join(" · ")})`, list);
  box.id = "detail-tracks-box";
  return box;
}

// Si faltan duraciones, se buscan en otras ediciones o en MusicBrainz y se repinta la lista.
async function loadDurations(release, request) {
  if (!release.tracklist || release.tracklist.every((t) => t.duration) || release.durationsChecked === DURATIONS_CHECK) return;
  const before = release.tracklist.filter((t) => t.duration).length;
  try {
    await fillDurations(release, getDiscogsToken());
  } catch {
    return;
  }
  const old = document.getElementById("detail-tracks-box");
  if (request !== detailRequest || !old || release.tracklist.filter((t) => t.duration).length === before) return;
  const box = tracksBox(release);
  box.open = old.open;
  old.replaceWith(box);
}

function foldable(title, content) {
  const box = el("details", "detail-fold");
  box.append(el("summary", null, title), content);
  return box;
}

// Calidad de los datos y estado de la ficha, tal como los da Discogs, en castellano.
const DATA_QUALITY = {
  "Complete and Correct": "Completa y correcta",
  Correct: "Correcta",
  "Needs Vote": "Pendiente de votos",
  "Needs Minor Changes": "Necesita pequeños cambios",
  "Needs Major Changes": "Necesita cambios importantes",
  "Entirely Incorrect": "Incorrecta",
};
const RELEASE_STATUS = { Accepted: "Aceptada", Draft: "Borrador", Deleted: "Borrada", Rejected: "Rechazada" };

const ratingNumber = (n) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

// Una ⭐️ por punto entero; lo que sobra: 0,75 o más cuenta como otra ⭐️, desde 0,25 es 🌓.
function ratingStars(average) {
  let full = Math.floor(average);
  const rest = average - full;
  if (rest >= 0.75) full += 1;
  return "⭐️".repeat(full) + (rest >= 0.25 && rest < 0.75 ? "🌓" : "");
}

function communityList(c) {
  const number = (n) => new Intl.NumberFormat("es-ES").format(n);
  const rows = [
    ["Lo tienen", `${number(c.have)} personas`],
    ["Lo quieren", `${number(c.want)} personas`],
    [
      "Nota media",
      c.rating
        ? `${ratingNumber(c.rating.average)} / 5 (${number(c.rating.count)} votos)`
        : "Sin votos",
    ],
    ["Han editado la ficha", `${number(c.contributors)} personas`],
  ];
  if (c.dataQuality) rows.push(["Calidad de los datos", DATA_QUALITY[c.dataQuality] || c.dataQuality]);
  if (c.status) rows.push(["Estado de la ficha", RELEASE_STATUS[c.status] || c.status]);
  const list = el("dl", "detail-community");
  for (const [term, value] of rows) list.append(el("dt", null, term), el("dd", null, value));
  return list;
}

function formatMoney({ value, currency }) {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(value);
  } catch {
    return `${Number(value).toFixed(2)} ${currency || ""}`.trim();
  }
}

// Nombre de artista de Discogs listo para buscar: "Beatles, The" → "The Beatles", sin "(2)" ni "*".
function plainArtist(name) {
  return String(name || "")
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\*/g, "")
    .replace(/^(.+),\s*(The|Los|Las|El|La)$/i, "$2 $1")
    .trim();
}

const SPOTIFY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>';

// Abre la app de Spotify buscando el álbum (artista + título).
function spotifyLink(release) {
  const query = [plainArtist(release.artist), release.title].filter(Boolean).join(" ");
  const link = el("a", "detail-spotify");
  link.setAttribute("aria-label", "Escuchar en Spotify");
  link.title = "Escuchar en Spotify";
  link.innerHTML = SPOTIFY_ICON;
  link.href = `spotify:search:${encodeURIComponent(query)}`;
  return link;
}

function outLink(text, href) {
  const link = el("a", "detail-price-spain", text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

// Estados de G hacia arriba, tal como los escribe Discogs: se piden para el disco y para la portada.
const GOOD_OR_BETTER = ["Mint (M)", "Near Mint (NM or M-)", "Very Good Plus (VG+)", "Very Good (VG)", "Good Plus (G+)", "Good (G)"];

// Tienda de Discogs con lo que se vende desde España en vinilo, con disco y portada en G o mejor,
// del más barato al más caro. which: ["release", id] o ["master", id].
function spainShopUrl([key, id]) {
  const params = new URLSearchParams([
    [key, String(id)],
    ["formatName", "Vinyl"],
    ...GOOD_OR_BETTER.map((c) => ["mediaCondition", c]),
    ...GOOD_OR_BETTER.map((c) => ["sleeveCondition", c]),
    ["shipsFrom", "Spain"],
    ["sort", "price"],
    ["sortOrder", "ascending"],
  ]);
  return `https://www.discogs.com/shop/list?${params}`;
}

// Abre en Discogs las copias a la venta que se envían desde España: de esta edición y,
// si se sabe el álbum (master), de cualquiera de sus ediciones en vinilo.
// La API de Discogs no deja buscar anuncios por país ni por estado, así que no se puede poner aquí el precio.
function spainLink(id, masterId = document.getElementById("detail-price")?.dataset.master) {
  const box = el("div", "detail-price-links");
  box.append(outLink("🇪🇸 Esta edición desde España ↗", spainShopUrl(["release", id])));
  if (masterId) box.append(outLink("🇪🇸 Cualquier edición en vinilo desde España ↗", spainShopUrl(["master", masterId])));
  box.append(el("p", "detail-price-note", "Solo copias con disco y portada en G o mejor."));
  return box;
}

// «👥 1.234 la tienen · 💛 56 la buscan» (datos de la comunidad de Discogs).
function peopleNote(c, prefix = "") {
  if (!c) return null;
  const n = (x) => (x || 0).toLocaleString("es-ES");
  return el("p", "detail-price-note", `${prefix}👥 ${n(c.have)} la tienen · 💛 ${n(c.want)} la buscan`);
}

function renderPrices(id, prices, at, community) {
  const box = document.getElementById("detail-price");
  if (!box) return;
  const nodes = [el("p", "detail-price-title", "💶 Precio en Discogs")];
  const own = el("div", "detail-price-row");
  own.append(el("p", "detail-price-label", "Esta edición"));
  if (prices.blocked) {
    own.append(el("p", "detail-price-note", "Discogs no permite venderla."));
  } else if (prices.lowest) {
    const copies = prices.forSale === 1 ? "1 copia" : `${prices.forSale} copias`;
    own.append(el("p", "detail-price-main", `desde ${formatMoney(prices.lowest)}`));
    own.append(el("p", "detail-price-note", `${copies} a la venta ahora`));
  } else {
    own.append(el("p", "detail-price-note", "Ahora mismo nadie la vende."));
  }
  const people = peopleNote(community);
  if (people) own.append(people);
  own.append(outLink("🇪🇸 Desde España ↗", spainShopUrl(["release", id])));
  nodes.push(own);
  // Cualquier edición en vinilo del álbum: se rellena aparte (renderAllVinyl).
  if (box.dataset.master) {
    const all = el("div", "detail-price-row");
    all.id = "detail-price-all";
    nodes.push(all);
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
  // Lo que vale este disco en «Mis discos › Datos › Valor», y de dónde sale.
  const worth = estimate(prices);
  if (worth) nodes.push(el("p", "detail-price-sub", `💶 En «Valor» cuenta como ${formatMoney(worth)}: ${priceSource(worth)}.`));
  const when = pricesAge(at);
  // Una sola nota al pie para las dos tarjetas.
  nodes.push(el("p", "detail-price-note", [when, "🇪🇸 Solo copias con disco y portada en G o mejor."].filter(Boolean).join(" · ")));
  box.replaceChildren(...nodes);
  renderAllVinyl();
}

// Precio más bajo de cualquier edición en vinilo del álbum. state: { request, status, best, checked, total, versions, error }
let allVinyl = null;

function renderAllVinyl() {
  const row = document.getElementById("detail-price-all");
  if (!row || !allVinyl || allVinyl.request !== detailRequest) return;
  const { status, best, checked, total, versions, error, community } = allVinyl;
  const nodes = [el("p", "detail-price-label", "Cualquier edición en vinilo")];
  if (best) nodes.push(el("p", "detail-price-main", `desde ${formatMoney(best)}`));
  // Suma de todas sus ediciones en vinilo (si tiene más de las leídas, se dice).
  if (community) {
    const partial = versions > community.counted ? ` (en sus ${community.counted} primeras ediciones)` : "";
    const people = peopleNote(community);
    people.textContent += partial;
    nodes.push(people);
  }
  if (status === "loading") {
    nodes.push(el("p", "detail-price-note", total ? `⏳ Mirando precios: ${checked} de ${total} ediciones…` : "⏳ Buscando las ediciones del álbum…"));
  } else if (status === "error") {
    nodes.push(el("p", "detail-price-note", `No se pudo consultar: ${error}`));
  } else if (!best) {
    nodes.push(el("p", "detail-price-note", `Nadie vende ahora ninguna de sus ${total} ediciones más comunes.`));
  }
  if (best) {
    const where = [best.country, best.year, best.label].filter(Boolean).join(" · ");
    const link = outLink(`${where || "Ver edición"} ↗`, `https://www.discogs.com/sell/release/${best.id}?sort=price%2Casc`);
    link.className = "detail-price-best";
    nodes.push(link);
    if (status === "done") {
      const of = versions > total ? ` (tiene ${new Intl.NumberFormat("es-ES").format(versions)} en total)` : "";
      nodes.push(el("p", "detail-price-note", `La más barata entre sus ${total} ediciones en vinilo más comunes${of}.`));
    }
  }
  const masterId = document.getElementById("detail-price")?.dataset.master;
  if (masterId) nodes.push(outLink("🇪🇸 Desde España ↗", spainShopUrl(["master", masterId])));
  row.replaceChildren(...nodes);
}

async function loadCheapest(release, prices, request) {
  allVinyl = { request, status: "loading", best: null, checked: 0, total: 0, versions: 0 };
  renderAllVinyl();
  const known = prices && !prices.blocked ? { [release.id]: { lowest: prices.lowest } } : {};
  try {
    const result = await cachedCheapest(release.masterId, getDiscogsToken(), {
      known,
      stop: () => request !== detailRequest,
      onProgress: (p) => {
        if (request !== detailRequest) return;
        allVinyl = { request, status: "loading", ...p };
        renderAllVinyl();
      },
    });
    if (!result || request !== detailRequest) return;
    allVinyl = { request, status: "done", ...result };
  } catch (err) {
    if (request !== detailRequest) return;
    allVinyl = { ...allVinyl, status: "error", error: err.message };
  }
  renderAllVinyl();
}

// Los precios se piden a Discogs como mucho una vez por semana: se dice de cuándo son.
function pricesAge(at) {
  if (!at) return "";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return "Precio consultado hoy";
  if (days === 1) return "Precio consultado ayer";
  return `Precio consultado hace ${days} días`;
}

async function loadPrices(release, request) {
  const id = release.id;
  let prices = null;
  try {
    const result = await cachedPrices(id, getDiscogsToken());
    prices = result.prices;
    if (request === detailRequest) renderPrices(id, result.prices, result.at, release.community);
  } catch (err) {
    const box = document.getElementById("detail-price");
    if (request === detailRequest && box) {
      box.replaceChildren(el("p", "detail-price-title", "💶 Precio de esta edición"),
        el("p", "detail-price-note", `No se pudo consultar el precio: ${err.message}`), spainLink(id));
    }
  }
  if (release.masterId && request === detailRequest) loadCheapest(release, prices, request);
}

// «¿Sabías que…?»: un dato curioso nuevo cada vez que se abre la ficha, con enlaces a sus fuentes.
async function loadTriviaBox(release, request) {
  const box = document.getElementById("detail-trivia");
  if (!box) return;
  const title = el("p", "detail-trivia-title", "💡 ¿Sabías que…?");
  if (!getAiKey()) {
    box.hidden = true;
    return;
  }
  const step = el("p", "detail-trivia-note", "Buscando en internet un dato curioso con fuentes…");
  box.replaceChildren(title, step);
  const result = await loadTrivia(
    release,
    getAiKey(),
    (text) => {
      if (request === detailRequest) step.textContent = text;
    },
    { discogsToken: getDiscogsToken(), geniusToken: getGeniusToken() }
  );
  if (request !== detailRequest) return;
  const again = el("button", "detail-trivia-again", "🔄 Otro dato");
  again.type = "button";
  again.addEventListener("click", () => loadTriviaBox(release, request));
  if (!result.ok) {
    box.replaceChildren(title, el("p", "detail-trivia-note", result.message), again);
    return;
  }
  const sources = el("p", "detail-trivia-sources", "Fuentes: ");
  result.sources.forEach((source, i) => {
    const link = el("a", null, source.title);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener";
    if (i) sources.append(" · ");
    sources.append(link);
  });
  const nodes = [title, el("p", "detail-trivia-text", result.text), sources];
  // Google pide enseñar sus sugerencias de búsqueda junto a lo encontrado con su buscador.
  if (result.searchHtml) {
    const frame = el("iframe", "detail-trivia-search");
    frame.title = "Búsquedas de Google relacionadas";
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = `<base target="_blank"><style>body{margin:0;background:transparent}</style>${result.searchHtml}`;
    nodes.push(frame);
  }
  if (result.note) nodes.push(el("p", "detail-trivia-why", result.note));
  nodes.push(again);
  box.replaceChildren(...nodes);
}

let detailRequest = 0;
let detailReturnView = "results";

let detailScroll = 0;
// Último disco abierto, para volver a él desde la ficha de un artista.
let lastDetail = null;

const BACK_LABELS = {
  results: "← Volver a los candidatos",
  collection: "← Volver a mis discos",
  artist: "← Volver al artista",
  wantlist: "← Volver a lo que busco",
  explored: "← Volver a explorados",
  versions: "← Volver a las ediciones",
};

// returnView: pantalla a la que lleva "Volver". Desde «Mis discos» el disco ya está
// guardado, así que no se vuelve a guardar; desde un artista, tampoco (si no lo tienes, no se guarda).
// reopen: se vuelve a una ficha ya vista; no se guarda otra vez ni se mueve el scroll.
async function openDetail(candidate, { returnView = "results", reopen = false } = {}) {
  const fromHistory = returnView !== "results" || reopen;
  if (!reopen && activeView() !== "detail") {
    detailScroll = window.scrollY;
    pushNav();
  }
  lastDetail = { candidate, returnView };
  detailReturnView = returnView;
  document.getElementById("detail-back").textContent = BACK_LABELS[returnView];
  const savedNote = document.getElementById("detail-saved");
  savedNote.textContent = "";
  document.getElementById("detail-delete").hidden = true;
  document.getElementById("detail-want").hidden = true;
  document.getElementById("detail-versions").hidden = true;

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
  if (!reopen) window.scrollTo(0, 0);

  const request = ++detailRequest;
  let release = null;
  // Año del álbum original (del master): llega después de la ficha. undefined = no se pudo mirar.
  let originalYear;
  try {
    // Si la ficha está guardada en la nube, sale de ahí sin preguntar a Discogs.
    release = await cachedRelease(candidate.id, getDiscogsToken());
    if (request === detailRequest) {
      // En un disco guardado se enseña la portada que haya elegido el usuario.
      const saved = fromHistory && getHistory().find((i) => String(i.release_id) === String(release.id));
      renderDetail(saved && saved.cover ? { ...release, image: saved.cover } : release);
      loadPrices(release, request).then(() => loadDurations(release, request));
      loadTriviaBox(release, request);
      if (fromHistory) {
        addCoverPicker(release);
        searchLabelAgain(release, request);
      }
    }
    if (release.originalYear !== undefined) {
      originalYear = release.originalYear;
    } else {
      try {
        originalYear = await getMasterYear(release.masterId, getDiscogsToken());
        release.originalYear = originalYear;
        rememberRelease(release);
        const line = document.querySelector("#detail-content .detail-year");
        if (request === detailRequest && line) line.textContent = detailYearLine(release);
      } catch {
        // Sin año original no pasa nada: se rellena más tarde desde «Mis discos».
      }
    }
  } catch (err) {
    if (request === detailRequest) {
      const note = el("p", "status");
      showError(note, `No se pudo cargar la ficha completa: ${err.message}`, err.authError);
      document.getElementById("detail-content").append(note);
    }
  }

  const alreadyOwned = getHistory().some((item) => String(item.release_id) === String(candidate.id));
  if (returnView === "versions") {
    if (request === detailRequest) savedNote.textContent = alreadyOwned ? "💿 Esta edición ya está en tu colección" : "Otra edición del álbum · no está en tu colección";
  } else if (returnView === "explored") {
    if (request === detailRequest) savedNote.textContent = alreadyOwned ? "🧭 Explorado · 💿 Ya lo tienes en tu colección" : "🧭 Explorado · no está en tu colección";
  } else if ((returnView === "artist" || returnView === "wantlist") && !alreadyOwned) {
    if (request === detailRequest) savedNote.textContent = "Edición principal del álbum · no está en tu colección";
  } else if (fromHistory) {
    // Ya guardado: no se toca.
  } else if (exploreMode) {
    addExplored({
      release_id: candidate.id,
      artist: release ? release.artist : candidate.artist || "",
      title: release ? release.title : candidate.title,
      year: String((release ? release.year : candidate.year) || ""),
      thumb: (release && release.thumb) || candidate.thumb || "",
    });
    savedNote.textContent = alreadyOwned
      ? "🧭 Modo explorador · 💿 Ya lo tienes en tu colección"
      : "🧭 Modo explorador: no se ha guardado en tu colección";
  } else {
    // Si la ficha no llegó, se guarda con los datos del candidato para no perder la confirmación.
    try {
      addToHistory({
        release_id: candidate.id,
        artist: release ? release.artist : candidate.artist || "",
        title: release ? release.title : candidate.title,
        year: String((release ? release.year : candidate.year) || ""),
        originalYear,
        thumb: (release && release.thumb) || candidate.thumb || "",
        cover: (release && release.image) || "",
        // Color del vinilo ("" si es negro); sin ficha se usa el del candidato si lo traía.
        color: release ? vinylColor(release.formats.map((f) => f.text)) : candidate.color || undefined,
        colorRev: release ? COLOR_REV : undefined,
        // Gramaje ("180 g"; "" si Discogs no lo dice).
        weight: release ? releaseWeight(release) : candidate.weight || undefined,
        // Cuántos vinilos trae (2 = doble LP); sin ficha se sabrá más tarde.
        discs: release ? releaseDiscs(release) : undefined,
      });
      if (request === detailRequest) savedNote.textContent = alreadyOwned ? "💿 Ya estaba en tu colección" : "✓ Guardado en tu historial";
      // Si estaba en «Lo que busco», ya no hace falta buscarlo.
      removeWantedRelease({ artist: release ? release.artist : candidate.artist, title: release ? release.title : candidate.title, id: candidate.id, masterId: release && release.masterId });
    } catch {
      if (request === detailRequest) savedNote.textContent = "❌ No se pudo guardar en el historial (¿memoria del navegador llena?).";
    }
  }

  // «Borrar de mis discos» solo aparece si el disco está en tu colección.
  if (request === detailRequest) {
    const owned = getHistory().some((item) => String(item.release_id) === String(candidate.id));
    document.getElementById("detail-delete").hidden = !owned;
    if (!owned) showWantButton(release || candidate);
    if (release && release.masterId) {
      const button = document.getElementById("detail-versions");
      button.onclick = () => openVersions(release);
      button.hidden = false;
    }
  }
}

// ---------- Ediciones de un álbum (desde la ficha) ----------
// Pila: cada vez que se abre la lista desde una ficha se apunta esa ficha, para volver a ella.

const versionsStack = [];
let versionsTab = "capture";
let versionsRequest = 0;

async function openVersions(release) {
  // Desde una ficha que no viene de otra lista de ediciones se empieza una pila nueva.
  if (detailReturnView !== "versions") {
    versionsStack.length = 0;
    versionsTab = tabFor("detail") || "capture";
  }
  const entry = { detail: lastDetail, scroll: window.scrollY, release, data: null };
  versionsStack.push(entry);
  pushNav();
  drawVersions(entry);
  showView("versions");
  window.scrollTo(0, 0);
  const request = ++versionsRequest;
  try {
    entry.data = await vinylVersions(release.masterId, getDiscogsToken());
  } catch (err) {
    entry.error = err;
  }
  if (request === versionsRequest && versionsStack[versionsStack.length - 1] === entry) drawVersions(entry);
}

function drawVersions(entry) {
  const summary = document.getElementById("versions-summary");
  const list = document.getElementById("versions-list");
  const more = document.getElementById("versions-more");
  const { release, data } = entry;
  const name = [cleanArtistName(release.artist), release.title].filter(Boolean).join(" — ");
  list.replaceChildren();
  more.hidden = true;
  if (entry.error) {
    showError(summary, `No se pudieron cargar las ediciones: ${entry.error.message}`, entry.error.authError);
    return;
  }
  if (!data) {
    summary.textContent = `${name} · buscando ediciones en Discogs…`;
    return;
  }
  const items = data.candidates.map((c) => ({ ...c, artist: c.artist || release.artist }));
  if (!items.length) {
    summary.textContent = `${name} · Discogs no tiene más ediciones en vinilo.`;
    return;
  }
  const owned = new Set(getHistory().map((item) => String(item.release_id)));
  let shown = 0;
  let allCards = [];
  const showMore = () => {
    const next = items.slice(shown, shown + (shown ? RESULTS_STEP : 20));
    const cards = next.map((c, i) => ({ candidate: c, card: renderCard(c, shown + i, owned, { versions: true, currentId: release.id }) }));
    list.append(...cards.map((c) => c.card));
    shown += next.length;
    // Sigue mientras se vea esta lista; «Ver más» continúa con todas las que aún falten.
    allCards = allCards.concat(cards);
    fillVersionPills(allCards, () => activeView() === "versions" && versionsStack[versionsStack.length - 1] === entry && list.isConnected);
    const left = items.length - shown;
    more.hidden = left <= 0;
    more.textContent = left > RESULTS_STEP ? `Ver ${RESULTS_STEP} más (quedan ${left})` : left === 1 ? "Ver la que queda" : `Ver las ${left} que quedan`;
  };
  more.onclick = showMore;
  const extra = data.total > items.length ? ` (se enseñan las ${items.length} primeras)` : "";
  summary.textContent = `${name} · ${data.total} ${data.total === 1 ? "edición" : "ediciones"} en vinilo${extra}, de la más común a la menos.`;
  showMore();
}

function versionsBack() {
  const entry = versionsStack.pop();
  if (!entry) return showView("capture");
  // La lista de debajo (si la hay) se deja dibujada por si se vuelve a ella.
  const below = versionsStack[versionsStack.length - 1];
  if (below) drawVersions(below);
  if (entry.detail) openDetail(entry.detail.candidate, { returnView: entry.detail.returnView, reopen: true });
  else showView("capture");
  restoreScroll(entry.scroll);
}

// «☆ Lo busco» en la ficha de un disco que no tienes.
function showWantButton(release) {
  const button = document.getElementById("detail-want");
  const entry = {
    artist: cleanArtistName(release.artist),
    title: release.title,
    year: release.originalYear || release.year,
    thumb: release.thumb || release.image || "",
    id: release.id,
    masterId: release.masterId,
  };
  if (!entry.artist || !entry.title) return;
  const paint = () => {
    button.textContent = isWanted(entry.artist, entry.title) ? "★ En lo que busco · quitar" : "☆ Añadir a lo que busco";
  };
  button.onclick = () => {
    toggleWanted(entry);
    paint();
  };
  paint();
  button.hidden = false;
}

// ---------- Lo que busco (wantlist) ----------

let wantlistScroll = 0;

function openWantlist() {
  wantlistScroll = window.scrollY;
  pushNav();
  showView("wantlist");
  window.scrollTo(0, 0);
}

function wantlistBack() {
  showView("collection");
  restoreScroll(wantlistScroll);
}

function renderWantlist() {
  const items = getWantlist();
  const box = document.getElementById("wantlist-content");
  const nodes = [el("h2", null, "⭐ Lo que busco")];
  if (!items.length) {
    nodes.push(el("p", "wantlist-empty", "Aún no buscas ningún disco. En la discografía de un artista, toca ☆ junto a un álbum que no tengas para apuntarlo aquí."));
    box.replaceChildren(...nodes);
    return;
  }
  nodes.push(el("p", "wantlist-sub", `${items.length} ${items.length === 1 ? "disco" : "discos"} · al guardarlo en tus discos sale solo de aquí`));
  const list = el("div", "artist-albums");
  for (const item of items) {
    const line = el("div", "artist-album-line");
    const row = el("button", "artist-album");
    row.type = "button";
    const img = el(item.thumb ? "img" : "span", "artist-album-cover");
    if (item.thumb) {
      img.src = item.thumb;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(el("span", "artist-album-cover", "💿")), { once: true });
    } else {
      img.textContent = "💿";
    }
    const text = el("span", "artist-album-text");
    text.append(el("span", "artist-album-title", item.title), el("span", "artist-album-year", [cleanArtistName(item.artist), item.year].filter(Boolean).join(" · ")));
    row.append(img, text, el("span", "artist-row-go", "›"));
    row.addEventListener("click", () => openAlbum({ ...item }, item.artist, "wantlist"));
    const remove = el("button", "want-star is-on", "★");
    remove.type = "button";
    remove.setAttribute("aria-label", `Quitar «${item.title}» de lo que busco`);
    remove.addEventListener("click", () => {
      removeWanted(item.artist, item.title);
      renderWantlist();
    });
    line.append(row, remove);
    list.append(line);
  }
  nodes.push(list);
  box.replaceChildren(...nodes);
}

function updateWantlistLink() {
  const count = getWantlist().length;
  document.getElementById("wantlist-open").textContent = count ? `⭐ Lo que busco (${count})` : "⭐ Lo que busco";
}

// ---------- Discos explorados (modo explorador) ----------

let exploredScroll = 0;

function openExplored() {
  exploredScroll = window.scrollY;
  pushNav();
  showView("explored");
  window.scrollTo(0, 0);
}

function exploredBack() {
  showView("capture");
  restoreScroll(exploredScroll);
}

function exploredDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function renderExplored() {
  const items = getExplored();
  const box = document.getElementById("explored-content");
  const nodes = [el("h2", null, "🧭 Discos explorados")];
  document.getElementById("explored-clear").hidden = !items.length;
  if (!items.length) {
    nodes.push(el("p", "wantlist-empty", "Aún no has explorado ningún disco. Con el modo explorador activado, lo que identifiques se apunta aquí sin guardarse en tu colección."));
    box.replaceChildren(...nodes);
    return;
  }
  nodes.push(el("p", "wantlist-sub", `${items.length} ${items.length === 1 ? "disco" : "discos"} · solo en este móvil`));
  const owned = new Set(getHistory().map((item) => String(item.release_id)));
  const list = el("div", "artist-albums");
  for (const item of items) {
    const line = el("div", "artist-album-line");
    const row = el("button", "artist-album");
    row.type = "button";
    const img = el(item.thumb ? "img" : "span", "artist-album-cover");
    if (item.thumb) {
      img.src = item.thumb;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(el("span", "artist-album-cover", "💿")), { once: true });
    } else {
      img.textContent = "💿";
    }
    const text = el("span", "artist-album-text");
    const meta = [cleanArtistName(item.artist), item.year, exploredDate(item.date)].filter(Boolean).join(" · ");
    const title = owned.has(String(item.release_id)) ? `💿 ${item.title}` : item.title;
    text.append(el("span", "artist-album-title", title), el("span", "artist-album-year", meta));
    row.append(img, text, el("span", "artist-row-go", "›"));
    row.addEventListener("click", () => openDetail(historyItemToCandidate(item), { returnView: "explored" }));
    const remove = el("button", "want-star", "✕");
    remove.type = "button";
    remove.setAttribute("aria-label", `Quitar «${item.title}» de explorados`);
    remove.addEventListener("click", () => {
      removeExplored(item.release_id);
      renderExplored();
    });
    line.append(row, remove);
    list.append(line);
  }
  nodes.push(list);
  box.replaceChildren(...nodes);
}

// El acceso se ve con el modo explorador activado o si ya hay algo explorado.
function updateExploredLink() {
  const count = getExplored().length;
  const link = document.getElementById("explored-open");
  link.textContent = count ? `🧭 Discos explorados (${count})` : "🧭 Discos explorados";
  link.hidden = !exploreMode && !count;
}

// Borra de «Mis discos» el disco de la ficha abierta, tras dos confirmaciones, y vuelve atrás.
function deleteDetailDisc() {
  if (!lastDetail) return;
  const { candidate } = lastDetail;
  const item = getHistory().find((i) => String(i.release_id) === String(candidate.id));
  if (!item) return;
  if (!window.confirm(`¿Borrar «${item.title}» de tus discos?`)) return;
  const where = cloudSignedIn ? " También se borrará de la nube." : "";
  if (!window.confirm(`¿Seguro? «${item.title}» desaparecerá de tu colección.${where} No se puede deshacer.`)) return;
  removeFromHistory(item.release_id);
  renderCollection();
  navBack();
}

// Todas las fotos de la edición en Discogs, empezando por la portada principal.
function releasePhotos(release) {
  const photos = [];
  if (release.image) photos.push({ uri: release.image, uri150: release.thumb || release.image });
  for (const p of release.extraImages || []) photos.push(p);
  return photos.filter((p, i, all) => all.findIndex((q) => q.uri === p.uri) === i);
}

// «Cambiar portada»: si la foto principal de Discogs es mala, se elige otra de la edición
// o, con el botón de abajo, de la edición más popular del álbum.
function addCoverPicker(release) {
  const item = getHistory().find((i) => String(i.release_id) === String(release.id));
  const photos = releasePhotos(release);
  if (!item || (photos.length < 2 && !release.masterId)) return;
  const grid = el("div", "cover-picker");
  const mark = () => {
    const current = item.cover || release.image;
    for (const b of grid.children) b.classList.toggle("is-current", b.dataset.uri === current);
  };
  const addOption = (photo) => {
    if ([...grid.children].some((b) => b.dataset.uri === photo.uri)) return false;
    const b = el("button", "cover-picker-option");
    b.type = "button";
    b.dataset.uri = photo.uri;
    b.setAttribute("aria-label", "Usar esta foto como portada");
    const img = el("img");
    img.src = photo.uri150;
    img.alt = "";
    img.loading = "lazy";
    b.append(img);
    b.addEventListener("click", () => {
      const patch = { cover: photo.uri, thumb: photo.uri150 };
      Object.assign(item, patch);
      updateHistoryItem(item.release_id, patch);
      updateSlide(item);
      const cover = document.querySelector("#detail-content .detail-cover");
      if (cover) cover.src = photo.uri;
      mark();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    grid.append(b);
    return true;
  };
  photos.forEach(addOption);
  mark();
  const box = foldable(`🖼️ Cambiar portada (${photos.length} fotos)`, grid);
  box.append(el("p", "detail-meta", "Toca una foto para usarla como portada en «Mis discos»."));

  // Si no gusta ninguna: fotos de otras ediciones en vinilo, de la más popular a la menos.
  // Cada toque trae la siguiente.
  if (release.masterId) {
    const more = el("button", "secondary cover-picker-more", "📀 Ver fotos de la edición más popular");
    more.type = "button";
    const status = el("p", "detail-meta");
    let queue = null; // ids de ediciones que faltan por enseñar
    let shown = 0;
    more.addEventListener("click", async () => {
      more.disabled = true;
      status.textContent = "⏳ Buscando otra edición…";
      try {
        if (!queue) {
          queue = (await popularVinylVersions(release.masterId, getDiscogsToken())).filter((id) => String(id) !== String(release.id));
        }
        let added = 0;
        let popular = null;
        // Se salta las ediciones que no aportan fotos nuevas.
        while (queue.length && !added) {
          popular = await cachedRelease(queue.shift(), getDiscogsToken());
          added = releasePhotos(popular).filter(addOption).length;
        }
        if (!added) {
          status.textContent = shown ? "No hay más ediciones con fotos distintas." : "No hay otras ediciones con fotos distintas.";
          more.hidden = true;
          return;
        }
        shown += 1;
        mark();
        box.querySelector("summary").textContent = `🖼️ Cambiar portada (${grid.children.length} fotos)`;
        const where = [popular.country, popular.year, popular.labels?.[0]?.name].filter(Boolean).join(" · ");
        const which = shown === 1 ? "la edición más popular" : `la ${shown}.ª edición más popular`;
        status.textContent = `✓ ${added} foto${added > 1 ? "s" : ""} más de ${which}${where ? ` (${where})` : ""}.`;
        more.textContent = "📀 No me gustan: ver la siguiente edición";
        more.hidden = !queue.length;
        more.disabled = false;
      } catch (err) {
        status.textContent = `No se pudieron cargar: ${err.message}`;
        more.disabled = false;
      }
    });
    box.append(more, status);
  }
  // Al final de la ficha: se usa poco y no debe separar el precio del resto.
  document.getElementById("detail-content").append(box);
}

// Si el disco guardado aún no tiene galleta, se vuelve a buscar al abrir su ficha.
async function searchLabelAgain(release, request) {
  const item = getHistory().find((i) => i.release_id === release.id);
  if (!item || (item.label && item.label.src)) return;
  const note = el("p", "detail-meta detail-label-note", "🔍 Buscando la galleta en las fotos de Discogs…");
  const content = document.getElementById("detail-content");
  content.insertBefore(note, document.getElementById("detail-price"));
  const text = await retryLabel(item, release, getAiKey(), getDiscogsToken());
  if (item.label && item.label.src) updateSlide(item);
  if (request !== detailRequest) return;
  if (text) note.textContent = text;
  else note.remove();
}

// ---------- Ficha del artista ----------

// Pila de pantallas de artistas: la lista de tus artistas y las fichas que se van abriendo.
// back: a dónde lleva «Volver» ("prev" = la anterior de la pila); scroll: dónde estaba esa pantalla.
const artistStack = [];
let artistTab = "collection";

const sameArtist = (state, target) =>
  state.kind === "artist" &&
  ((state.id && target.id && String(state.id) === String(target.id)) ||
    cleanArtistName(state.name).toLowerCase() === cleanArtistName(target.name).toLowerCase());

function albumCandidate(album, artistName) {
  return {
    id: album.id,
    artist: artistName,
    title: album.title,
    year: album.year,
    country: "",
    label: "",
    catno: "",
    formats: [],
    thumb: album.thumb,
    url: `https://www.discogs.com/release/${album.id}`,
  };
}

// Un álbum de la discografía: si solo se sabe su master, se busca antes su edición principal.
async function openAlbum(album, name, returnView = "artist") {
  // Con master se busca siempre su edición principal en vinilo (la que da Discogs puede ser un CD o digital).
  if (!album.resolved && (album.masterId || (!album.id && album.mbid))) {
    const fallback = album.id;
    try {
      // Los de MusicBrainz no tienen id de Discogs: se busca por artista y título.
      album.id = album.masterId
        ? await masterMainRelease(album.masterId, getDiscogsToken())
        : await findAlbumRelease(name, album.title, getDiscogsToken());
      album.id = album.id || fallback;
      album.resolved = Boolean(album.id);
      if (!album.id) {
        window.alert(`No encuentro «${album.title}» en Discogs.`);
        return;
      }
    } catch (err) {
      album.id = fallback;
      if (!album.id) {
        window.alert(`No se pudo abrir el álbum: ${err.message}`);
        return;
      }
    }
  }
  if (album.id) openDetail(albumCandidate(album, name), { returnView });
}

function drawArtistTop() {
  const top = artistStack[artistStack.length - 1];
  if (!top) return;
  const box = document.getElementById("artist-content");
  if (top.state.kind === "index") {
    renderArtistIndex(box, getHistory(), { onArtist: openArtist });
  } else {
    renderArtistPage(box, top.state, {
      items: getHistory(),
      token: getDiscogsToken(),
      onOpenItem: (item) => openDetail(historyItemToCandidate(item), { returnView: "artist" }),
      onOpenAlbum: openAlbum,
      onArtist: openArtist,
    });
  }
  const back = top.back;
  const prev = artistStack[artistStack.length - 2];
  let label = "← Volver";
  if (back === "prev" && prev) label = prev.state.kind === "index" ? "← Volver a tus artistas" : `← Volver a ${cleanArtistName(prev.state.name)}`;
  else if (back === "collection") label = "← Volver a mis discos";
  else if (back === "detail") label = "← Volver al disco";
  document.getElementById("artist-back").textContent = label;
}

function pushArtist(state) {
  const from = activeView();
  // Desde fuera de las fichas (p. ej. «Datos»), se empieza una pila nueva.
  const chained = from === "artist" || (from === "detail" && detailReturnView === "artist");
  if (!chained) {
    artistStack.length = 0;
    artistTab = tabFor(from) || "collection";
  }
  artistStack.push({ state, back: from === "artist" ? "prev" : from, scroll: window.scrollY, detail: from === "detail" ? lastDetail : null });
  pushNav();
  drawArtistTop();
  showView("artist");
  window.scrollTo(0, 0);
}

// target: { name, id? }
function openArtist(target) {
  if (!hasArtistPage(target.name)) return;
  const top = artistStack[artistStack.length - 1];
  // Desde un disco abierto desde esta misma ficha: se vuelve a ella.
  if (activeView() === "detail" && detailReturnView === "artist" && top && sameArtist(top.state, target)) {
    navBack();
    return;
  }
  pushArtist({ kind: "artist", name: target.name, id: target.id || null });
}

function openArtistIndex() {
  pushArtist({ kind: "index" });
}

function artistBack() {
  const entry = artistStack.pop();
  if (!entry) return showView("collection");
  if (entry.back === "prev" && artistStack.length) {
    drawArtistTop();
    restoreScroll(entry.scroll);
    return;
  }
  // La pantalla de artista de debajo se deja lista por si se vuelve a ella.
  drawArtistTop();
  if (entry.back === "detail" && entry.detail) {
    if (entry.detail !== lastDetail) openDetail(entry.detail.candidate, { returnView: entry.detail.returnView, reopen: true });
    else showView("detail");
  } else {
    showView(entry.back);
  }
  restoreScroll(entry.scroll);
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
    thumb: item.cover || item.thumb,
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
  if (item.artist) open.append(el("span", "history-meta", cleanArtistName(item.artist)));
  const years = bothYears(item);
  if (years) open.append(el("span", "history-meta", years));
  open.addEventListener("click", () => openDetail(historyItemToCandidate(item), { returnView: "collection" }));

  wrapper.append(open);
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
  if (collectionSort === "year" || collectionSort === "edition") {
    // Del más antiguo al más nuevo: por el año del álbum original o por el de tu edición.
    // Los que no tienen año, al final. A igual año, por artista.
    const year =
      collectionSort === "year"
        ? (item) => Number.parseInt(item.originalYear || item.year, 10) || Infinity
        : (item) => Number.parseInt(item.year, 10) || Infinity;
    list.sort((a, b) => year(a) - year(b) || byText("artist")(a, b));
  } else if (collectionSort === "artist") {
    // A igual artista, sus discos por año.
    const year = (item) => Number.parseInt(item.originalYear || item.year, 10) || Infinity;
    list.sort((a, b) => byText("artist")(a, b) || year(a) - year(b));
  } else if (collectionSort === "title") {
    list.sort(byText("title"));
  }
  return list;
}

function renderCollection() {
  const items = sortItems(getHistory());
  const empty = items.length === 0;
  updateWantlistLink();
  const grid = collectionMode === "grid";
  const stats = collectionMode === "stats";
  document.getElementById("collection-empty").hidden = !empty;
  document.getElementById("collection-switch").hidden = empty;
  document.getElementById("collection-sort").hidden = empty || stats;
  for (const button of document.querySelectorAll("#collection-sort button")) {
    const active = button.dataset.sort === collectionSort;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.getElementById("gallery-content").hidden = empty || grid || stats;
  document.getElementById("stats-wrap").hidden = empty || !stats;
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
    document.getElementById("stats-content").replaceChildren();
    setStatsActive(false);
    return;
  }
  if (stats) {
    renderStats(document.getElementById("stats-content"), items, {
      discogsToken: getDiscogsToken(),
      statusEl: document.getElementById("stats-status"),
      onOpen: (item) => openDetail(historyItemToCandidate(item), { returnView: "collection" }),
      onArtists: openArtistIndex,
      onArtist: (name) => openArtist({ name }),
    });
    return;
  }
  setStatsActive(false);
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

  resultsBack = () => {
    resetCapture();
    showView("capture");
  };
  document.getElementById("results-back").addEventListener("click", navBack);

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

let resultsBack = () => showView("capture");

function detailBack() {
  showView(detailReturnView);
  restoreScroll(detailScroll);
}

function initDetail() {
  document.getElementById("detail-back").addEventListener("click", navBack);
  document.getElementById("detail-delete").addEventListener("click", deleteDetailDisc);
  document.getElementById("artist-back").addEventListener("click", navBack);
  document.getElementById("wantlist-back").addEventListener("click", navBack);
  document.getElementById("wantlist-open").addEventListener("click", openWantlist);
  document.getElementById("explored-back").addEventListener("click", navBack);
  document.getElementById("versions-back").addEventListener("click", navBack);
  document.getElementById("explored-open").addEventListener("click", openExplored);
  document.getElementById("explored-clear").addEventListener("click", () => {
    if (!window.confirm("¿Borrar todo el historial de discos explorados? Tu colección no se toca.")) return;
    clearExplored();
    renderExplored();
  });
}

// Modo explorador: tema oscuro y lo que se identifica no se guarda en «Mis discos».
// El tema ya lo pone un script en index.html antes de pintar; aquí se sincroniza el interruptor.
const EXPLORE_KEY = CONFIG.STORAGE_KEYS.exploreMode;
let exploreMode = false;

function setExploreMode(on) {
  exploreMode = on;
  if (on) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  // Color de la franja de la hora en Safari: el mismo que el fondo de la cabecera.
  document.querySelector('meta[name="theme-color"]').content = on ? "#17141f" : "#fbf6f1";
  document.getElementById("explore-toggle").checked = on;
  document.getElementById("identify-title").textContent = on ? "¿Qué disco exploras?" : "¿Qué disco tienes?";
  updateExploredLink();
  try {
    if (on) localStorage.setItem(EXPLORE_KEY, "1");
    else localStorage.removeItem(EXPLORE_KEY);
  } catch {
    // Sin memoria del navegador el modo dura hasta cerrar la app.
  }
}

function initExploreMode() {
  let saved = false;
  try {
    saved = localStorage.getItem(EXPLORE_KEY) === "1";
  } catch {}
  setExploreMode(saved);
  document.getElementById("explore-toggle").addEventListener("change", (event) => setExploreMode(event.target.checked));
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
    const result = await identify(preparedImage, getAiKey(), (model, previousFailure, retry) => {
      currentModel = model;
      fallbackNote = retry
        ? `Gemini está saturado. Reintento ${retry} de 2. `
        : previousFailure
          ? `El modelo anterior no respondió (${previousFailure}). Pruebo con otro de respaldo. `
          : "";
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
  // Al volver a esta pantalla, tocar la foto la busca de nuevo (salvo si ya se está buscando).
  const searchAgain = () => {
    if (!previewWrap.classList.contains("busy")) runIdentify(++identifyRun);
  };
  previewWrap.addEventListener("click", searchAgain);
  previewWrap.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      searchAgain();
    }
  });

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

// Recarga sola cuando hay versión nueva, pero solo si no hay nada a medias.
function isSafeToReload() {
  const active = document.querySelector(".view.active")?.id;
  if (document.activeElement?.matches?.("input, textarea")) return false;
  if (active === "view-collection" || active === "view-settings") return true;
  return active === "view-capture"
    && document.getElementById("capture-preview-wrap").hidden
    && document.getElementById("scanner").hidden;
}

function initUpdates() {
  initAutoUpdate(isSafeToReload);
  const button = document.getElementById("settings-update");
  const status = document.getElementById("settings-update-status");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Buscando la última versión…";
    let latest = currentVersion();
    try {
      latest = await latestVersion();
      status.textContent = latest === currentVersion()
        ? `✅ Ya tienes la última (v${latest}). Refrescando…`
        : `⬆️ Actualizando a v${latest}…`;
    } catch {
      status.textContent = "No pude comprobarlo, pero refresco igualmente…";
    }
    setTimeout(() => reloadTo(latest), 600);
  });
}

initTabbar();
initTypingMode();
populateGuideText();
initGuideNavigation();
initSettings();
initExploreMode();
const resetCapture = initCapture();
initResults(resetCapture);
initDetail();
initHistory();
initCloudSettings();
initUpdates();
if (cloudPinnedMessage) {
  showView("settings");
  setTimeout(() => document.getElementById("cloud-status").scrollIntoView({ block: "center" }), 0);
} else if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
