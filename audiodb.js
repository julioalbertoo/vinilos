// TheAudioDB: reseñas de álbumes y biografías de artistas, a veces en castellano.
// Usa la llave pública de prueba («123»), que no pide cuenta.
const BASE = "https://www.theaudiodb.com/api/v1/json/123";

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

async function audioDbGet(file, params) {
  const response = await fetch(`${BASE}/${file}?${new URLSearchParams(params)}`);
  if (!response.ok) throw new Error(`TheAudioDB respondió ${response.status}`);
  return response.json();
}

// Primero el texto en castellano; si no, en inglés.
const pickText = (item, field) => String(item[`${field}ES`] || item[`${field}EN`] || "").trim();

// Reseña del álbum: { title, url, text } o null.
export async function audioDbAlbum(artist, title) {
  const data = await audioDbGet("searchalbum.php", { s: artist, a: title });
  const album = ((data && data.album) || []).find((a) => norm(a.strArtist) === norm(artist) && norm(a.strAlbum) === norm(title));
  const text = album && pickText(album, "strDescription");
  return text ? { title: album.strAlbum, url: `https://www.theaudiodb.com/album/${album.idAlbum}`, text } : null;
}

// Biografía del artista: { title, url, text } o null.
export async function audioDbArtist(artist) {
  const data = await audioDbGet("search.php", { s: artist });
  const found = ((data && data.artists) || []).find((a) => norm(a.strArtist) === norm(artist));
  const text = found && pickText(found, "strBiography");
  return text ? { title: found.strArtist, url: `https://www.theaudiodb.com/artist/${found.idArtist}`, text } : null;
}
