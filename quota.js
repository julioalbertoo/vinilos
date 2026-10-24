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
    limit: violation.quotaValue !== undefined && violation.quotaValue !== "" ? Number(violation.quotaValue) : null,
    perDay: /PerDay/i.test(violation.quotaId || ""),
    retrySeconds: Number.isFinite(retrySeconds) ? retrySeconds : null,
  };
}

function errorText(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    const error = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    return String((error && error.message) || bodyText || "").slice(0, 160);
  } catch {
    return String(bodyText || "").slice(0, 160);
  }
}

// Estado de un modelo tras una respuesta: ok, quota (sin cupo hasta until), busy (saturado o sin
// respuesta), gone (retirado) o error (otro fallo, con su mensaje).
function stateFrom(status, body, now) {
  const at = now.toISOString();
  if (status === 200) return { state: "ok", at };
  if (status === 429) {
    const info = parseQuotaError(body);
    const until = info.perDay
      ? nextPacificMidnight(now).toISOString()
      : new Date(now.getTime() + (info.retrySeconds || 60) * 1000).toISOString();
    // Límite 0: el plan gratuito no incluye ese modelo (o su búsqueda): no vuelve hasta mañana ni nunca.
    return { state: "quota", at, until, limit: info.limit, perDay: info.perDay || info.limit === 0 };
  }
  if (status === 404) return { state: "gone", at };
  if (status === 0 || status >= 500) return { state: "busy", at };
  return { state: "error", at, detail: errorText(body) };
}

// Apunta una consulta a un modelo. status: código HTTP (0 = sin respuesta). search: con búsqueda de Google,
// que tiene su propio cupo: se apunta aparte (web) de las consultas normales (plain).
export function recordCall(model, { status, body = "", search = false }) {
  if (!model) return;
  const data = read();
  const m = (data.models[model] = data.models[model] || { used: 0, search: 0 });
  // Solo gastan cupo las consultas que Google atiende; las rechazadas (sin cupo, error) no cuentan.
  if (status === 200) {
    m.used += 1;
    if (search) m.search += 1;
  }
  const next = stateFrom(status, body, new Date());
  const key = search ? "web" : "plain";
  // El límite conocido se conserva aunque luego vuelva a responder.
  const limit = next.limit ?? (m[key] && m[key].limit) ?? null;
  const perDay = next.state === "quota" ? next.perDay : Boolean(m[key] && m[key].perDay);
  m[key] = { ...next, limit, perDay };
  // Si responde con búsqueda, también respondería sin ella.
  if (search && status === 200) m.plain = { ...(m.plain || {}), state: "ok", at: next.at, until: null };
  write(data);
}

const BUSY_SKIP_MS = 2 * 60 * 1000;
const ERROR_SKIP_MS = 6 * 3600 * 1000;

function current(entry) {
  if (!entry || !entry.state) return { state: "unknown" };
  if (entry.state === "quota" && entry.until && new Date(entry.until).getTime() <= Date.now()) return { ...entry, state: "back" };
  return entry;
}

// ¿Merece la pena saltarse este modelo? Sí si se sabe que no tiene cupo, si estaba saturado hace
// menos de 2 minutos, si Google lo retiró o (con búsqueda) si dio un error hace menos de 6 horas.
export function shouldSkip(model, search) {
  const data = read();
  const m = data.models[model];
  if (!m) return false;
  const entry = current(search ? m.web : m.plain);
  const age = entry.at ? Date.now() - new Date(entry.at).getTime() : Infinity;
  if (entry.state === "quota" || entry.state === "gone") return true;
  if (entry.state === "busy") return age < BUSY_SKIP_MS;
  if (entry.state === "error") return search && age < ERROR_SKIP_MS;
  return false;
}

// Estado de cada modelo para Ajustes: { model, used, search, plain, web }; plain y web son
// { state, at, until, limit, perDay, detail }. Un «sin cupo» cuya hora ya pasó sale como «back».
export function quotaReport(models) {
  const data = read();
  return models.map((model) => {
    const m = data.models[model] || { used: 0, search: 0 };
    // Versión anterior: el estado iba suelto en el modelo.
    const plain = m.plain || (m.state ? { state: m.state, at: m.at, until: m.until, limit: m.limit, perDay: m.perDay } : null);
    return { model, used: m.used || 0, search: m.search || 0, plain: current(plain), web: current(m.web) };
  });
}
