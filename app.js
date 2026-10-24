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
import { testDiscogsConnection, findCandidates, searchByText, getMasterYear, masterMainRelease, findAlbumRelease, bothYears, countryWithFlag, vinylColor, releaseWeight } from "./discogs.js";
import { prepareImage } from "./imaging.js";
import { rankCandidates } from "./scoring.js";
import { startScanner, describeCameraError } from "./barcode.js";
import { getHistory, addToHistory, removeFromHistory, clearHistory, updateHistoryItem } from "./history.js";
import { renderGallery, updateSlide } from "./gallery.js";
import { cachedRelease, rememberRelease, cachedPrices, cachedCheapest } from "./details.js";
import { renderStats, setStatsActive } from "./stats.js";
import { renderArtistIndex, renderArtistPage, hasArtistPage, cleanName as cleanArtistName } from "./artist.js";
import { fillMissingLabels, stopLabelSearch, retryLabel } from "./labels.js";
import { loadTrivia } from "./trivia.js";
import { initCloud, takeAuthError, onCloudStatus, onCloudHistoryChanged, onCloudTokensChanged, sendMagicLink, signInWithPassword, setPassword, signOut, syncAll, isCloudReady } from "./cloud.js";

const SEARCH_STEP_LABELS = {
  barcode: "por código de barras",
  catno: "por número de catálogo",
  "artist-title": "por artista y título",
  text: "por texto libre",
  master: "todas las ediciones del álbum",
};

const VIEWS = ["guide", "settings", "capture", "results", "detail", "collection", "artist"];
const GUIDE_SCREENS = ["intro", "ai", "discogs"];
// Pestaña que se marca en la barra inferior para cada pantalla.
const TAB_FOR_VIEW = { capture: "capture", results: "capture", collection: "collection", settings: "settings" };

// ---------- Botón «atrás» del navegador ----------
// La app es una sola página: para que «atrás» (o deslizar desde el borde en el iPhone) haga lo mismo que
// «← Volver», cada pantalla de detalle (candidatos, ficha, artista) deja una marca en el historial.
const SUB_VIEWS = ["results", "detail", "artist"];
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
  if (name === "detail") return detailReturnView === "artist" ? artistTab : TAB_FOR_VIEW[detailReturnView];
  if (name === "artist") return artistTab;
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

function renderCard(candidate, index, owned) {
  const best = index === 0;
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
  if (have) body.append(el("p", "card-owned", "💿 Ya lo tienes"));
  body.append(el("p", null, [candidate.year || "Año ?", countryWithFlag(candidate.country) || "País ?"].join(" · ")));
  body.append(el("p", null, [candidate.label || "Sello ?", candidate.catno || "Nº cat. ?"].join(" · ")));
  body.append(el("p", null, candidate.formats.join(", ")));
  if (candidate.color) body.append(el("p", "card-color", `🎨 ${candidate.color}`));
  if (candidate.weight) body.append(el("p", "card-weight", `⚖️ ${candidate.weight}`));
  if (candidate.matches.length) {
    body.append(el("p", "card-matches", candidate.matches.map((m) => `✓ ${m}`).join("  ")));
  }
  // Solo el mejor candidato lleva el botón lila: es la acción más probable.
  const select = el("button", best ? "card-select" : "card-select secondary", exploreMode ? "🧭 Explorar este" : "✓ Es este");
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
  nodes.push(el("h2", null, release.artist ? `${release.artist} – ${release.title}` : release.title));
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
    const list = el("ul", "detail-tracks");
    for (const track of release.tracklist) {
      const li = el("li");
      li.append(el("span", "pos", track.position), el("span", "detail-track-title", track.title));
      if (track.duration) li.append(el("span", "detail-track-time", track.duration));
      list.append(li);
    }
    const total = totalDuration(release.tracklist);
    nodes.push(foldable(`🎵 Canciones (${[release.tracklist.length, total].filter(Boolean).join(" · ")})`, list));
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

function renderPrices(id, prices, at) {
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
  const when = pricesAge(at);
  if (when) nodes.push(el("p", "detail-price-note", when));
  nodes.push(spainLink(id));
  box.replaceChildren(...nodes);
  renderAllVinyl();
}

// Precio más bajo de cualquier edición en vinilo del álbum. state: { request, status, best, checked, total, versions, error }
let allVinyl = null;

function renderAllVinyl() {
  const row = document.getElementById("detail-price-all");
  if (!row || !allVinyl || allVinyl.request !== detailRequest) return;
  const { status, best, checked, total, versions, error } = allVinyl;
  const nodes = [el("p", "detail-price-label", "Cualquier edición en vinilo")];
  if (best) nodes.push(el("p", "detail-price-main", `desde ${formatMoney(best)}`));
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
    if (request === detailRequest) renderPrices(id, result.prices, result.at);
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
  box.replaceChildren(title, el("p", "detail-trivia-note", "Buscando en internet un dato curioso con fuentes…"));
  const result = await loadTrivia(release, getAiKey());
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
      loadPrices(release, request);
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
  if (returnView === "artist" && !alreadyOwned) {
    if (request === detailRequest) savedNote.textContent = "Edición principal del álbum · no está en tu colección";
  } else if (fromHistory) {
    // Ya guardado: no se toca.
  } else if (exploreMode) {
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
        // Gramaje ("180 g"; "" si Discogs no lo dice).
        weight: release ? releaseWeight(release) : candidate.weight || undefined,
      });
      if (request === detailRequest) savedNote.textContent = alreadyOwned ? "💿 Ya estaba en tu colección" : "✓ Guardado en tu historial";
    } catch {
      if (request === detailRequest) savedNote.textContent = "❌ No se pudo guardar en el historial (¿memoria del navegador llena?).";
    }
  }

  // «Borrar de mis discos» solo aparece si el disco está en tu colección.
  if (request === detailRequest) {
    const owned = getHistory().some((item) => String(item.release_id) === String(candidate.id));
    document.getElementById("detail-delete").hidden = !owned;
  }
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

// «Cambiar portada»: si la foto principal de Discogs es mala, se elige otra de la edición.
function addCoverPicker(release) {
  const item = getHistory().find((i) => String(i.release_id) === String(release.id));
  const photos = releasePhotos(release);
  if (!item || photos.length < 2) return;
  const grid = el("div", "cover-picker");
  const mark = () => {
    const current = item.cover || release.image;
    for (const b of grid.children) b.classList.toggle("is-current", b.dataset.uri === current);
  };
  for (const photo of photos) {
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
  }
  mark();
  const box = foldable(`🖼️ Cambiar portada (${photos.length} fotos)`, grid);
  box.append(el("p", "detail-meta", "Toca una foto para usarla como portada en «Mis discos»."));
  const content = document.getElementById("detail-content");
  const price = document.getElementById("detail-price");
  if (price) content.insertBefore(box, price.nextSibling);
  else content.append(box);
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
async function openAlbum(album, name) {
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
  if (album.id) openDetail(albumCandidate(album, name), { returnView: "artist" });
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
  if (item.artist) open.append(el("span", "history-meta", item.artist));
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
if (cloudPinnedMessage) {
  showView("settings");
  setTimeout(() => document.getElementById("cloud-status").scrollIntoView({ block: "center" }), 0);
} else if (areTokensVerified()) showView("capture");
else if (hasTokens()) showView("settings");
else openGuide();
