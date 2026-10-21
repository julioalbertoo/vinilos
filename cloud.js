// Copia en la nube de «Mis discos» y de las llaves de Gemini y Discogs (Supabase). Lo que usa la app sigue
// saliendo del móvil (history.js, tokens.js); esto sube los cambios y, al entrar o al abrir la app, mezcla
// lo de aquí con lo de allí.
// Si la librería no carga o no hay red, la app funciona igual que sin cuenta.
import { CONFIG } from "./config.js";
import { getHistory, onHistoryChange, replaceHistory } from "./history.js";
import { getTokenState, onTokensChange, applyTokenState } from "./tokens.js";

const { url, publishableKey, schema, table, settingsTable, detailsTable } = CONFIG.SUPABASE;
const SYNCED_KEY = CONFIG.STORAGE_KEYS.cloudSynced;
const PENDING_KEY = CONFIG.STORAGE_KEYS.cloudPendingDeletes;

let client = null;
let user = null;
let syncing = null;
const statusListeners = [];
const changeListeners = [];
const tokenListeners = [];

// ---------- Pequeñas listas guardadas en el móvil ----------

function readIds(key) {
  try {
    const ids = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function writeIds(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // Sin espacio: en el peor caso se vuelve a subir algo que ya estaba.
  }
}

// ---------- Avisos a la pantalla ----------

// cb({ user, text, state }) — state: "off" | "busy" | "ok" | "error"
export function onCloudStatus(cb) {
  statusListeners.push(cb);
}

// cb() — cuando la sincronización cambia la lista de discos del móvil.
export function onCloudHistoryChanged(cb) {
  changeListeners.push(cb);
}

// cb() — cuando la sincronización trae llaves de la nube a este móvil.
export function onCloudTokensChanged(cb) {
  tokenListeners.push(cb);
}

function setStatus(state, text) {
  for (const cb of statusListeners) cb({ user, state, text });
}

function timeLabel() {
  return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// ---------- Conversión disco ↔ fila ----------

function toRow(item) {
  return {
    user_id: user.id,
    release_id: Number(item.release_id),
    artist: item.artist || "",
    title: item.title || "",
    year: String(item.year || ""),
    thumb: item.thumb || "",
    cover: item.cover || "",
    label: item.label || null,
    color: item.color === undefined ? null : item.color,
    saved_at: item.date || new Date().toISOString(),
  };
}

function fromRow(row) {
  const item = {
    release_id: Number(row.release_id),
    artist: row.artist,
    title: row.title,
    year: row.year,
    thumb: row.thumb,
    cover: row.cover,
    date: row.saved_at,
  };
  if (row.label) item.label = row.label;
  if (row.color !== null && row.color !== undefined) item.color = row.color;
  return item;
}

// Si un disco está en los dos sitios, manda lo del móvil, pero se aprovecha lo que solo tenga la nube
// (por ejemplo, la galleta que ya buscó la IA en otro dispositivo).
function mergeItem(local, remote) {
  const merged = { ...remote, ...local };
  for (const field of ["artist", "title", "year", "thumb", "cover", "label"]) {
    if (!local[field] && remote[field]) merged[field] = remote[field];
  }
  if (local.color === undefined && remote.color !== undefined) merged.color = remote.color;
  return merged;
}

// ---------- Arranque y sesión ----------

// Si se vuelve de un enlace del correo que ya no vale, Supabase deja el error en la URL
// (#error=access_denied&error_code=otp_expired…). Se lee al cargar, se limpia la URL y se guarda
// un mensaje claro para mostrarlo en Ajustes.
let authError = readAuthErrorFromUrl();

function readAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const code = params.get("error_code") || params.get("error");
  if (!code) return "";
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (code === "otp_expired" || code === "access_denied") {
    return (
      "Ese enlace ya se usó o caducó: cada enlace sirve una sola vez. Si lo abriste antes en otro navegador " +
      "(por ejemplo, Safari), allí ya estás dentro. Para entrar aquí, usa tu email y contraseña, o pide un correo nuevo."
    );
  }
  return `No se pudo entrar con el enlace (${params.get("error_description") || code}). Pide un correo nuevo.`;
}

// Devuelve el error del enlace (una sola vez) para que la pantalla lo enseñe.
export function takeAuthError() {
  const message = authError;
  authError = "";
  return message;
}

export async function initCloud() {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, publishableKey, {
      db: { schema },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch {
    setStatus("error", "No se pudo cargar la copia en la nube (¿sin conexión?). Tus discos siguen en este móvil.");
    return;
  }

  onHistoryChange(pushChange);
  onTokensChange(pushTokens);

  client.auth.onAuthStateChange((event, session) => {
    const wasIn = Boolean(user);
    user = session ? session.user : null;
    if (!user) {
      setStatus("off", "");
      return;
    }
    // Se sincroniza al abrir la app con sesión y al entrar; no en cada renovación del permiso.
    if (!wasIn) {
      setStatus("ok", "");
      // Fuera del aviso: Supabase pide no llamar a la base de datos dentro de onAuthStateChange.
      setTimeout(() => syncAll(), 0);
    }
  });
}

export function isCloudReady() {
  return Boolean(client);
}

export function cloudUser() {
  return user;
}

function appUrl() {
  return window.location.origin + window.location.pathname;
}

export async function sendMagicLink(email) {
  if (!client) throw new Error("La copia en la nube no está disponible ahora mismo.");
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: appUrl(), shouldCreateUser: true },
  });
  if (error) throw new Error(describeAuthError(error));
}

