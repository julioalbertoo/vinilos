# vinilos

## Versionado (obligatorio en cada push)

- La versión vive solo en `index.html`: en la cabecera (`.app-version`) y como `?v=` en `styles.css`, `app.js` y el import map. Al publicar, sustituye la versión en **todas** sus apariciones de ese archivo.
- El `?v=` evita que Safari (caché de 10 min de GitHub Pages) siga usando JS/CSS antiguos. Todo módulo `.js` nuevo debe añadirse al import map.
- Sube la versión en **cada** push a `main`, para que el usuario compruebe en el móvil qué versión está probando.
- Desde `1.0.0` (MVP terminado), formato semver: `1.0.<n>` para arreglos, `1.<m>.0` para funciones nuevas, `2.0.0` para la v2 (escribir en la colección de Discogs).
