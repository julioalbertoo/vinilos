// Lector propio del navegador si existe (Chrome Android); si no, zxing-cpp compilado a WebAssembly
// (zxing-wasm) desde CDN, más robusto que ZXing para JS con fotos reales y códigos girados.
const ZXING_WASM_BASE = "https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/";
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const ZXING_FORMATS = ["EAN13", "EAN8", "UPCA", "UPCE"];
// Sin pedir resolución, Safari abre la cámara a 640×480 y las barras quedan demasiado finas.
const CAMERA = {
  video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};
const SCAN_INTERVAL_MS = 150;
// Recorte de la zona central: con códigos difíciles, quitar el entorno ayuda más que la resolución.
const CENTER_CROP = { width: 0.7, height: 0.5 };

let zxingLoading = null;

function loadZxing() {
  if (!zxingLoading) {
    zxingLoading = import(`${ZXING_WASM_BASE}es/reader/index.js`)
      .then((zxing) => {
        zxing.setZXingModuleOverrides({
          locateFile: (path, prefix) => (path.endsWith(".wasm") ? `${ZXING_WASM_BASE}reader/${path}` : prefix + path),
        });
        return zxing;
      })
      .catch(() => {
        zxingLoading = null;
        throw new Error("No se pudo cargar el lector de códigos de barras. Comprueba tu conexión.");
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

function invertCanvas(ctx, width, height) {
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255 - pixels[i];
    pixels[i + 1] = 255 - pixels[i + 1];
    pixels[i + 2] = 255 - pixels[i + 2];
  }
  ctx.putImageData(image, 0, 0);
}

// Devuelve decode(video, frameNumber) → texto del código o null, alternando variantes del fotograma.
async function createDecoder() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const detector = await createNativeDetector();
  if (detector) {
    // No consta que el lector nativo entienda códigos en negativo: un fotograma de cada dos va invertido.
    return async (video, frame) => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      if (frame % 2 === 1) invertCanvas(ctx, canvas.width, canvas.height);
      const codes = await detector.detect(canvas);
      return codes.length ? codes[0].rawValue : null;
    };
  }

  const zxing = await loadZxing();
  const options = { formats: ZXING_FORMATS, maxNumberOfSymbols: 1 };
  // Ciclo de 4 variantes: completo, completo invertido, centro, centro invertido.
  // La opción tryInvert de zxing-cpp no basta con códigos claros sobre fondo oscuro; invertir a mano sí.
  return async (video, frame) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const variant = frame % 4;
    if (variant < 2) {
      canvas.width = vw;
      canvas.height = vh;
      ctx.drawImage(video, 0, 0);
    } else {
      canvas.width = Math.round(vw * CENTER_CROP.width);
      canvas.height = Math.round(vh * CENTER_CROP.height);
      ctx.drawImage(video, (vw - canvas.width) / 2, (vh - canvas.height) / 2, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    }
    if (variant % 2 === 1) invertCanvas(ctx, canvas.width, canvas.height);
    const results = await zxing.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), options);
    return results.length ? results[0].text : null;
  };
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

// Arranca la cámara en `video` y llama a onCode(código) con el primer código leído,
// o a onFatal(error) si el lector falla. Devuelve una función que apaga la cámara.
export async function startScanner(video, onCode, onFatal) {
  const decode = await createDecoder();
  const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
  video.srcObject = stream;
  await video.play();

  let running = true;
  let frame = 0;
  const tick = async () => {
    if (!running) return;
    if (video.videoWidth) {
      try {
        const code = await decode(video, frame++);
        if (code && running) {
          running = false;
          onCode(normalizeBarcode(code));
          return;
        }
      } catch (err) {
        if (running) {
          running = false;
          onFatal(err);
        }
        return;
      }
    }
    setTimeout(tick, SCAN_INTERVAL_MS);
  };
  tick();

  return () => {
    running = false;
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
}