// Entrar con contraseña: es lo que funciona dentro de la app de la pantalla de inicio,
// porque el enlace del correo siempre se abre en Safari.
export async function signInWithPassword(email, password) {
  if (!client) throw new Error("La copia en la nube no está disponible ahora mismo.");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(describeAuthError(error));
}

// Poner o cambiar la contraseña de la cuenta (hace falta haber entrado, p. ej. con el enlace).
export async function setPassword(password) {
  if (!client || !user) throw new Error("Primero entra en tu cuenta.");
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(describeAuthError(error));
}

export async function signOut() {
  if (!client) return;
  await client.auth.signOut();
  // Los discos se quedan en el móvil; solo se olvida qué había en la nube de esta cuenta.
  localStorage.removeItem(SYNCED_KEY);
  localStorage.removeItem(PENDING_KEY);
}

function describeAuthError(error) {
  const msg = (error.message || "").toLowerCase();
  if (error.status === 429 || msg.includes("rate limit") || msg.includes("seconds")) {
    return "Supabase solo deja enviar 2 correos por hora y ya se han enviado. Espera hasta una hora, o entra con tu contraseña.";
  }
  if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
    return "Email o contraseña incorrectos. Si no recuerdas la contraseña, entra con el enlace del correo desde Safari y pon una nueva aquí, en Ajustes.";
  }
  if (msg.includes("should be different")) return "Esa ya es tu contraseña actual.";
  if (msg.includes("password") && (msg.includes("least") || msg.includes("short") || msg.includes("weak"))) {
    return "La contraseña es demasiado corta o sencilla: usa al menos 8 caracteres.";
  }
  if (msg.includes("expired") || msg.includes("invalid")) {
    return "El enlace no es válido o ha caducado. Pide un correo nuevo.";
  }
  if (msg.includes("email")) return "Revisa el email: parece que no es válido.";
  return error.message || "No se pudo entrar.";
}

// ---------- Subir cada cambio ----------

async function pushChange(change) {
  if (!client || !user) {
    // Sin sesión no hay que borrar nada de la nube luego: al entrar, la mezcla sube lo que haya.
    return;
  }
  const synced = readIds(SYNCED_KEY);
  try {
    if (change.type === "upsert") {
      const { error } = await client.from(table).upsert(toRow(change.item));
      if (error) throw error;
      synced.add(Number(change.item.release_id));
      writeIds(SYNCED_KEY, synced);
    } else if (change.type === "remove" && change.ids.length) {
      const ids = change.ids.map(Number);
      // Se apuntan antes de intentarlo: si falla, se reintenta en la próxima sincronización.
      const pending = readIds(PENDING_KEY);
      ids.forEach((id) => pending.add(id));
      writeIds(PENDING_KEY, pending);
      const { error } = await client.from(table).delete().in("release_id", ids);
      if (error) throw error;
      ids.forEach((id) => {
        pending.delete(id);
        synced.delete(id);
      });
      writeIds(PENDING_KEY, pending);
      writeIds(SYNCED_KEY, synced);
    }
    setStatus("ok", `☁️ Guardado en la nube · ${timeLabel()}`);
  } catch {
    setStatus("error", "☁️ Sin conexión con la nube: se subirá la próxima vez que abras la app.");
  }
}

// ---------- Fichas y precios guardados (los usa details.js) ----------

