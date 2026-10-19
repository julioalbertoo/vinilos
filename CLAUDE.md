# vinilos

## Versionado (obligatorio en cada push)

- La versión vive solo en `config.js` → `APP_VERSION` y se muestra en la cabecera.
- Sube la versión en **cada** push a `main`, para que el usuario compruebe en el móvil qué versión está probando.
- Formato `0.<paso>.<n>` mientras el MVP no esté terminado: `<paso>` es el paso del plan en curso y `<n>` sube con cada push (vuelve a 1 al empezar un paso nuevo). Al terminar el MVP: `1.0.0`.
