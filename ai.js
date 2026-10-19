import { CONFIG } from "./config.js";

function interpretStatus(status) {
  if (status === 401 || status === 403) {
    return "El token de GitHub no es válido o le falta el permiso Models (read-only). Revisa la guía.";
  }
  if (status === 429) {
    return "Se ha alcanzado el límite gratuito de GitHub Models por ahora. Inténtalo de nuevo en unos minutos.";
  }
  if (status === 404) {
    return "El Worker respondió, pero el modelo indicado no existe en el catálogo de GitHub Models.";
  }
  return `GitHub Models respondió con un error inesperado (código ${status}).`;
}

export async function testGithubConnection(githubToken) {
  if (!CONFIG.AI_PROVIDER.workerUrl) {
    return { ok: false, reason: "Todavía no se ha configurado la URL del Worker de Cloudflare." };
  }
  if (!githubToken) {
    return { ok: false, reason: "Falta el token de GitHub." };
  }
  try {
    const response = await fetch(CONFIG.AI_PROVIDER.workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.AI_PROVIDER.fallbackModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    if (response.ok) {
      return { ok: true, reason: "Conexión correcta." };
    }
    return { ok: false, reason: interpretStatus(response.status) };
  } catch (err) {
    return {
      ok: false,
      reason: "No se pudo contactar con el Worker. Revisa que esté desplegado y la URL en config.js.",
    };
  }
}
