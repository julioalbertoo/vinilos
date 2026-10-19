# vinilos

## Versionado (obligatorio en cada push)

- La versión vive solo en `index.html`: en la cabecera (`.app-version`) y como `?v=` en `styles.css`, `app.js` y el import map. Al publicar, sustituye la versión en **todas** sus apariciones de ese archivo.
- El `?v=` evita que Safari (caché de 10 min de GitHub Pages) siga usando JS/CSS antiguos. Todo módulo `.js` nuevo debe añadirse al import map.
- Sube la versión en **cada** push a `main`, para que el usuario compruebe en el móvil qué versión está probando.
- Formato `0.<paso>.<n>` mientras el MVP no esté terminado: `<paso>` es el paso del plan en curso y `<n>` sube con cada push (vuelve a 1 al empezar un paso nuevo). Al terminar el MVP: `1.0.0`.
