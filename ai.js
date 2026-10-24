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

const MODEL_TIMEOUT_MS = 30000;

// Gemma no admite instrucciones de sistema: a ese modelo se le dan dentro del mensaje.
function buildMessages(model, imageDataUrl) {
  const image = { type: "image_url", image_url: { url: imageDataUrl } };
  if (model.startsWith("gemma")) {
    return [{ role: "user", content: [{ type: "text", text: `${SYSTEM_PROMPT}\n\nIdentifica este disco de vinilo.` }, image] }];
  }
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [{ type: "text", text: "Identifica este disco de vinilo." }, image] },
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
        messages: buildMessages(model, imageDataUrl),
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
    return {
      ok: false,
      detail,
      authError: detail === INVALID_KEY_MESSAGE,
      quotaError: response.status === 429,
      // 404: Google ha retirado ese modelo; se salta sin contar como fallo.
      notFound: response.status === 404,
      // 5xx: saturado o caído un momento; merece la pena reintentar.
      busy: response.status >= 500,
    };
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

const BUSY_RETRIES = 2;

export async function identify(imageDataUrl, aiKey, onAttempt) {
  const { primaryModel, fallbackModel } = CONFIG.AI_PROVIDER;
  const models = [primaryModel, fallbackModel, ...(await backupModels(aiKey))];
  const attempts = [];
  for (const [index, model] of models.entries()) {
    if (onAttempt) onAttempt(model, attempts.at(-1)?.detail, 0);
    let result = await tryModel(model, aiKey, imageDataUrl);
    if (result.authError) {
      // Con la llave mal, ningún modelo va a funcionar: no se gasta tiempo en el resto.
      return { ok: false, reason: INVALID_KEY_MESSAGE, authError: true, attempts: [...attempts, { model, detail: result.detail }] };
    }
    // Si Gemini está saturado (suele durar segundos), se espera un poco y se reintenta hasta 2 veces.
    // Solo con el modelo principal: con los de respaldo es más rápido pasar al siguiente.
    const retries = index === 0 ? BUSY_RETRIES : 0;
    for (let retry = 1; retry <= retries && result.busy; retry += 1) {
      if (onAttempt) onAttempt(model, attempts.at(-1)?.detail, retry);
      await new Promise((resolve) => setTimeout(resolve, retry * 4000));
      result = await tryModel(model, aiKey, imageDataUrl);
    }
    if (result.ok) {
      return { ok: true, data: result.data, modelUsed: model, attempts };
    }
    attempts.push({
      model,
      detail: result.detail,
      authError: Boolean(result.authError),
      quotaError: Boolean(result.quotaError),
      notFound: Boolean(result.notFound),
    });
  }
  const counted = attempts.filter((a) => !a.notFound);
  if (counted.length && counted.every((a) => a.quotaError)) {
    return {
      ok: false,
      reason:
        "Se ha agotado el cupo gratuito de Gemini por ahora. Inténtalo más tarde o usa el escáner de código de barras, que no gasta cupo de IA.",
      attempts,
    };
  }
  if (attempts.some((a) => a.quotaError)) {
    return {
      ok: false,
      reason:
        "Gemini está sin cupo gratuito o saturado ahora mismo. Espera unos minutos y pulsa «Reintentar», o usa el escáner de código de barras, que no gasta cupo de IA.",
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

// Para esto se usa la conexión nativa de Gemini: es la única que acepta enlaces a fotos
// (file_data) además de fotos incrustadas (inline_data).
const NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Google retira modelos cada pocos meses, así que los de respaldo se le preguntan a Google
// (con la llave del usuario) en vez de fijarlos en el código. La lista se pide una vez por visita.
const MAX_BACKUPS = 4;
let modelNamesPromise = null;

async function fetchModelNames(aiKey) {
  const names = new Set();
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`${NATIVE_BASE}?${query}`, { headers: { "x-goog-api-key": aiKey } });
    if (!response.ok) throw new Error(`código ${response.status}`);
    const data = await response.json();
    for (const m of data.models || []) {
      if ((m.supportedGenerationMethods || []).includes("generateContent")) names.add(String(m.name).replace(/^models\//, ""));
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return names;
}

// Versión de un modelo ("gemini-3.8-flash" → 3.8) para probar antes los más nuevos.
const modelVersion = (name) => Number((/-(\d+(?:\.\d+)?)/.exec(name) || [])[1]) || 0;

// Modelos que entienden fotos y devuelven texto: Gemini Flash (normal o Lite) y Gemma grandes.
// Se dejan fuera las variantes de voz, imagen, vídeo, etc. y las versiones de prueba.
function isUsefulModel(name) {
  if (/^gemini-\d+(\.\d+)?-flash(-lite)?$/.test(name)) return true;
  const gemma = /^gemma-\d+(?:\.\d+)?-(\d+)b-it$/.exec(name);
  return Boolean(gemma) && Number(gemma[1]) >= 12;
}

async function backupModels(aiKey) {
  const { primaryModel, fallbackModel, extraModels = [] } = CONFIG.AI_PROVIDER;
  if (!modelNamesPromise) {
    modelNamesPromise = fetchModelNames(aiKey).catch(() => {
      modelNamesPromise = null;
      return null;
    });
  }
  const names = await modelNamesPromise;
  // Si Google no da la lista, se usan los de la configuración tal cual.
  if (!names) return extraModels;
  const skip = new Set([primaryModel, fallbackModel]);
  const configured = extraModels.filter((m) => names.has(m) && !skip.has(m));
  const found = [...names]
    .filter((m) => isUsefulModel(m) && !skip.has(m) && !configured.includes(m))
    // Primero Gemini (del más nuevo al más viejo) y Gemma al final.
    .sort((a, b) => Number(a.startsWith("gemma")) - Number(b.startsWith("gemma")) || modelVersion(b) - modelVersion(a));
  return [...configured, ...found].slice(0, MAX_BACKUPS);
}

// Todos los modelos Gemini útiles que tiene la llave, del más nuevo al más viejo, sin límite.
// Para el dato curioso, que puede probar más modelos (cada uno tiene su cupo) antes de rendirse.
async function allModels(aiKey, { gemma }) {
  const { primaryModel, fallbackModel, extraModels = [] } = CONFIG.AI_PROVIDER;
  await backupModels(aiKey);
  const names = await modelNamesPromise;
  const found = names
    ? [...names]
        .filter((m) => isUsefulModel(m) && (gemma || !m.startsWith("gemma")))
        .sort((a, b) => Number(a.startsWith("gemma")) - Number(b.startsWith("gemma")) || modelVersion(b) - modelVersion(a))
    : extraModels;
  // Primero el ligero; el principal al final, para guardar su cupo para identificar discos.
  return [...new Set([fallbackModel, ...found.filter((m) => m !== primaryModel), primaryModel])];
}

// Prueba los modelos uno tras otro hasta que uno responda. Ni la falta de cupo ni la saturación
// paran la búsqueda: se pasa al siguiente modelo. Devuelve { ok: true, candidate, model } o
// { ok: false, detail, quota, stop }.
async function firstAnswer(models, parts, aiKey, body) {
  const failures = [];
  let allQuota = true;
  for (const model of models) {
    const result = await callNative(model, parts, aiKey, { body });
    if (!result.ok) {
      if (result.stop) return { ok: false, detail: result.detail, stop: true };
      if (!result.quota && !result.busy && !result.notFound) allQuota = false;
      if (!result.notFound) failures.push(`${model}: ${result.detail}`);
      continue;
    }
    try {
      const candidate = JSON.parse(result.body)?.candidates?.[0];
      if (candidate) return { ok: true, candidate, model };
    } catch {
      // cae al fallo de abajo
    }
    allQuota = false;
    failures.push(`${model}: respuesta vacía`);
  }
  return { ok: false, detail: failures.join(" · ") || "ningún modelo disponible", quota: allQuota && failures.length > 0 };
}

function imagePart(image) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(image);
  if (match) return { inline_data: { mime_type: match[1], data: match[2] } };
  return { file_data: { mime_type: "image/jpeg", file_uri: image } };
}

// Una petición al modelo. busy: saturado o caído un momento (merece reintentar).
// options.body: campos extra de la petición (p. ej. herramientas); sustituyen a los de por defecto.
async function callNative(model, parts, aiKey, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${NATIVE_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": aiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        // Gemma no admite el modo JSON: a ese se le pide el JSON solo en el texto.
        generationConfig: model.startsWith("gemma") ? { temperature: 0 } : { temperature: 0, responseMimeType: "application/json" },
        ...options.body,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err && err.name === "AbortError" ? "tiempo agotado" : `error de red (${err && err.message ? err.message : err})`;
    return { ok: false, detail, busy: true };
  } finally {
    clearTimeout(timer);
  }
  const body = await response.text();
  if (response.ok) return { ok: true, body };
  const detail = describeError(response.status, body);
  if (response.status >= 500) return { ok: false, detail, busy: true };
  if (response.status === 429) return { ok: false, detail, quota: true };
  // 404: Google ha retirado ese modelo; se salta sin contar como fallo.
  if (response.status === 404) return { ok: false, detail, notFound: true };
  // Sin llave válida no tiene sentido seguir con más discos.
  return { ok: false, detail, stop: detail === INVALID_KEY_MESSAGE };
}

// images: lista de data URL o de enlaces. Devuelve { ok: true, index, box } (index null = no hay
// galleta) o { ok: false, detail, stop }.
export async function locateLabel(images, aiKey) {
  const parts = [{ text: LABEL_PROMPT }];
  images.forEach((image, i) => parts.push({ text: `Foto ${i}:` }, imagePart(image)));

  // Se prueba primero el modelo ligero y, si falla, los de respaldo. El principal se reserva entero
  // para identificar discos, porque cada modelo tiene su propio cupo gratuito y no se comparte.
  const models = [CONFIG.AI_PROVIDER.fallbackModel, ...(await backupModels(aiKey))];
  const failures = [];
  let allBusy = true;
  for (const model of models) {
    const result = await callNative(model, parts, aiKey);
    if (!result.ok) {
      // Sin llave válida no sirve probar otros modelos.
      if (result.stop) return result;
      if (!result.busy && !result.quota && !result.notFound) allBusy = false;
      failures.push(`${model}: ${result.detail}`);
      continue;
    }
    const parsed = parseLabelAnswer(result.body, images.length);
    if (parsed) return parsed;
    allBusy = false;
    failures.push(`${model}: la IA no devolvió el JSON pedido`);
  }
  // busy: todos saturados o sin cupo, así que se reintenta otro rato.
  return { ok: false, detail: failures.join(" · "), busy: allBusy, stop: allBusy };
}

// Lee la respuesta de la IA. Devuelve null si no trae el JSON pedido.
function parseLabelAnswer(body, count) {
  let data = null;
  try {
    const text = (JSON.parse(body)?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    data = extractJson(text);
  } catch {
    // cae al null de abajo
  }
  if (!data || !("index" in data)) return null;
  const index = Number.isInteger(data.index) && data.index >= 0 && data.index < count ? data.index : null;
  const box = Array.isArray(data.box_2d) && data.box_2d.length === 4 ? data.box_2d.map(Number) : null;
  if (index === null || !box || box.some((n) => !Number.isFinite(n))) return { ok: true, index: null };
  const [ymin, xmin, ymax, xmax] = box;
  if (xmax - xmin < 50 || ymax - ymin < 50) return { ok: true, index: null };
  return { ok: true, index, box: { ymin, xmin, ymax, xmax } };
}

// Pregunta con la búsqueda de Google activada: Gemini busca en internet y devuelve qué páginas
// respaldan cada trozo de su respuesta (groundingMetadata). Gemma no sabe buscar, así que se salta.
export async function askWithGoogleSearch(prompt, aiKey) {
  const body = { tools: [{ google_search: {} }], generationConfig: { temperature: 1 } };
  return firstAnswer(await allModels(aiKey, { gemma: false }), [{ text: prompt }], aiKey, body);
}

// Pregunta normal, sin buscar en internet (gasta otro cupo distinto al de la búsqueda de Google).
// Gemma sí vale aquí, como último recurso. Devuelve lo mismo que askWithGoogleSearch.
export async function askPlain(prompt, aiKey) {
  return firstAnswer(await allModels(aiKey, { gemma: true }), [{ text: prompt }], aiKey, { generationConfig: { temperature: 0.8 } });
}
