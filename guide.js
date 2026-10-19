export const GUIDE_TEXT = {
  intro: {
    title: "Bienvenido 👋",
    body:
      "Esta web identifica tus discos de vinilo a partir de una foto o un código de barras, y te dice la versión exacta en Discogs.\n\n" +
      "Para eso hacen falta dos llaves, como el carné de socio de dos bibliotecas: una para la IA que \"lee\" la foto (GitHub) y otra para buscar el disco exacto (Discogs). Cada llave es tuya; la usamos en tu nombre y se queda guardada solo en este navegador.",
    nextLabel: "Empezar →",
  },
  github: {
    title: "🔑 Llave de GitHub",
    steps: [
      "Abre la página para crear el token (botón de abajo).",
      'En "Token name" pon, por ejemplo, vinilos-web.',
      'En "Expiration" elige 90 days.',
      'En "Repository access" deja la opción mínima (no hace falta ningún repositorio).',
      'En "Permissions" busca Models y ponlo en Read-only. No actives nada más.',
      "Pulsa Generate token y cópialo al momento: solo se ve una vez. Empieza por github_pat_.",
    ],
    linkLabel: "Abrir página para crear el token de GitHub",
    linkUrl: "https://github.com/settings/personal-access-tokens/new",
    pasteLabel: "Pega aquí tu token de GitHub",
    placeholder: "github_pat_...",
    formatHint: "Los tokens fine-grained de GitHub empiezan por github_pat_. Revisa que lo copiaste entero.",
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
    "🔒 Tus llaves se guardan solo en este navegador. No las compartas ni hagas capturas de esta pantalla.",
  reopenLinkLabel: "¿Cómo consigo mis llaves?",
};

export function isValidGithubTokenFormat(value) {
  return /^github_pat_/.test((value || "").trim());
}
