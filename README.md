# Eventos de AlAnguloTV

Plugin de [Kino](https://kinotvapp.github.io/kino-plugins/) con la agenda de <https://alangulotv.sx/> como canales en vivo (`kino-plugin.json` y `plugin.js` en la raíz), más una CLI de Node para scrapear los links y extraer los m3u8 (`cli/`).

## CLI (`cli/`)

Scraper con Node.js (fetch nativo + cheerio). Por defecto extrae los links `<a href="/eventos.html...">` de <https://alangulotv.sx/> (incluido el iframe de la agenda).

## Uso

```bash
npm install
npm run schedule                 # alangulotv.sx, prefijo /eventos.html
npm run schedule -- <url> <prefijo>   # URL y prefijo de href personalizados
```

El resultado se guarda en `output/links.json`.

```bash
npm run streams                  # abre cada embed en Chrome y guarda los m3u8 en output/streams.json
npm run open                     # lista los streams
npm run open -- <número>         # abre uno en VLC con sus headers
```

## Plugin de Kino

```bash
node sdk/validate.mjs .          # valida el manifiesto como lo hace Kino
node sdk/run.mjs . home          # ejecuta home() contra la agenda real
node --test test/plugin.test.mjs
```

**Estructura:** Inicio muestra una sola fila «Todos los eventos»; En vivo tiene la categoría «Todos» y una por competición (texto antes de los «:»). Cada evento es un canal y sus señales son copias con etiqueta (menú «Servidor»). Los eventos con señal van primero. **Orden:** primero los eventos que no han terminado (inicio + `duracion` horas, 3 por defecto; los terminados van al final), luego las etiquetas del ajuste `orden` (p. ej. `AR,LIB,SUD`; el resto, en el orden de la agenda), luego la hora. El botón «Ver mapa de competiciones» muestra la etiqueta de cada competición de hoy y «Ver todas las etiquetas» las 39 que conoce el sitio (con el nombre de su imagen). Cada evento lleva como miniatura (`poster` en Inicio, `logo` en En vivo) la imagen que el CSS de la agenda asigna a su etiqueta. Kino guarda las listas 6 h (Inicio) y 1 h (En vivo), así que «terminado» se recalcula cuando Kino las vuelve a pedir. **Zona horaria:** ajuste `tz` (por defecto UTC−3); la agenda viene en UTC+1. **Actualizar:** el botón «Actualizar eventos ahora» lee la agenda y vacía el ajuste `forzar`, lo que hace que Kino olvide las filas de Inicio guardadas.

`kino.browser.capture` (usado en `resolve`) solo funciona dentro de la app; el kit de Node lo simula en los tests.

## Licencia

Apache 2.0 (ver `LICENSE` y `NOTICE`).
