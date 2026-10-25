// Genius: la historia de cada canción («About»), escrita por su comunidad. Necesita una llave
// gratuita del usuario (genius.com/api-clients). La llave va en la dirección (access_token) para que
// el navegador no tenga que pedir permiso antes de cada consulta.
const BASE = "https://api.genius.com";

const norm = (text) =>
  String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*\(\d+\)/g, "")
    .replace(/\*/g, "")
    .replace(/^(the|los|las|el|la)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function geniusGet(path, params, token) {
  const query = new URLSearchParams({ ...params, access_token: token });
  const response = await fetch(`${BASE}${path}?${query}`);
  if (!response.ok) throw new Error(`Genius respondió ${response.status}`);
  const data = await response.json();
  return data.response || {};
}

// Historia de la canción en Genius: { title, url, text } o null si no se encuentra o no tiene.
export async function geniusSongStory(token, artist, track) {
  if (!token) return null;
  const found = await geniusGet("/search", { q: `${track} ${artist}` }, token);
  const hit = (found.hits || [])
    .map((h) => h.result)
    .find((s) => s && norm(s.primary_artist && s.primary_artist.name).includes(norm(artist)) && norm(s.title).includes(norm(track)));
  if (!hit) return null;
  const song = (await geniusGet(`/songs/${hit.id}`, { text_format: "plain" }, token)).song || {};
  const text = String((song.description && song.description.plain) || "").trim();
  if (!text || text === "?") return null;
  return { title: song.full_title || hit.full_title || track, url: song.url || hit.url, text };
}