// Devuelve { data, data_at, prices, prices_at } o null (sin cuenta o sin nada guardado).
export async function loadDetail(releaseId) {
  if (!client || !user) return null;
  const { data, error } = await client
    .from(detailsTable)
    .select("data, data_at, prices, prices_at")
    .eq("release_id", Number(releaseId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Resumen de todas las fichas guardadas de esta cuenta, de una vez (para la pestaña «Datos»).
// Solo se piden los campos que hacen falta, no la ficha entera. null sin cuenta.
export async function loadDetailSummaries() {
  if (!client || !user) return null;
  const { data, error } = await client
    .from(detailsTable)
    .select(
      "release_id, data_at, prices, prices_at, genres:data->genres, styles:data->styles, country:data->>country, " +
        "labels:data->labels, formats:data->formats, community:data->community, originalYear:data->>originalYear"
    );
  if (error) throw error;
  return data;
}

// fields: solo las columnas que cambian (data y data_at, o prices y prices_at).
export async function saveDetail(releaseId, fields) {
  if (!client || !user) return;
  const { error } = await client.from(detailsTable).upsert({ user_id: user.id, release_id: Number(releaseId), ...fields });
  if (error) throw error;
}

// ---------- Llaves ----------

function tokensRow(state) {
  return {
    user_id: user.id,
    ai_key: state.aiKey,
    discogs_token: state.discogsToken,
    ai_verified: state.aiVerified,
    discogs_verified: state.discogsVerified,
  };
}

async function pushTokens(state) {
  if (!client || !user) return;
  const { error } = await client.from(settingsTable).upsert(tokensRow(state));
  if (error) setStatus("error", "☁️ No se pudieron guardar las llaves en la nube; se reintentará al abrir la app.");
}

// Cada llave por separado: si el móvil tiene una, manda la del móvil; si no la tiene, se usa la de la nube.
async function syncTokens() {
  const { data, error } = await client.from(settingsTable).select("*").maybeSingle();
  if (error) throw error;
  const local = getTokenState();
  const merged = { ...local };
  if (data) {
    if (!local.aiKey && data.ai_key) {
      merged.aiKey = data.ai_key;
      merged.aiVerified = data.ai_verified;
    }
    if (!local.discogsToken && data.discogs_token) {
      merged.discogsToken = data.discogs_token;
      merged.discogsVerified = data.discogs_verified;
    }
  }
  const changedHere = JSON.stringify(merged) !== JSON.stringify(local);
  if (changedHere) {
    applyTokenState(merged);
    for (const cb of tokenListeners) cb();
  }
  const row = tokensRow(merged);
  const sameThere =
    data &&
    data.ai_key === row.ai_key &&
    data.discogs_token === row.discogs_token &&
    data.ai_verified === row.ai_verified &&
    data.discogs_verified === row.discogs_verified;
  if (!sameThere && (row.ai_key || row.discogs_token || data)) {
    const { error: upsertError } = await client.from(settingsTable).upsert(row);
    if (upsertError) throw upsertError;
  }
}

// ---------- Sincronización completa ----------

export function syncAll() {
  if (!client || !user) return Promise.resolve();
  if (!syncing) syncing = runSync().finally(() => (syncing = null));
  return syncing;
}

async function runSync() {
  setStatus("busy", "☁️ Sincronizando…");
  try {
    // 0. Llaves (lo primero: en un móvil nuevo es lo que permite empezar a usar la app).
    await syncTokens();

    // 1. Borrados que no llegaron a la nube.
    const pending = readIds(PENDING_KEY);
    if (pending.size) {
      const { error } = await client.from(table).delete().in("release_id", [...pending]);
      if (error) throw error;
      writeIds(PENDING_KEY, new Set());
    }

    // 2. Lo que hay en la nube (las reglas RLS ya filtran: solo llegan los discos de esta cuenta).
    const { data, error } = await client.from(table).select("*");
    if (error) throw error;
    const remote = new Map(data.map((row) => [Number(row.release_id), fromRow(row)]));

    // 3. Mezcla. Un disco que está aquí, no está allí y ya se había subido antes → se borró en otro
    //    dispositivo, así que también se quita de aquí. Si nunca se subió, es nuevo y se sube.
    const synced = readIds(SYNCED_KEY);
    const merged = [];
    const seen = new Set();
    for (const local of getHistory()) {
      const id = Number(local.release_id);
      seen.add(id);
      if (remote.has(id)) merged.push(mergeItem(local, remote.get(id)));
      else if (!synced.has(id)) merged.push(local);
    }
    for (const [id, item] of remote) if (!seen.has(id)) merged.push(item);
    merged.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

    // 4. Se sube todo lo mezclado (pocas filas; así la nube queda igual que el móvil).
    if (merged.length) {
      const { error: upsertError } = await client.from(table).upsert(merged.map(toRow));
      if (upsertError) throw upsertError;
    }

    const before = JSON.stringify(getHistory());
    replaceHistory(merged);
    writeIds(SYNCED_KEY, new Set(merged.map((item) => Number(item.release_id))));
    if (JSON.stringify(merged) !== before) for (const cb of changeListeners) cb();

    setStatus("ok", `☁️ Sincronizado · ${merged.length} ${merged.length === 1 ? "disco" : "discos"} · ${timeLabel()}`);
  } catch {
    setStatus("error", "☁️ No se pudo sincronizar ahora. Tus discos siguen en este móvil; se reintentará.");
  }
}
