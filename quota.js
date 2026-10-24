// Cupo de Gemini por modelo, para enseñarlo en Ajustes.
// Google no deja preguntar cuánto cupo queda: solo lo dice al agotarse (error 429, con el límite y
// cuándo vuelve). Así que aquí se apunta lo que sabemos:
// - cuántas consultas ha hecho hoy este móvil a cada modelo (con y sin búsqueda de Google);
// - lo último que dijo Google de cada modelo: si respondió o si estaba sin cupo, con su límite y hasta cuándo.
// Los cupos diarios de Google se renuevan a medianoche de California (hora del Pacífico).
const KEY = "vinilos_gemini_quota";
const PACIFIC = "America/Los_Angeles";

export const pacificDay = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// Próxima medianoche del Pacífico: se busca la primera hora en punto en que cambia el día de allí.
export function nextPacificMidnight(now = new Date()) {
  const today = pacificDay(now);
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  for (let i = 0; i < 26; i += 1) {
    t.setHours(t.getHours() + 1);
    if (pacificDay(t) !== today) return new Date(t);
  }
  return new Date(now.getTime() + 24 * 3600 * 1000);
}

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    // Al cambiar de día se ponen a cero los contadores; lo último que dijo Google se conserva.
    if (data.day !== pacificDay()) {
      data.day = pacificDay();
      for (const m of Object.values(data.models || {})) {
        m.used = 0;
        m.search = 0;
      }
    }
    data.models = data.models || {};
    return data;
  } catch {
    return { day: pacificDay(), models: {} };
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Sin espacio: no pasa nada, solo se pierde el contador.
  }
}

// Lee del error de Google el límite que se ha agotado y cuánto falta para que vuelva.
export function parseQuotaError(bodyText) {
  let error = null;
  try {
    const parsed = JSON.parse(bodyText);
    error = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
  } catch {
    return {};
  }
  const details = (error && error.details) || [];
  const violation = details.flatMap((d) => d.violations || []).find((v) => v.quotaId || v.quotaValue) || {};
  const retry = details.find((d) => d.retryDelay);
  const retrySeconds = retry ? Number.parseFloat(String(retry.retryDelay)) : null;
  return {
    quotaId: violation.quotaId || "",
    limit: violation.quotaValue ? Number(violation.quotaValue) : null,
    perDay: /PerDay/i.test(violation.quotaId || ""),
    retrySeconds: Number.isFinite(retrySeconds) ? retrySeconds : null,
  };
}

// Apunta una consulta a un modelo. status: código HTTP (0 = sin respuesta). search: con búsqueda de Google.
export function recordCall(model, { status, body = "", search = false }) {
  if (!model) return;
  const data = read();
  const m = (data.models[model] = data.models[model] || { used: 0, search: 0 });
  // Solo gastan cupo las consultas que Google atiende; las rechazadas (sin cupo, error) no cuentan.
  if (status === 200) {
    m.used += 1;
    if (search) m.search += 1;
  }
  const now = new Date();
  if (status === 200) {
    m.state = "ok";
    m.at = now.toISOString();
    m.until = null;
  } else if (status === 429) {
    const info = parseQuotaError(body);
    m.state = "quota";
    m.at = now.toISOString();
    m.quotaId = info.quotaId;
    if (info.limit) m.limit = info.limit;
    m.perDay = info.perDay;
    m.until = info.perDay
      ? nextPacificMidnight(now).toISOString()
      : new Date(now.getTime() + (info.retrySeconds || 60) * 1000).toISOString();
  } else if (status === 404) {
    m.state = "gone";
    m.at = now.toISOString();
  } else if (status >= 500 || status === 0) {
    m.state = "busy";
    m.at = now.toISOString();
  }
  write(data);
}

// Estado de cada modelo para Ajustes: { model, used, search, state, at, until, limit, perDay }.
// Un «sin cupo» cuya hora de vuelta ya pasó se da por disponible otra vez.
export function quotaReport(models) {
  const data = read();
  const now = Date.now();
  return models.map((model) => {
    const m = data.models[model] || { used: 0, search: 0 };
    let state = m.state || "unknown";
    if (state === "quota" && m.until && new Date(m.until).getTime() <= now) state = "back";
    return { model, used: m.used || 0, search: m.search || 0, state, at: m.at || null, until: m.until || null, limit: m.limit || null, perDay: Boolean(m.perDay) };
  });
}
