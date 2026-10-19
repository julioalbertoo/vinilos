// Lector propio del navegador si existe (Chrome Android); si no, ZXing desde CDN (iPhone).
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js";
const ZXING_SRI = "sha384-HRtzk9lZgkbSgvUyQrnfC/GxiXZgwaNyD7hC9wcXlsBpDhkS80ISl73juef2FRuf";
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
// Sin pedir resolución, Safari abre la cámara a 640×480 y las barras quedan demasiado finas.
const CAMERA = {
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};
const NATIVE_SCAN_INTERVAL_MS = 200;
// Valores de los enums DecodeHintType de @zxing/library, que el paquete del navegador no exporta.
const HINT_POSSIBLE_FORMATS = 2;
const HINT_TRY_HARDER = 3;

let zxingLoading = null;

function loadZxing() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = ZXING_URL;
      script.integrity = ZXING_SRI;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.ZXingBrowser);
      script.onerror = () => {
        zxingLoading = null;
        script.remove();
        reject(new Error("No se pudo cargar el lector de códigos de barras. Comprueba tu conexión."));
      };
      document.head.append(script);
    });
  }
  return zxingLoading;
}

async function createNativeDetector() {
  if (!("BarcodeDetector" in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

// Un UPC-A (12 cifras) leído como EAN-13 llega con un 0 delante; Discogs lo guarda sin él.
function normalizeBarcode(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  return /^0\d{12}$/.test(digits) ? digits.slice(1) : digits;
}

export function describeCameraError(err) {
  if (err && err.name === "NotAllowedError") {
    return "No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para esta web y vuelve a intentarlo.";
  }
  if (err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")) {
    return "No se encontró ninguna cámara en este dispositivo.";
  }
  return (err && err.message) || "No se pudo abrir la cámara.";
}

// Arranca la cámara en `video` y llama a onCode(código) con el primer código leído.
// Devuelve una función que apaga la cámara.
export async function startScanner(video, onCode) {
  const detector = await createNativeDetector();
  if (detector) {
    const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
    video.srcObject = stream;
    await video.play();
    let running = true;
    const tick = async () => {
      if (!running) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length && running) {
          onCode(normalizeBarcode(codes[0].rawValue));
          return;
        }
      } catch {
        // El fotograma aún no está listo; se reintenta en el siguiente ciclo.
      }
      setTimeout(tick, NATIVE_SCAN_INTERVAL_MS);
    };
    tick();
    return () => {
      running = false;
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }

  const ZXing = await loadZxing();
  const formats = ZXing.BarcodeFormat;
  const hints = new Map([
    [HINT_POSSIBLE_FORMATS, [formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E]],
    [HINT_TRY_HARDER, true],
  ]);
  const reader = new ZXing.BrowserMultiFormatOneDReader(hints, { delayBetweenScanAttempts: 150 });
  let found = false;
  const controls = await reader.decodeFromConstraints(CAMERA, video, (result) => {
    if (result && !found) {
      found = true;
      onCode(normalizeBarcode(result.getText()));
    }
  });
  return () => controls.stop();
}
