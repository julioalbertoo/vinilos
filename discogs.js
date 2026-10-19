import { CONFIG } from "./config.js";

function interpretStatus(status) {
  if (status === 401 || status === 403) {
    return "El token de Discogs no es válido. Revisa que lo copiaste bien.";
  }
  if (status === 429) {
    return "Se ha alcanzado el límite de peticiones de Discogs por ahora. Espera un minuto.";
  }
  return `Discogs respondió con un error inesperado (código ${status}).`;
}

export async function testDiscogsConnection(discogsToken) {
  if (!discogsToken) {
    return { ok: false, reason: "Falta el token de Discogs." };
  }
  try {
    const response = await fetch(`${CONFIG.DISCOGS.baseUrl}/oauth/identity`, {
      headers: { Authorization: `Discogs token=${discogsToken}` },
    });
    if (response.ok) {
      const data = await response.json();
      return { ok: true, reason: `Conectado como ${data.username}.` };
    }
    return { ok: false, reason: interpretStatus(response.status) };
  } catch (err) {
    return { ok: false, reason: "No se pudo contactar con Discogs. Comprueba tu conexión a internet." };
  }
}
