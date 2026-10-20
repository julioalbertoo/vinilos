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

// Foto de las dos llaves y de si ya se comprobaron.
export function getTokenState() {
  return {
    aiKey: getAiKey(),
    discogsToken: getDiscogsToken(),
    aiVerified: localStorage.getItem(KEYS.aiVerified) === "1",
    discogsVerified: localStorage.getItem(KEYS.discogsVerified) === "1",
  };
}

// Escribe las llaves traídas de la nube sin avisar (no hay que volver a subirlas).
export function applyTokenState({ aiKey, discogsToken, aiVerified, discogsVerified }) {
  localStorage.setItem(KEYS.aiKey, aiKey || "");
  localStorage.setItem(KEYS.discogsToken, discogsToken || "");
  if (aiKey && aiVerified) localStorage.setItem(KEYS.aiVerified, "1");
  else localStorage.removeItem(KEYS.aiVerified);
  if (discogsToken && discogsVerified) localStorage.setItem(KEYS.discogsVerified, "1");
  else localStorage.removeItem(KEYS.discogsVerified);
}

function clean(value) {
  return (value || "").trim().replace(/\s+/g, "");
}

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
