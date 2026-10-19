import { CONFIG } from "./config.js";

const KEYS = CONFIG.STORAGE_KEYS;

function clean(value) {
  return (value || "").trim().replace(/\s+/g, "");
}

export function getGithubToken() {
  return localStorage.getItem(KEYS.githubToken) || "";
}

export function setGithubToken(value) {
  const cleaned = clean(value);
  if (cleaned !== getGithubToken()) {
    localStorage.setItem(KEYS.githubToken, cleaned);
    localStorage.setItem(KEYS.githubTokenSavedAt, String(Date.now()));
    localStorage.removeItem(KEYS.githubVerified);
  }
  return cleaned;
}

export function clearGithubToken() {
  localStorage.removeItem(KEYS.githubToken);
  localStorage.removeItem(KEYS.githubTokenSavedAt);
  localStorage.removeItem(KEYS.githubVerified);
}

export function getGithubTokenAgeDays() {
  const savedAt = localStorage.getItem(KEYS.githubTokenSavedAt);
  if (!savedAt) return null;
  return Math.floor((Date.now() - Number(savedAt)) / (1000 * 60 * 60 * 24));
}

export function markGithubVerified(ok) {
  if (ok) localStorage.setItem(KEYS.githubVerified, "1");
  else localStorage.removeItem(KEYS.githubVerified);
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
  return Boolean(getGithubToken() && getDiscogsToken());
}

export function areTokensVerified() {
  return (
    hasTokens() &&
    localStorage.getItem(KEYS.githubVerified) === "1" &&
    localStorage.getItem(KEYS.discogsVerified) === "1"
  );
}
