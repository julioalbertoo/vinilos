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

async function tryModel(model, githubToken, imageDataUrl) {
  let response;
  try {
    response = await callModel(model, githubToken, imageDataUrl);
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { ok: false, detail: `tiempo agotado (${MODEL_TIMEOUT_MS / 1000} s)` };
    }
    return { ok: false, detail: `error de red: ${err && err.message ? err.message : err}` };
  }

  const body = await response.text();
  if (!response.ok) {
    if (response.status === 429) {
      return { ok: false, detail: "límite gratuito alcanzado (429)" };
    }
    return { ok: false, detail: `error HTTP ${response.status}: ${body.slice(0, 200)}` };
  }

  let text;
  try {
    text = JSON.parse(body)?.choices?.[0]?.message?.content;
  } catch {
    return { ok: false, detail: `respuesta inesperada: ${body.slice(0, 200)}` };
  }
  const data = extractJson(text);
  if (!hasExpectedShape(data)) {
    return { ok: false, detail: `la IA no devolvió el JSON pedido: ${(text || "").slice(0, 200)}` };
  }
  if (data.confidence !== null && data.confidence < 0.3) {
    return { ok: false, detail: `confianza baja (${data.confidence})`, data };
  }
  return { ok: true, data };
}

export async function identify(imageDataUrl, githubToken, onAttempt) {
  const models = [CONFIG.AI_PROVIDER.primaryModel, CONFIG.AI_PROVIDER.fallbackModel];
  const attempts = [];
  for (const model of models) {
    if (onAttempt) onAttempt(model);
    const result = await tryModel(model, githubToken, imageDataUrl);
    if (result.ok) {
      return { ok: true, data: result.data, modelUsed: model, attempts };
    }
    attempts.push({ model, detail: result.detail });
  }
  return {
    ok: false,
    reason: "No se pudo identificar el disco. Prueba con otra foto, con más luz, o escanea el código de barras.",
    attempts,
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
        model: CONFIG.AI_PROVIDER.pingModel,
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
