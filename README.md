# 🎵 Vinilos

Una web para el móvil que identifica un disco de vinilo y te dice **qué edición exacta** es en [Discogs](https://www.discogs.com).
Le haces una foto (o escaneas el código de barras), una IA lee las pistas que se ven en el disco y la web busca en Discogs las ediciones que mejor encajan. Tú eliges la tuya y queda guardada en tu historial.

Web publicada: **https://julioalbertoo.github.io/vinilos/**

---

## Cómo se usa

En la pestaña **📷 Identificar** tienes tres caminos, de más a menos preciso:

| Camino | Cuándo usarlo |
|---|---|
| **▦ Código de barras** | Si la contraportada tiene código. Es el más rápido y exacto: va directo a la edición. |
| **📷 Hacer foto** / **🖼️ Galería** | Portada, contraportada, lomo o galleta central. Se identifica sola nada más subir la foto, sin pulsar nada más. La IA lee artista, título, sello, número de catálogo y también los números del código de barras. |
| **Ninguno es** (en los resultados) | Si ningún candidato es el tuyo: escribe artista y título, o el número de catálogo. |

En cada candidato verás qué pistas coinciden (✓ sello, ✓ año, ✓ código de barras…). Si ya tienes esa edición en **💿 Mis discos**, sale marcada con **💿 Ya lo tienes**, para no comprarla repetida. Pulsa **✓ Es este** en el tuyo: se abre su ficha (canciones, sello, color del vinilo si Discogs lo tiene) con un botón **🎧 Escuchar en Spotify** que abre el álbum en la app y se guarda en **💿 Mis discos**.

En **💿 Mis discos** tienes tres formas de verlos:

- **Galería** (la de inicio): deslizas en horizontal y el disco del centro sale de su funda y gira. Púlsalo otra vez para abrir su ficha. La galleta del centro es la de verdad: la IA busca su foto entre las de la edición en Discogs (una consulta por disco, solo la primera vez). Si Discogs no tiene foto de la galleta, sale una genérica con el título y el artista. Si la edición es de vinilo de color (según Discogs), el disco gira de ese color: translúcido, jaspeado o con salpicaduras incluidos.
- **Cuadrícula**: todas las portadas de un vistazo; aquí puedes borrar discos (✕).
- **Datos**: arriba, una barra con accesos a cada bloque que se queda fija al bajar y marca dónde estás, y cuatro cifras (discos, artistas, países y horas de música). Después, el valor estimado de tu colección (precio sugerido de Discogs para estado VG+, o el más barato a la venta) con un podio de los tres más valiosos; los géneros dibujados como un vinilo; cuánto dura tu colección, comparado con algo conocido («como un vuelo de Madrid a Tokio»); cuánto pesa y mide tu pila de discos («2,5 veces un gato»), dibujada con el color de cada portada; un mapa de casillas de años al estilo GitHub, cuántos son ediciones del año del álbum y cuántos reediciones, y la edad media de tu música; y una línea del tiempo con las portadas; tus portadas ordenadas por colores y tus vinilos de color girando; un mapa del mundo con dónde se editaron (con zoom a Europa); rareza y nota según la comunidad de Discogs (nota media, cuánta gente los tiene, los que más se buscan); los artistas y sellos que más se repiten; récords curiosos (el más ecléctico, la reedición más tardía…) y un calendario de cuándo añadiste cada disco. Al tocar un género, un año, un país, un artista o un sello salen sus portadas, y cada portada abre su ficha. Lo que falta se pide a Discogs poco a poco mientras la pestaña está abierta; con la cuenta en la nube, casi todo sale de ahí de golpe. El color de cada portada se calcula en el propio móvil.

**📊 Cupo de Gemini** (en Ajustes): una fila por cada modelo de Gemini de tu llave, con lo que ha gastado hoy este móvil (y cuántas con búsqueda de Google) y lo último que dijo Google: disponible, sin cupo por minuto o sin cupo diario hasta qué hora, con su límite. Google no deja consultar el cupo restante, solo avisa al agotarse; **🔄 Comprobar ahora** hace una pregunta mínima a cada modelo (gasta una consulta en los que responden). Los cupos diarios se renuevan a medianoche de California.

**⭐ Lo que busco**: en la discografía de un artista, toca ☆ junto a un álbum que no tengas para apuntarlo (o ★ para quitarlo); también desde la ficha de un disco que no tienes, con **☆ Añadir a lo que busco**. La lista se abre con el enlace discreto **⭐ Lo que busco** al final de **💿 Mis discos**; cada álbum abre su ficha, y al guardarlo en tus discos sale solo de la lista. Se guarda en este móvil.

**💡 ¿Sabías que…?**: en la ficha de cada disco sale un dato curioso del álbum, de esa edición en vinilo o de una de sus canciones (cada vez de un tema al azar). Lo busca Gemini en Google y solo se enseña si las páginas encontradas lo respaldan, con enlaces a esas fuentes; si no, no sale nada inventado. Si la búsqueda de Google se queda sin cupo, se prueban todos los modelos de Gemini de tu llave; si ninguno tiene, el dato sale de un artículo de Wikipedia del disco o de una canción, y solo si la frase que lo prueba está tal cual en el artículo (el enlace lleva justo a esa frase). Cada vez que abres la ficha, o pulsas **🔄 Otro dato**, sale uno nuevo: el móvil recuerda los ya vistos para no repetirlos. Gasta una consulta de Gemini cada vez.

**🎤 Ficha del artista**: toca la cifra de **artistas** en Datos (sale la lista de todos tus artistas) o el botón con su nombre en la ficha de un disco. Verás su foto y biografía de Discogs, tus discos suyos, su discografía (de [MusicBrainz](https://musicbrainz.org), la base de datos musical abierta, que dice qué es cada disco; si no conoce al artista, de Discogs) con los que ya tienes marcados (de inicio solo los LP; con los botones de arriba ves sus directos, singles, EP, recopilatorios, piratas (bootlegs) u otros; los que no tienes se abren sin guardarse) y los miembros del grupo o los grupos en los que ha estado, que también abren su ficha. Lo que llega de Discogs se guarda en el móvil 30 días.

### ☁️ Copia en la nube (opcional)

En **⚙️ Ajustes → Copia en la nube** entra con tu **email y contraseña**. Al entrar, tus discos **y tus llaves** se guardan también en la nube: si cambias de móvil o el navegador borra los datos, no los pierdes. En un móvil nuevo, pulsa en la bienvenida **☁️ Ya uso Vinilos en otro móvil**, entra y lo recuperas todo sin volver a pegar las llaves.

- **¿Sin contraseña?** Abre la web en Safari, pulsa **✉️ Enviarme un enlace para entrar** y abre el enlace del correo (sirve una sola vez). Ya dentro, en el mismo panel, pon una contraseña. Luego úsala en la app de la pantalla de inicio: el enlace del correo siempre se abre en Safari, no en la app.
- Sin cuenta, la app funciona igual que siempre.
- Si una llave ya está en el móvil, manda la del móvil; la de la nube solo se usa cuando aquí falta.
- Con la cuenta abierta, la ficha de cada disco (canciones, sellos, notas, enlaces de las fotos) también se guarda en la nube y sale de ahí al abrirla, sin preguntar a Discogs. Se renueva cada 30 días. Los precios se piden a Discogs como mucho una vez por semana; en la ficha pone de cuándo son. Junto al precio de tu edición sale el de **cualquier edición en vinilo** del álbum: la más barata a la venta entre sus 10 ediciones más comunes (Discogs da los precios de uno en uno, así que tarda unos segundos la primera vez y se guarda una semana). Debajo del precio hay dos botones que abren Discogs con lo que se vende desde España, del más barato al más caro y solo con disco y portada en estado G o mejor: esa edición, o cualquier edición en vinilo del álbum (Discogs no deja ver esos precios desde la app, solo en su web).

**Truco para afinar la edición:** la portada suele ser igual en todas las ediciones. La contraportada y la galleta central traen el sello y el número de catálogo, que son los que distinguen una edición de otra.

---

## Antes de empezar: las dos llaves

La web necesita dos llaves, como el carné de socio de dos bibliotecas: una para la IA que "lee" la foto (Google Gemini) y otra para buscar el disco (Discogs). Son tuyas, gratuitas, y **se guardan en tu navegador**: nunca se suben a este repositorio. Solo si entras en la copia en la nube se guardan también en tu cuenta de Supabase, donde únicamente tu cuenta puede leerlas.

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
3. Ábrela desde el nuevo icono y **vuelve a pegar las dos llaves una vez** (o entra en la copia en la nube con tu email y contraseña): la app de la pantalla de inicio guarda sus datos aparte de Safari.

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
| "Ese enlace ya se usó o caducó" | Cada enlace del correo sirve una sola vez: si lo abriste antes en otro navegador (Safari, Gmail…), allí ya estás dentro. Para entrar en la app, usa tu email y contraseña en **⚙️ Ajustes → Copia en la nube** (si no tienes, ponla desde Safari tras entrar con el enlace). |
| No ves cambios recientes | Comprueba la versión bajo el título y recarga la página. |

---

## Publicar tu propia copia (GitHub Pages)

Si quieres montarla en tu cuenta:

1. Haz un *fork* de este repositorio (o sube estos archivos a uno tuyo).
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`. Pulsa **Save**.
4. En un minuto tendrás la web en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

No hace falta servidor ni instalar nada: son archivos HTML, CSS y JavaScript. La copia en la nube usa un proyecto de [Supabase](https://supabase.com) (dirección y clave pública en `config.js`); en tu copia puedes cambiarlos por los de tu proyecto o dejarla sin usar.

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
| `tokens.js` | Guarda y comprueba las llaves (en el navegador). Avisa de cada cambio para que se suba a la nube. |
| `history.js` | Historial de discos confirmados (en el navegador). Avisa de cada cambio para que se suba a la nube. |
| `quota.js` | Cupo de Gemini por modelo para Ajustes: consultas de hoy en este móvil y lo que dijo Google al agotarse. |
| `wantlist.js` | «Lo que busco»: álbumes que quieres conseguir, guardados en el móvil. |
| `trivia.js` | «¿Sabías que…?» de la ficha: dato curioso buscado por Gemini con Google; solo se enseña si viene respaldado por páginas, con sus enlaces. |
| `details.js` | Fichas y precios guardados en la nube (tabla `vinilos.details`): la ficha se reutiliza 30 días y los precios 7. Sin cuenta, se pregunta a Discogs como siempre. |
| `cloud.js` | Copia en la nube con Supabase: entrada por email, sube cada cambio y mezcla lo del móvil con lo de la nube. Los discos van en la tabla `vinilos.records` y las llaves en `vinilos.settings`; cada cuenta solo ve lo suyo (reglas RLS). |
| `gallery.js` | Galería horizontal: el disco del centro sale de la funda y gira. |
| `labels.js` | Busca en segundo plano la foto de la galleta de cada disco guardado y la recorta. Como Discogs no deja que una web lea sus fotos, las descarga a través de [wsrv.nl](https://wsrv.nl), que solo recibe el enlace público de cada foto. |
| `guide.js` | Textos de la guía de bienvenida: si cambian los menús de Google o Discogs, se edita solo aquí. |

**Versiones:** cada publicación sube el número de versión en `index.html`, que también se añade a las direcciones de los archivos (`app.js?v=1.0.0`). Así el móvil descarga siempre la versión nueva en vez de una copia antigua guardada.

### Próximamente (v2)

- Añadir el disco confirmado a tu colección de Discogs. El historial ya guarda el `release_id` de cada edición, que es la clave para hacerlo.
- Entrar con tu cuenta de Discogs en lugar de pegar un token.
