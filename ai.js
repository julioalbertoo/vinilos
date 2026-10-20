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
  "Si ves un código de barras, pon en barcode los números impresos junto a las barras (solo las cifras, sin espacios). " +
  "Usa null en cualquier campo que no puedas leer con certeza en la imagen. No inventes datos. " +
  "confidence es un número entre 0 y 1 que indica cuánto confías en tu lectura global.";

const MODEL_TIMEOUT_MS = 45000;

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

// Google devuelve el error a veces como objeto y a veces dentro de una lista.
function errorMessageFrom(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const error = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    return error?.message || bodyText;
  } catch {
    return bodyText;
  }
}

const INVALID_KEY_MESSAGE = "La llave de Google Gemini no es válida. Revisa que la copiaste entera.";

function describeError(status, bodyText) {
  const message = errorMessageFrom(bodyText);
  if (/api key/i.test(message) || status === 401) {
    return INVALID_KEY_MESSAGE;
  }
  if (/location/i.test(message)) {
    return "El plan gratuito de Gemini no está disponible desde tu país.";
  }
  if (status === 429) {
    return "se ha agotado su cupo gratuito por ahora";
  }
  if (status === 404) {
    return `El modelo no existe en Gemini: ${message.slice(0, 200)}`;
  }
  return `Gemini respondió con un error (código ${status}): ${message.slice(0, 200)}`;
}

