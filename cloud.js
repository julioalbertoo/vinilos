// Copia en la nube de «Mis discos» (Supabase). Lo que se pinta en pantalla sigue saliendo del móvil
// (history.js); esto solo sube los cambios y, al entrar o al abrir la app, mezcla lo de aquí con lo de allí.
// Si la librería no carga o no hay red, la app funciona igual que sin cuenta.
import { CONFIG } from "./config.js";
import { getHistory, onHistoryChange, replaceHistory } from "./history.js";

const { url, publishableKey, schema, table } = CONFIG.SUPABASE;
const SYNCED_KEY = CONFIG.STORAGE_KEYS.cloudSynced;
const PENDING_KEY = CONFIG.STORAGE_KEYS.cloudPendingDeletes;

let client = null;
let user = null;
let syncing = null;
const statusListeners = [];
const changeListeners = [];

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
  return item;
}

// Si un disco está en los dos sitios, manda lo del móvil, pero se aprovecha lo que solo tenga la nube
// (por ejemplo, la galleta que ya buscó la IA en otro dispositivo).
function mergeItem(local, remote) {
  const merged = { ...remote, ...local };
  for (const field of ["artist", "title", "year", "thumb", "cover", "label"]) {
    if (!local[field] && remote[field]) merged[field] = remote[field];
  }
  return merged;
}

// ---------- Arranque y sesión ----------

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

export async function verifyCode(email, code) {
  if (!client) throw new Error("La copia en la nube no está disponible ahora mismo.");
  const { error } = await client.auth.verifyOtp({ email, token: code, type: "email" });
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
    return "Has pedido varios correos seguidos. Espera un minuto y vuelve a probar.";
  }
  if (msg.includes("expired") || msg.includes("invalid")) {
    return "El código no es válido o ha caducado. Pide un correo nuevo.";
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

// ---------- Sincronización completa ----------

export function syncAll() {
  if (!client || !user) return Promise.resolve();
  if (!syncing) syncing = runSync().finally(() => (syncing = null));
  return syncing;
}

async function runSync() {
  setStatus("busy", "☁️ Sincronizando…");
  try {
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
