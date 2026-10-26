// Comprueba si hay una versión nueva publicada y recarga la app para usarla.
// Hace falta porque la app de la pantalla de inicio de iPhone a veces se queda
// «dormida» con la versión vieja en memoria y no vuelve a pedir la página.

const LAST_CHECK_KEY = "vinilos_update_check";
const AWAY_MS = 30 * 60 * 1000; // al volver tras 30 min fuera, se comprueba
const DAY_MS = 24 * 60 * 60 * 1000; // y como mínimo una vez al día

export function currentVersion() {
  return (document.querySelector(".app-version")?.textContent || "").trim().replace(/^v/, "");
}

// Pide la página sin caché y lee el número de versión de su cabecera.
export async function latestVersion() {
  const response = await fetch(`./?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const match = (await response.text()).match(/class="app-version">\s*v([\d.]+)/);
  if (!match) throw new Error("No encuentro la versión en la página");
  return match[1];
}

// Recarga con una dirección nueva para que Safari no use la página guardada.
export function reloadTo(version) {
  window.location.replace(`${window.location.pathname}?v=${encodeURIComponent(version)}`);
}

function rememberCheck() {
  try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch {}
}

function lastCheck() {
  try { return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0; } catch { return 0; }
}

// isSafeToReload: dice si recargar ahora no hace perder nada (p. ej. una foto a medias).
export function initAutoUpdate(isSafeToReload) {
  let pending = null; // versión nueva encontrada pero aún sin aplicar
  let hiddenAt = 0;

  async function check() {
    if (!navigator.onLine) return;
    try {
      const latest = pending || await latestVersion();
      rememberCheck();
      if (latest === currentVersion()) return;
      pending = latest;
      if (isSafeToReload()) reloadTo(latest);
    } catch {
      // Sin red o fallo puntual: se reintenta la próxima vez.
    }
  }

  // Al abrir, tras unos segundos (deja terminar el enlace de entrar a la nube).
  setTimeout(check, 4000);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    if (pending || away >= AWAY_MS || Date.now() - lastCheck() >= DAY_MS) check();
  });

  // Por si la app se queda abierta y en primer plano mucho tiempo.
  setInterval(() => {
    if (!document.hidden && Date.now() - lastCheck() >= DAY_MS) check();
  }, 60 * 60 * 1000);
}
