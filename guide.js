export const GUIDE_TEXT = {
  intro: {
    title: "Bienvenido 👋",
    body:
      "Esta web identifica tus discos de vinilo a partir de una foto o un código de barras, y te dice la versión exacta en Discogs.\n\n" +
      "Para eso hacen falta dos llaves, como el carné de socio de dos bibliotecas: una para la IA que \"lee\" la foto (Google Gemini) y otra para buscar el disco exacto (Discogs). Cada llave es tuya; la usamos en tu nombre y se queda guardada en este navegador (y en tu copia en la nube, si entras con tu email).",
    nextLabel: "Empezar →",
  },
  ai: {
    title: "🔑 Llave de Google Gemini",
    steps: [
      "Abre Google AI Studio (botón de abajo) e inicia sesión con tu cuenta de Google.",
      "Si te lo pide, acepta las condiciones de uso.",
      'Pulsa "Create API key" (Crear clave de API). Si te pregunta por un proyecto, acepta el que te propone.',
      "Copia la clave que aparece. Empieza por AIza. Es gratis y no pide tarjeta.",
    ],
    linkLabel: "Abrir Google AI Studio",
    linkUrl: "https://aistudio.google.com/apikey",
    pasteLabel: "Pega aquí tu llave de Google Gemini",
    placeholder: "AIza...",
    formatHint: "Las llaves de Google Gemini empiezan por AIza. Revisa que la copiaste entera.",
    saveLabel: "Guardar y continuar",
  },
  discogs: {
    title: "🔑 Llave de Discogs",
    steps: [
      "Abre la página de desarrolladores de Discogs (botón de abajo).",
      "Pulsa Generate new token.",
      "Cópialo.",
    ],
    linkLabel: "Abrir página para crear el token de Discogs",
    linkUrl: "https://www.discogs.com/settings/developers",
    pasteLabel: "Pega aquí tu token de Discogs",
    placeholder: "Tu token personal de Discogs",
    saveLabel: "Guardar y terminar",
  },
  privacyNotice:
    "🔒 Tus llaves se guardan en este navegador (y en tu copia en la nube, si entras con tu email). No las compartas ni hagas capturas de esta pantalla.",
  reopenLinkLabel: "¿Cómo consigo mis llaves?",
};

export function isValidAiKeyFormat(value) {
  return /^AIza/.test((value || "").trim());
}
