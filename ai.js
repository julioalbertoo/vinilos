import { CONFIG } from "./config.js";

const RESPONSE_FIELDS = [
  "artist",
  "title",
  "label",
  "catalog_number",
  "barcode",
  "country",
  "year_hint",
  "format_hint",
  "visible_text",
  "confidence",
];

const SYSTEM_PROMPT =
  "Eres un experto en discos de vinilo. Te doy una foto de un disco (portada, lomo o galleta central). " +
  "Devuelve SOLO un JSON, sin texto alrededor, con estos campos exactos: " +
  "artist, title, label, catalog_number, barcode, country, year_hint, format_hint, visible_text, confidence. " +
  "Usa null en cualquier campo que no puedas leer con certeza en la imagen. No inventes datos. " +
  "confidence es un número entre 0 y 1 que indica cuánto confías en tu lectura global.";

function buildMessages(imageDataUrl) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Identifica este disco de vinilo." },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

function extractJson(text) {
  const match = (text || "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function hasExpectedShape(data) {
  return Boolean(data) && RESPONSE_FIELDS.every((field) => field in data);
}

const MODEL_TIMEOUT_MS = 45000;

async function callModel(model, githubToken, imageDataUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    return await fetch(CONFIG.AI_PROVIDER.workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(imageDataUrl),
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function identify(imageDataUrl, githubToken, onAttempt) {
  const models = [CONFIG.AI_PROVIDER.primaryModel, CONFIG.AI_PROVIDER.fallbackModel];
  for (const model of models) {
    if (onAttempt) onAttempt(model);
    let response;
    try {
      response = await callModel(model, githubToken, imageDataUrl);
    } catch {
      continue; // tiempo agotado o error de red: probamos con el siguiente modelo
    }
    if (!response.ok) continue;
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    const data = extractJson(text);
    if (hasExpectedShape(data) && (data.confidence === null || data.confidence >= 0.3)) {
      return { ok: true, data, modelUsed: model };
    }
  }
  return {
    ok: false,
    reason: "No se pudo identificar el disco. Prueba con otra foto, con más luz, o escanea el código de barras.",
  };
}

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