async function postChat(aiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(CONFIG.AI_PROVIDER.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function tryModel(model, aiKey, imageDataUrl) {
  let response;
  try {
    response = await postChat(
      aiKey,
      {
        model,
        messages: buildMessages(imageDataUrl),
        temperature: 0.1,
        // Margen amplio: los modelos Flash "piensan" antes de responder y eso también consume tokens.
        max_tokens: 4096,
      },
      MODEL_TIMEOUT_MS
    );
  } catch (err) {
    if (err && err.name === "AbortError") {
      return { ok: false, detail: `tiempo agotado (${MODEL_TIMEOUT_MS / 1000} s)` };
    }
    return { ok: false, detail: `error de red: ${err && err.message ? err.message : err}` };
  }

  const body = await response.text();
  if (!response.ok) {
    const detail = describeError(response.status, body);
    return { ok: false, detail, authError: detail === INVALID_KEY_MESSAGE, quotaError: response.status === 429 };
  }

  let text;
  try {
    text = JSON.parse(body)?.choices?.[0]?.message?.content;
  } catch {
    return { ok: false, detail: `respuesta inesperada: ${body.slice(0, 200)}` };
  }
  const data = extractJson(text);
  if (!hasExpectedShape(data)) {
    return { ok: false, detail: `la IA no devolvió el JSON pedido: ${(text || "(vacío)").slice(0, 200)}` };
  }
  if (data.confidence !== null && data.confidence < 0.3) {
    return { ok: false, detail: `confianza baja (${data.confidence})`, data };
  }
  return { ok: true, data };
}

export async function identify(imageDataUrl, aiKey, onAttempt) {
  const models = [CONFIG.AI_PROVIDER.primaryModel, CONFIG.AI_PROVIDER.fallbackModel];
  const attempts = [];
  for (const model of models) {
    if (onAttempt) onAttempt(model, attempts.at(-1)?.detail);
    const result = await tryModel(model, aiKey, imageDataUrl);
    if (result.ok) {
      return { ok: true, data: result.data, modelUsed: model, attempts };
    }
    attempts.push({
      model,
      detail: result.detail,
      authError: Boolean(result.authError),
      quotaError: Boolean(result.quotaError),
    });
  }
  if (attempts.every((a) => a.authError)) {
    return { ok: false, reason: INVALID_KEY_MESSAGE, authError: true, attempts };
  }
  if (attempts.every((a) => a.quotaError)) {
    return {
      ok: false,
      reason:
        "Se ha agotado el cupo gratuito de Gemini por ahora. Inténtalo más tarde o usa el escáner de código de barras, que no gasta cupo de IA.",
      attempts,
    };
  }
  return {
    ok: false,
    reason: "No se pudo identificar el disco. Prueba con otra foto, con más luz, o escanea el código de barras.",
    attempts,
  };
}

export async function testAiConnection(aiKey) {
  if (!aiKey) {
    return { ok: false, reason: "Falta la llave de Google Gemini." };
  }
  let response;
  try {
    response = await postChat(
      aiKey,
      {
        model: CONFIG.AI_PROVIDER.pingModel,
        messages: [{ role: "user", content: "Responde solo con la palabra: ok" }],
        max_tokens: 20,
      },
      20000
    );
  } catch {
    return { ok: false, reason: "No se pudo contactar con Google Gemini. Comprueba tu conexión a internet." };
  }
  const body = await response.text();
  if (!response.ok) {
    return { ok: false, reason: describeError(response.status, body) };
  }
  try {
    if (Array.isArray(JSON.parse(body).choices)) {
      return { ok: true, reason: "Conexión correcta: Gemini ha respondido." };
    }
  } catch {
    // cae al mensaje de abajo
  }
  return { ok: false, reason: `Respuesta inesperada de Gemini: ${body.slice(0, 120)}` };
}

const LABEL_PROMPT =
  "Te doy varias fotos numeradas (empezando en 0) de una misma edición de un disco de vinilo. " +
  "Busca la que muestre la galleta (la etiqueta de papel redonda del centro del vinilo) entera y de frente; " +
  "si hay varias, prefiere la cara A. Devuelve SOLO un JSON, sin texto alrededor: " +
  '{"index": número de la foto o null si ninguna muestra la galleta, ' +
  '"box_2d": [ymin, xmin, ymax, xmax] del círculo de la galleta en esa foto, en escala 0-1000}. ' +
  "La caja debe rodear solo la etiqueta de papel, sin los surcos del vinilo.";

// images: lista de data URL (o enlaces, si el navegador no pudo descargarlas).
// Devuelve { ok: true, index, box } (index null = no hay galleta) o { ok: false, detail, stop }.
export async function locateLabel(images, aiKey) {
  const content = [{ type: "text", text: LABEL_PROMPT }];
  images.forEach((url, i) => {
    content.push({ type: "text", text: `Foto ${i}:` });
    content.push({ type: "image_url", image_url: { url } });
  });
  let response;
  try {
    response = await postChat(
      aiKey,
      {
        model: CONFIG.AI_PROVIDER.primaryModel,
        messages: [{ role: "user", content }],
        temperature: 0,
        max_tokens: 4096,
      },
      MODEL_TIMEOUT_MS
    );
  } catch (err) {
    return { ok: false, detail: `error de red: ${err && err.message ? err.message : err}` };
  }
  const body = await response.text();
  if (!response.ok) {
    const detail = describeError(response.status, body);
    // Sin llave válida o sin cupo no tiene sentido seguir con más discos.
    return { ok: false, detail, stop: detail === INVALID_KEY_MESSAGE || response.status === 429 };
  }
  let data = null;
  try {
    data = extractJson(JSON.parse(body)?.choices?.[0]?.message?.content);
  } catch {
    // cae al error de abajo
  }
  if (!data || !("index" in data)) return { ok: false, detail: "la IA no devolvió el JSON pedido" };
  const index = Number.isInteger(data.index) && data.index >= 0 && data.index < images.length ? data.index : null;
  const box = Array.isArray(data.box_2d) && data.box_2d.length === 4 ? data.box_2d.map(Number) : null;
  if (index === null || !box || box.some((n) => !Number.isFinite(n))) return { ok: true, index: null };
  const [ymin, xmin, ymax, xmax] = box;
  if (xmax - xmin < 50 || ymax - ymin < 50) return { ok: true, index: null };
  return { ok: true, index, box: { ymin, xmin, ymax, xmax } };
}
