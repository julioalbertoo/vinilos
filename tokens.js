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
  localStorage.setItem(KEYS.githubToken, cleaned);
  localStorage.setItem(KEYS.githubTokenSavedAt, String(Date.now()));
  return cleaned;
}

export function clearGithubToken() {
  localStorage.removeItem(KEYS.githubToken);
  localStorage.removeItem(KEYS.githubTokenSavedAt);
}

export function getGithubTokenAgeDays() {
  const savedAt = localStorage.getItem(KEYS.githubTokenSavedAt);
  if (!savedAt) return null;
  return Math.floor((Date.now() - Number(savedAt)) / (1000 * 60 * 60 * 24));
}

export function getDiscogsToken() {
  return localStorage.getItem(KEYS.discogsToken) || "";
}

export function setDiscogsToken(value) {
  const cleaned = clean(value);
  localStorage.setItem(KEYS.discogsToken, cleaned);
  return cleaned;
}

export function clearDiscogsToken() {
  localStorage.removeItem(KEYS.discogsToken);
}

export function hasTokens() {
  return Boolean(getGithubToken() && getDiscogsToken());
}
