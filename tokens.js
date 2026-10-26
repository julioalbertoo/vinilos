import { CONFIG } from "./config.js";

const KEYS = CONFIG.STORAGE_KEYS;

// La copia en la nube se apunta aquí para enterarse de cada cambio de llaves.
const listeners = [];
export function onTokensChange(fn) {
  listeners.push(fn);
}
function notify() {
  for (const fn of listeners) {
    try {
      fn(getTokenState());
    } catch {
      // Un fallo de la nube nunca debe impedir guardar la llave en el móvil.
    }
  }
}

// Foto de las llaves y de si ya se comprobaron.
export function getTokenState() {
  return {
    aiKey: getAiKey(),
    discogsToken: getDiscogsToken(),
    geniusToken: getGeniusToken(),
    aiVerified: localStorage.getItem(KEYS.aiVerified) === "1",
    discogsVerified: localStorage.getItem(KEYS.discogsVerified) === "1",
  };
}

// Escribe las llaves traídas de la nube sin avisar (no hay que volver a subirlas).
export function applyTokenState({ aiKey, discogsToken, geniusToken, aiVerified, discogsVerified }) {
  localStorage.setItem(KEYS.aiKey, aiKey || "");
  localStorage.setItem(KEYS.discogsToken, discogsToken || "");
  if (geniusToken) localStorage.setItem(KEYS.geniusToken, geniusToken);
  else localStorage.removeItem(KEYS.geniusToken);
  if (aiKey && aiVerified) localStorage.setItem(KEYS.aiVerified, "1");
  else localStorage.removeItem(KEYS.aiVerified);
  if (discogsToken && discogsVerified) localStorage.setItem(KEYS.discogsVerified, "1");
  else localStorage.removeItem(KEYS.discogsVerified);
}

// La llave tal como se guardará: sin espacios ni saltos de línea (al pegarla se suele colar alguno).
export function cleanToken(value) {
  return (value || "").trim().replace(/\s+/g, "");
}
const clean = cleanToken;

export function getAiKey() {
  return localStorage.getItem(KEYS.aiKey) || "";
}

export function setAiKey(value) {
  const cleaned = clean(value);
  if (cleaned !== getAiKey()) {
    localStorage.setItem(KEYS.aiKey, cleaned);
    localStorage.removeItem(KEYS.aiVerified);
    notify();
  }
  return cleaned;
}

export function clearAiKey() {
  localStorage.removeItem(KEYS.aiKey);
  localStorage.removeItem(KEYS.aiVerified);
  notify();
}

export function markAiVerified(ok) {
  if (ok) localStorage.setItem(KEYS.aiVerified, "1");
  else localStorage.removeItem(KEYS.aiVerified);
  notify();
}

export function getDiscogsToken() {
  return localStorage.getItem(KEYS.discogsToken) || "";
}

export function setDiscogsToken(value) {
  const cleaned = clean(value);
  if (cleaned !== getDiscogsToken()) {
    localStorage.setItem(KEYS.discogsToken, cleaned);
    localStorage.removeItem(KEYS.discogsVerified);
    notify();
  }
  return cleaned;
}

export function clearDiscogsToken() {
  localStorage.removeItem(KEYS.discogsToken);
  localStorage.removeItem(KEYS.discogsVerified);
  notify();
}

export function markDiscogsVerified(ok) {
  if (ok) localStorage.setItem(KEYS.discogsVerified, "1");
  else localStorage.removeItem(KEYS.discogsVerified);
  notify();
}

// Llave opcional de Genius (historias de canciones para el dato curioso). También va a la nube.
export function getGeniusToken() {
  return localStorage.getItem(KEYS.geniusToken) || "";
}

export function setGeniusToken(value) {
  const cleaned = clean(value);
  if (cleaned === getGeniusToken()) return cleaned;
  if (cleaned) localStorage.setItem(KEYS.geniusToken, cleaned);
  else localStorage.removeItem(KEYS.geniusToken);
  notify();
  return cleaned;
}

export function hasTokens() {
  return Boolean(getAiKey() && getDiscogsToken());
}

export function areTokensVerified() {
  return (
    hasTokens() &&
    localStorage.getItem(KEYS.aiVerified) === "1" &&
    localStorage.getItem(KEYS.discogsVerified) === "1"
  );
}
