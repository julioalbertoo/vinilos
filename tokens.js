import { CONFIG } from "./config.js";

const KEYS = CONFIG.STORAGE_KEYS;

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
  }
  return cleaned;
}

export function clearAiKey() {
  localStorage.removeItem(KEYS.aiKey);
  localStorage.removeItem(KEYS.aiVerified);
}

export function markAiVerified(ok) {
  if (ok) localStorage.setItem(KEYS.aiVerified, "1");
  else localStorage.removeItem(KEYS.aiVerified);
}

export function getDiscogsToken() {
  return localStorage.getItem(KEYS.discogsToken) || "";
}

export function setDiscogsToken(value) {
  const cleaned = clean(value);
  if (cleaned !== getDiscogsToken()) {
    localStorage.setItem(KEYS.discogsToken, cleaned);
    localStorage.removeItem(KEYS.discogsVerified);
  }
  return cleaned;
}

export function clearDiscogsToken() {
  localStorage.removeItem(KEYS.discogsToken);
  localStorage.removeItem(KEYS.discogsVerified);
}

export function markDiscogsVerified(ok) {
  if (ok) localStorage.setItem(KEYS.discogsVerified, "1");
  else localStorage.removeItem(KEYS.discogsVerified);
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
