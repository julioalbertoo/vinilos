# 🎵 Vinilos

Una web para el móvil que identifica un disco de vinilo, te dice **qué edición exacta** es en [Discogs](https://www.discogs.com) y lleva tu colección: galería con los discos girando, fichas completas, estadísticas, lista de deseos y copia en la nube.

Le haces una foto (o escaneas el código de barras), una IA lee las pistas que se ven en el disco y la web busca en Discogs las ediciones que mejor encajan. Tú eliges la tuya y queda guardada en **💿 Mis discos**.

Web publicada: **https://julioalbertoo.github.io/vinilos/**

> Piensa en la app como un **dependiente de tienda de discos con muy buena memoria**: mira el disco (Gemini), busca en el catálogo (Discogs), consulta la enciclopedia musical (MusicBrainz, Wikipedia…) y te apunta todo en tu libreta (el móvil y, si quieres, la nube).

---

## De un vistazo

- **📷 Identificar**: foto, galería o código de barras → candidatos de Discogs → eliges el tuyo.
- **💿 Mis discos**: Galería (discos que salen de la funda y giran), Cuadrícula y Datos (estadísticas).
- **📄 Ficha de cada disco**: canciones con duración, precios, notas de la crítica, color del vinilo, dato curioso, ediciones, Spotify.
- **🎤 Ficha del artista**: foto, biografía y discografía (clasificada por MusicBrainz).
- **⭐ Lo que busco**: tu lista de deseos.
- **🧭 Modo explorador**: identificar discos (en una tienda, en casa de un amigo) sin guardarlos.
- **☁️ Copia en la nube** (opcional): discos, lista de deseos y llaves en tu cuenta.
- **⚙️ Ajustes**: llaves, cupo de Gemini, nube y botón para actualizar la app.

---

## Cómo se usa

### 📷 Identificar un disco

Tienes tres caminos, de más a menos preciso:

| Camino | Cuándo usarlo |
|---|---|
| **▦ Código de barras** | Si la contraportada tiene código. Es el más rápido y exacto: va directo a la edición. No gasta cupo de IA. |
| **📷 Hacer foto** / **🖼️ Galería** | Portada, contraportada, lomo o galleta central. Se identifica sola nada más subir la foto. La IA lee artista, título, sello, número de catálogo y también los números del código de barras. |
| **Ninguno es el mío** (en los resultados) | Si ningún candidato es el tuyo: escribe artista y título, o el número de catálogo. |

- En cada candidato ves qué pistas coinciden (✓ sello, ✓ año, ✓ código de barras…).
- Si ya tienes esa edición, sale **💿 Ya lo tienes**, para no comprarla repetida.
- Pulsa **✓ Es este**: se abre su ficha y se guarda en **💿 Mis discos**.

**Truco para afinar la edición:** la portada suele ser igual en todas las ediciones. La contraportada y la galleta central traen el sello y el número de catálogo, que son los que distinguen una edición de otra.

### 🧭 Modo explorador

Interruptor debajo de los botones de Identificar. Al activarlo:

- La app se pone en **tema oscuro** (así sabes que está activo).
- Lo que identificas **no se guarda** en tu colección; el botón pasa a ser **🧭 Explorar este**.
- Queda apuntado en **🧭 Discos explorados** (solo en este móvil), con aviso de si ya lo tienes. Puedes quitar uno o borrar todo el historial.
- Abajo del todo aparece una **🔎 barra de búsqueda** de artistas y álbumes: escribes un nombre (sin hacer foto) y tocas un artista para ver su ficha o un álbum para abrir su edición principal en vinilo (que también se apunta en explorados).

Ejemplo: estás en una tienda de segunda mano, fotografías un disco y ves su precio y su edición sin llenar tu colección de discos que no son tuyos.

### 💿 Mis discos

Se abre siempre ordenado por **Recientes** (también puedes ordenar por año original, año de la edición, artista o título). Con la sesión de la nube iniciada, la app arranca directamente aquí.

**Galería** (la de inicio)
- Deslizas en horizontal y el disco del centro **sale de su funda y gira**, cada vez con una animación distinta (rebote, salto, moneda, cohete, zigzag…).
- Púlsalo otra vez para abrir su ficha.
- **🎲 Dado**: salta a un disco al azar.
- La **galleta** del centro es la de verdad: la IA busca su foto entre las de la edición en Discogs (una consulta por disco, solo la primera vez). Si no hay foto, sale una genérica con título y artista.
- Si el vinilo es **de color** (según Discogs), gira de ese color: translúcido, ahumado, jaspeado, con salpicaduras o arcoíris.
- En los **dobles y triples LP** se ven los vinilos de detrás; solo gira el de delante.

**Cuadrícula**: todas las portadas de un vistazo; aquí puedes borrar discos (✕).

**Datos**: tus estadísticas. Arriba, una barra fija con accesos a cada bloque y cuatro cifras (discos, artistas, países y horas de música). Después:

- **Valor** de la colección (precio sugerido de Discogs para VG+, o el más barato a la venta), con podio de los tres más valiosos y de dónde sale cada precio.
- **Géneros** dibujados como un vinilo; tocar un estilo enseña sus discos. Géneros y estilos **por década**.
- **Duración** total, comparada con algo conocido («como un vuelo de Madrid a Tokio»).
- **Canciones récord**: cuántas tienes, la más larga y la más corta, el disco con más y con menos.
- **La aguja**: caras (las veces que te levantas a darle la vuelta), vueltas del plato, kilómetros de surco.
- **Tu pila**: cuánto pesa y mide («2,5 veces un gato»), con el color de cada portada.
- **Ediciones especiales**: limitadas, numeradas, picture disc, con carpeta, dobles, 45 rpm… y la más especial.
- **Años**: mapa de casillas al estilo GitHub, originales frente a reediciones, edad media de tu música y línea del tiempo con portadas.
- **Colores**: mosaico de portadas ordenadas por color. **Tocarlo** convierte todas las portadas en teselas de su color (y vuelta); **mantener pulsada** una abre el disco. También tus vinilos de color girando.
- **Mapa del mundo** con dónde se editaron (vistas de Mundo, Europa y América).
- **Rareza y nota** de la comunidad de Discogs (nota media, cuánta gente los tiene, los más buscados que tenidos).
- **Artistas y sellos** que más se repiten.
- **Discografías**: cuántos LP de estudio tienes de tus artistas principales y cuáles te faltan (de MusicBrainz).
- **Lo que busco**: cuánto costaría conseguirlo, con el vinilo más barato a la venta de cada álbum.
- **Récords curiosos** (el más ecléctico, la reedición más tardía…) y **calendario** de cuándo añadiste cada disco, con tus rachas.

Al tocar un género, una década, un año, un país, un artista o un sello salen sus portadas, y cada portada abre su ficha. Lo que falta se pide poco a poco mientras la pestaña está abierta; con la cuenta en la nube, casi todo sale de ahí de golpe. El color de cada portada se calcula en el propio móvil.

### 📄 La ficha de un disco

- **Canciones** con su duración. Si Discogs no la tiene, la app la busca sola (ver [MusicBrainz](#-la-conexión-con-musicbrainz)). Los temas en varias partes («Shine On You Crazy Diamond») salen completos.
- **Precio** de tu edición y de **cualquier edición en vinilo** del álbum (la más barata entre sus 10 más comunes), con fecha de la consulta. Debajo, cuánta gente tiene y busca la edición, y la suma de todas sus ediciones en vinilo.
- Botones **Desde España** que abren Discogs con lo que se vende desde España, del más barato al más caro y en estado G o mejor.
- **Color y gramaje** del vinilo, sello, país, notas y datos de la comunidad.
- **🎧 Escuchar en Spotify**: abre el álbum en la app.
- **🎤 Botón del artista**: abre su ficha.
- **💿 Ver las distintas ediciones del disco**: todas las ediciones en vinilo del álbum, de la más común a la menos, con color y gramaje como pastillas.
- **🖼️ Cambiar portada**: si la foto principal es mala, eliges otra de la edición (o de las ediciones más populares).
- **📰 La crítica**: las notas de la prensa (p. ej. 76/100 en Metacritic, 7,5/10 en Pitchfork, 7/10 en NME), sacadas de la tabla de críticas del artículo del álbum en la Wikipedia en inglés. Si el álbum no la tiene, no sale. La de **Mondo Sonoro** se busca aparte con la búsqueda de Google de Gemini (gasta una búsqueda la primera vez; luego se guarda un mes) y solo sale si Google la respalda con una página de mondosonoro.com. Cada nota sale con color según lo alta que sea: 🟩 verde intenso (9/10 o más), 🟢 verde (de 8 a 9), 🟡 amarilla (6,5 a 8), 🟠 naranja (5 a 6,5) y 🔴 rosa (menos de 5). Las medias (Metacritic) llevan borde.
- **💡 ¿Sabías que…?**: un dato curioso (ver abajo).
- **☆ Añadir a lo que busco** (si no lo tienes) o **🗑️ Borrar de mis discos** (si lo tienes).

### 💡 ¿Sabías que…?

Un dato curioso del álbum, de esa edición o de una de sus canciones, **siempre con enlaces a sus fuentes y nunca inventado**.

- Primero lo busca **Gemini en Google**, y solo vale si las páginas encontradas respaldan sus frases.
- Si la búsqueda de Google no tiene cupo, la app lee ella misma textos: **Wikipedia** del álbum (localizado con Wikidata, en castellano, inglés u otros idiomas), notas de la edición y de la original en **Discogs**, la nota del álbum en **MusicBrainz**, **TheAudioDB**, una canción en Wikipedia o en **Genius** (con llave opcional), y si no, el artista o la historia del sello. Solo vale si la frase que lo prueba está en el texto, y el enlace lleva justo a esa frase.
- Cada consulta pide tres datos: se enseña uno y los otros se guardan para las próximas veces, sin gastar cupo.
- **🔄 Otro dato** saca uno nuevo; el móvil recuerda los ya vistos para no repetirlos.

### 🎤 Ficha del artista

Se abre tocando la cifra de **artistas** en Datos o el botón con su nombre en la ficha de un disco.

- Foto y biografía de Discogs.
- Tus discos suyos.
- Su **discografía**, con los que ya tienes marcados. De inicio solo los LP; con los botones de arriba ves directos, singles, EP, recopilatorios, piratas (bootlegs) u otros.
- Los que no tienes se abren sin guardarse, y con ☆ los apuntas en **Lo que busco**.
- Miembros del grupo o grupos en los que ha estado, que también abren su ficha.
- Lo que llega de Discogs se guarda 30 días.

### ⭐ Lo que busco

- Apunta álbumes con ☆ en la discografía de un artista o con **☆ Añadir a lo que busco** en la ficha.
- Se abre con el enlace **⭐ Lo que busco** al final de **💿 Mis discos**.
- Al guardar el disco en tu colección, sale solo de la lista.
- Con la nube, la ves igual en todos tus móviles.

### ⚙️ Ajustes

- **Llaves**: Gemini, Discogs y Genius (opcional), con **Probar conexión**. Cambiar una que ya funciona, dejarla vacía o **Borrar llaves** pide confirmación dos veces.
- **📊 Cupo de Gemini**: una fila por modelo con lo gastado hoy en este móvil y lo último que dijo Google (disponible, sin cupo por minuto o diario y hasta qué hora). La búsqueda de Google tiene su cupo aparte. **🔄 Comprobar ahora** hace una pregunta mínima a cada modelo. Los cupos se renuevan a medianoche de California. Si un modelo tarda demasiado, se salta el resto del día.
- **☁️ Copia en la nube** (ver abajo).
- **🔄 Refrescar a la última versión**. Además, la app comprueba sola si hay versión nueva y se recarga cuando no pierdes nada (por ejemplo, no en mitad de una foto).

### ☁️ Copia en la nube (opcional)

En **⚙️ Ajustes → Copia en la nube** entra con tu **email y contraseña**. Tus discos, lo que buscas y tus llaves se guardan también en la nube: si cambias de móvil o el navegador borra los datos, no los pierdes. En un móvil nuevo, pulsa en la bienvenida **☁️ Ya uso Vinilos en otro móvil**, entra y lo recuperas todo sin volver a pegar las llaves.

- **¿Sin contraseña?** Abre la web en Safari, pulsa **✉️ Enviarme un enlace para entrar** y abre el enlace del correo (sirve una sola vez). Ya dentro, pon una contraseña y úsala en la app de la pantalla de inicio.
- Sin cuenta, la app funciona igual.
- Si una llave ya está en el móvil, manda la del móvil; la de la nube solo se usa cuando aquí falta.
- Con la cuenta abierta también se guardan en la nube, para no volver a pedirlos:
  - la **ficha** de cada disco (30 días),
  - los **precios** (7 días),
  - artistas, discografías, ediciones, el vinilo más barato y los textos del dato curioso.

---

## 🧠 La conexión con MusicBrainz

[MusicBrainz](https://musicbrainz.org) es una **enciclopedia musical abierta y gratuita**, hecha por su comunidad, como una Wikipedia de la música. No pide llave ni cuenta.

> Analogía: **Discogs es el catálogo de una tienda de discos** (sabe de cada edición física: sellos, precios, colores del vinilo). **MusicBrainz es el bibliotecario** (sabe qué es cada obra: si un álbum es de estudio, en directo o recopilatorio, y cuánto dura cada canción). La app pregunta a cada uno lo que mejor sabe.

### Para qué se usa

| Dónde | Qué aporta MusicBrainz | Ejemplo |
|---|---|---|
| **Discografía del artista** | Clasifica cada álbum: LP, directo, recopilatorio, single, EP, pirata… (Discogs no marca bien los directos). Las portadas salen de [Cover Art Archive](https://coverartarchive.org), su archivo de portadas. | En la ficha de Queen, *Live Killers* sale en «Directos», no mezclado con los LP. |
| **Duración de las canciones** | Si Discogs no da la duración de alguna canción, se busca primero en MusicBrainz. | Un disco con canciones sin tiempo en Discogs pasa a mostrar «4:12», «6:03»… |
| **Datos → Discografías** | Cuenta solo los **LP de estudio** de tus artistas y te dice cuáles te faltan. | «Tienes 5 de 15 LP de Pink Floyd». |
| **Lo que busco** | Enlaza un álbum de MusicBrainz con su álbum (master) de Discogs para buscar precios y fichas. | Un álbum apuntado desde la discografía encuentra su vinilo más barato. |
| **¿Sabías que…?** | La nota libre del álbum en MusicBrainz es una de las fuentes de textos. | Pocas fichas la tienen, pero suele ser buena. |

### Cómo funciona por dentro (paso a paso)

1. **Encontrar al artista.** Primero se busca en MusicBrainz qué artista enlaza a la página de Discogs de ese artista (es lo más fiable). Si ninguno enlaza, se busca por nombre, descartando a los que enlazan a otro artista de Discogs (así no se confunden dos grupos con el mismo nombre).
2. **Pedir su discografía** por tipos, en este orden: primero los álbumes (lo que se enseña al abrir), luego directos, recopilatorios, singles, EP… y al final los piratas. La ficha se va pintando a medida que llega cada tipo.
3. **Marcar los que tienes.** Se comparan los títulos (sin tildes, sin «(Remastered)» ni signos) con tus discos.
4. **Si MusicBrainz no conoce al artista o falla**, la discografía sale de Discogs. En ese caso, un LP cuya edición principal no es vinilo (por ejemplo, un CD) se revisa para no perderlo.
5. **Duraciones**: se busca el álbum por título y artista (entendiendo «Beatles, The» como «The Beatles»), se elige la edición que mejor encaja (mismo número de canciones y más duraciones) y se emparejan las canciones por título. Lo que aún falte se copia de otras ediciones de Discogs (la principal y las más comunes). Si algo falla, queda apuntado el motivo y se reintenta otro día.

### Reglas de buena educación

- MusicBrainz pide **como mucho una consulta por segundo**. La app tiene una **cola**: las consultas esperan su turno, como en la cola de la carnicería, con 1,1 s entre una y otra.
- Esa cola es independiente de la de Discogs, así que pedir precios no retrasa las duraciones.
- Lo que llega se guarda (30 días en el móvil y, con la nube, en tu cuenta) para no volver a preguntar.

---

## Antes de empezar: las llaves

La web necesita dos llaves, como el carné de socio de dos bibliotecas: una para la IA que «lee» la foto (Google Gemini) y otra para buscar el disco (Discogs). Son tuyas, gratuitas, y **se guardan en tu navegador**: nunca se suben a este repositorio. Solo si entras en la copia en la nube se guardan también en tu cuenta de Supabase, donde únicamente tu cuenta puede leerlas.

MusicBrainz, Wikipedia y TheAudioDB **no necesitan llave**. Genius es opcional.

La primera vez que abres la web, una guía de bienvenida te lleva paso a paso. Aquí están los mismos pasos.

### 1. Llave de Google Gemini (para leer la foto)

1. Abre [Google AI Studio](https://aistudio.google.com/apikey) e inicia sesión con tu cuenta de Google.
2. Si te lo pide, acepta las condiciones de uso.
3. Pulsa **Create API key** (Crear clave de API). Si te pregunta por un proyecto, acepta el que te propone.
4. Copia la clave: empieza por `AIza`. Es gratis y no pide tarjeta.

> El plan gratuito tiene un cupo diario que da de sobra para uso personal. En ese plan, Google puede usar lo que le envías para mejorar sus productos (aquí, fotos de portadas).

### 2. Token de Discogs (para buscar el disco)

1. Abre [discogs.com/settings/developers](https://www.discogs.com/settings/developers) con tu cuenta de Discogs.
2. Pulsa **Generate new token** y cópialo.

### 3. Llave de Genius (opcional)

Da más historias de canciones al dato curioso. Es gratis: en [genius.com/api-clients](https://genius.com/api-clients) crea una app (vale cualquier nombre y web), pulsa **Generate Access Token** y pega ese código.

### 4. Pegarlas y comprobarlas

Pega cada llave en la guía (o en **⚙️ Ajustes**) y pulsa **Probar conexión**. Con Gemini y Discogs en ✅, la web abrirá directamente en Identificar.

---

## Usarla en el móvil

1. Abre la web en **Safari** (iPhone) o **Chrome** (Android).
2. Recomendado: **añádela a la pantalla de inicio** para tenerla como una app.
   - iPhone: botón Compartir → **Añadir a pantalla de inicio**.
   - Android: menú ⋮ → **Añadir a pantalla de inicio** (o **Instalar app**).
3. Ábrela desde el nuevo icono y **vuelve a pegar las llaves una vez** (o entra en la copia en la nube): la app de la pantalla de inicio guarda sus datos aparte de Safari.

¿Por qué merece la pena? Safari puede borrar los datos de una web si pasas un tiempo sin abrirla. Las apps de la pantalla de inicio no tienen ese límite.

Debajo del título verás la versión (por ejemplo `v1.72.2`). Sirve para comprobar que tienes la última.

---

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| «La llave de Google Gemini no es válida» / «El token de Discogs no es válido» | Pulsa **Revisar mis llaves en Ajustes**, vuelve a copiarla entera y prueba la conexión. |
| «Se ha agotado el cupo gratuito de Gemini» | Espera un rato (el cupo se renueva) o usa el escáner de código de barras, que no gasta cupo de IA. Mira **📊 Cupo de Gemini** en Ajustes. |
| «No encontré este disco en Discogs» | Fotografía la contraportada o la galleta central, escanea el código, o usa **Ninguno es el mío** para buscar escribiendo. |
| El escáner no lee el código | Acerca el móvil hasta que el código ocupe casi todo el ancho e inclina el disco para quitar reflejos. A los pocos segundos aparece **📷 Leer el número con una foto**. |
| «No hay permiso para usar la cámara» | Activa la cámara para esta web en los ajustes del navegador. |
| «Ese enlace ya se usó o caducó» | Cada enlace del correo sirve una sola vez. Para entrar en la app, usa tu email y contraseña en **⚙️ Ajustes → Copia en la nube**. |
| Faltan duraciones de canciones | Se buscan solas al abrir la ficha (MusicBrainz y otras ediciones). Si MusicBrainz no responde, se reintenta otro día. |
| No ves cambios recientes | Comprueba la versión bajo el título y pulsa **🔄 Refrescar a la última versión** en Ajustes. |

---

## Publicar tu propia copia (GitHub Pages)

1. Haz un *fork* de este repositorio (o sube estos archivos a uno tuyo).
2. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Elige la rama `main` y la carpeta `/ (root)`. Pulsa **Save**.
4. En un minuto tendrás la web en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

No hace falta servidor ni instalar nada: son archivos HTML, CSS y JavaScript. La copia en la nube usa un proyecto de [Supabase](https://supabase.com) (dirección y clave pública en `config.js`); en tu copia puedes cambiarlos por los de tu proyecto o dejarla sin usar.

---

## Cómo está hecha

Web estática (HTML + CSS + JavaScript sin frameworks) que habla directamente desde el navegador con cada servicio:

| Servicio | Para qué | Llave |
|---|---|---|
| Google Gemini | Leer la foto, elegir la galleta, dato curioso | Sí (gratis) |
| Discogs | Ediciones, fichas, precios, artistas | Sí (gratis) |
| MusicBrainz + Cover Art Archive | Discografías por tipo, duraciones, portadas | No |
| Wikipedia + Wikidata | Textos del dato curioso | No |
| TheAudioDB | Reseñas y biografías | No (llave pública) |
| Genius | Historias de canciones | Opcional |
| wsrv.nl | Leer las fotos de Discogs (galletas y colores de portada) | No |
| Supabase | Copia en la nube | Tu email |

| Archivo | Qué hace |
|---|---|
| `index.html` | Todas las pantallas. También guarda el número de versión y el import map. |
| `styles.css` | Estilos, pensados primero para el móvil (incluye el tema oscuro del modo explorador y las animaciones de la galería). |
| `app.js` | El «director de orquesta»: navegación, flujo foto → IA → Discogs → colección, fichas, modo explorador. |
| `config.js` | Único sitio con direcciones, modelos de IA y nombres de lo que se guarda. |
| `ai.js` | La IA: identifica el disco, elige la galleta y pide datos con búsqueda de Google. Prueba varios modelos de Gemini si uno se queda sin cupo. |
| `discogs.js` | Búsquedas en Discogs (código de barras → nº de catálogo → artista y título), fichas, ediciones, precios, colores del vinilo y discografía de respaldo. |
| `musicbrainz.js` | MusicBrainz: encontrar al artista, su discografía por tipos, duraciones de canciones, nota del álbum y enlace con Discogs. Cola de 1 consulta por segundo. |
| `details.js` | Fichas y precios guardados en la nube (tabla `vinilos.details`) y relleno de duraciones (MusicBrainz → otras ediciones de Discogs). |
| `artist.js` | Ficha del artista y lista de tus artistas; discografía de MusicBrainz o, si no, de Discogs. |
| `scoring.js` | Puntúa cada edición según las pistas que coinciden. |
| `barcode.js` | Escáner: lector del navegador si existe; si no, [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) 3.1.4 desde jsDelivr. |
| `imaging.js` | Reduce la foto (lado largo ~1024 px) antes de enviarla a la IA. |
| `tokens.js` | Guarda y comprueba las llaves (en el navegador). |
| `history.js` | Tus discos (en el navegador). Avisa de cada cambio para que se suba a la nube. |
| `explored.js` | Historial del modo explorador (solo en este móvil). |
| `wantlist.js` | «Lo que busco». |
| `quota.js` | Cupo de Gemini por modelo para Ajustes. |
| `trivia.js` | «¿Sabías que…?»: dato curioso con fuentes comprobadas. |
| `ratings.js` | Notas de la crítica del álbum (Metacritic, Pitchfork…), de Wikipedia. |
| `genius.js` / `audiodb.js` | Textos de Genius y TheAudioDB para el dato curioso. |
| `gallery.js` | Galería horizontal: funda, giro, animaciones al azar y dado. |
| `labels.js` | Busca en segundo plano la foto de la galleta de cada disco y la recorta (a través de [wsrv.nl](https://wsrv.nl), porque Discogs no deja que una web lea sus fotos). |
| `stats.js` / `charts.js` / `worldmap.js` | Pestaña Datos: cálculos, dibujos y mapa del mundo. |
| `cloud.js` | Copia en la nube con Supabase: entrada por email, sube cada cambio y mezcla lo del móvil con lo de la nube. Tablas `vinilos.records` (discos), `vinilos.wantlist`, `vinilos.settings` (llaves) y `vinilos.cache` (otras respuestas); cada cuenta solo ve lo suyo (reglas RLS). |
| `updater.js` | Comprueba si hay versión nueva y recarga la app. |
| `guide.js` | Textos de la guía de bienvenida. |

**Versiones:** cada publicación sube el número de versión en `index.html`, que también se añade a las direcciones de los archivos (`app.js?v=1.72.2`). Así el móvil descarga siempre la versión nueva en vez de una copia antigua guardada.

### Próximamente (v2)

- Añadir el disco confirmado a tu colección de Discogs. La app ya guarda el `release_id` de cada edición, que es la clave para hacerlo.
- Entrar con tu cuenta de Discogs en lugar de pegar un token.
