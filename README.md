# 🎵 Vinilos

Una web para el móvil que identifica un disco de vinilo y te dice **qué edición exacta** es en [Discogs](https://www.discogs.com).
Le haces una foto (o escaneas el código de barras), una IA lee las pistas que se ven en el disco y la web busca en Discogs las ediciones que mejor encajan. Tú eliges la tuya y queda guardada en tu historial.

Web publicada: **https://julioalbertoo.github.io/vinilos/**

---

## Cómo se usa

En la pestaña **📷 Identificar** tienes tres caminos, de más a menos preciso:

| Camino | Cuándo usarlo |
|---|---|
| **▦ Escanear código de barras** | Si la contraportada tiene código. Es el más rápido y exacto: va directo a la edición. |
| **📷 Hacer foto** / **🖼️ Elegir de galería** | Portada, contraportada, lomo o galleta central. La IA lee artista, título, sello, número de catálogo y también los números del código de barras. |
| **Ninguno es** (en los resultados) | Si ningún candidato es el tuyo: escribe artista y título, o el número de catálogo. |

En cada candidato verás qué pistas coinciden (✓ sello, ✓ año, ✓ código de barras…). Pulsa **✓ Es este** en el tuyo: se abre su ficha (canciones, sello, color del vinilo si Discogs lo tiene) y se guarda en **🗂️ Historial**.

**Truco para afinar la edición:** la portada suele ser igual en todas las ediciones. La contraportada y la galleta central traen el sello y el número de catálogo, que son los que distinguen una edición de otra.

---

## Antes de empezar: las dos llaves

La web necesita dos llaves, como el carné de socio de dos bibliotecas: una para la IA que "lee" la foto (Google Gemini) y otra para buscar el disco (Discogs). Son tuyas, gratuitas, y **se guardan solo en tu navegador**: nunca se suben a este repositorio ni a ningún servidor propio.

La primera vez que abres la web, una guía de bienvenida te lleva paso a paso. Aquí están los mismos pasos por si los quieres tener a mano.

### 1. Llave de Google Gemini (para leer la foto)

1. Abre [Google AI Studio](https://aistudio.google.com/apikey) e inicia sesión con tu cuenta de Google.
2. Si te lo pide, acepta las condiciones de uso.
3. Pulsa **Create API key** (Crear clave de API). Si te pregunta por un proyecto, acepta el que te propone.
4. Copia la clave: empieza por `AIza`. Es gratis y no pide tarjeta.

> El plan gratuito tiene un cupo diario que da de sobra para uso personal. En ese plan, Google puede usar lo que le envías para mejorar sus productos (aquí, fotos de portadas).

### 2. Token de Discogs (para buscar el disco)

1. Abre [discogs.com/settings/developers](https://www.discogs.com/settings/developers) con tu cuenta de Discogs.
2. Pulsa **Generate new token** y cópialo.

### 3. Pegarlas y comprobarlas

Pega cada llave en la guía (o en **⚙️ Ajustes**) y pulsa **Probar conexión** en las dos. Con las dos en ✅, la web abrirá directamente en Identificar.

---

## Usarla en el móvil

1. Abre la web en **Safari** (iPhone) o **Chrome** (Android).
2. Recomendado: **añádela a la pantalla de inicio** para tenerla como una app.
   - iPhone: botón Compartir → **Añadir a pantalla de inicio**.
   - Android: menú ⋮ → **Añadir a pantalla de inicio** (o **Instalar app**).
3. Ábrela desde el nuevo icono y **vuelve a pegar las dos llaves una vez**: la app de la pantalla de inicio guarda sus datos aparte de Safari.

¿Por qué merece la pena? Safari puede borrar los datos guardados de una web si pasas un tiempo sin abrirla (llaves e historial). Las apps de la pantalla de inicio no tienen ese límite.

Debajo del título verás la versión (por ejemplo `v1.0.0`). Sirve para comprobar que tienes la última.

---

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| "La llave de Google Gemini no es válida" / "El token de Discogs no es válido" | Pulsa **Revisar mis llaves en Ajustes**, vuelve a copiarla entera y prueba la conexión. |
| "Se ha agotado el cupo gratuito de Gemini" | Espera un rato (el cupo se renueva) o usa el escáner de código de barras, que no gasta cupo de IA. |
| "No encontré este disco en Discogs" | Fotografía la contraportada o la galleta central, escanea el código, o usa **Ninguno es** para buscar escribiendo. |
| El escáner no lee el código | Acerca el móvil hasta que el código ocupe casi todo el ancho del visor e inclina el disco para quitar reflejos. A los pocos segundos aparece **📷 Leer el número con una foto**. |
| "No hay permiso para usar la cámara" | Activa la cámara para esta web en los ajustes del navegador. |
| No ves cambios recientes | Comprueba la versión bajo el título y recarga la página. |

---

## Publicar tu propia copia (GitHub Pages)

Si quieres montarla en tu cuenta:

1. Haz un *fork* de este repositorio (o sube estos archivos a uno tuyo).
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`. Pulsa **Save**.
4. En un minuto tendrás la web en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

No hace falta servidor, base de datos ni instalar nada: son archivos HTML, CSS y JavaScript.

---

## Cómo está hecha

Web estática (HTML + CSS + JavaScript sin frameworks) que habla directamente desde el navegador con Google Gemini y con Discogs.

| Archivo | Qué hace |
|---|---|
| `index.html` | Todas las pantallas. También guarda el número de versión. |
| `styles.css` | Estilos, pensados primero para el móvil. |
| `app.js` | El "director de orquesta": navegación y flujo foto → IA → Discogs → historial. |
| `config.js` | Único sitio con direcciones, modelos de IA y nombres de lo que se guarda. |
| `ai.js` | La IA: `identify(imagen)` devuelve las pistas del disco. Para cambiar de proveedor se toca solo este archivo y `config.js`. |
| `discogs.js` | Búsquedas en Discogs (código de barras → nº de catálogo → artista y título) y ficha de cada edición. |
| `scoring.js` | Puntúa cada edición según las pistas que coinciden. |
| `barcode.js` | Escáner: lector del navegador si existe; si no, [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 desde jsDelivr. |
| `imaging.js` | Reduce la foto (lado largo ~1024 px) antes de enviarla a la IA. |
| `tokens.js` | Guarda y comprueba las llaves (en el navegador). |
| `history.js` | Historial de discos confirmados (en el navegador). |
| `guide.js` | Textos de la guía de bienvenida: si cambian los menús de Google o Discogs, se edita solo aquí. |

**Versiones:** cada publicación sube el número de versión en `index.html`, que también se añade a las direcciones de los archivos (`app.js?v=1.0.0`). Así el móvil descarga siempre la versión nueva en vez de una copia antigua guardada.

### Próximamente (v2)

- Añadir el disco confirmado a tu colección de Discogs. El historial ya guarda el `release_id` de cada edición, que es la clave para hacerlo.
- Entrar con tu cuenta de Discogs en lugar de pegar un token.
