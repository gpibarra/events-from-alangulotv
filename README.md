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

**Estructura:** categoría = competición (texto antes de los «:»), canal = evento, y las señales del evento son copias con etiqueta (menú «Servidor»). **Zona horaria:** ajuste `tz` (por defecto UTC−3); la agenda viene en UTC+1. **Actualizar:** el botón «Actualizar eventos ahora» lee la agenda y vacía el ajuste `forzar`, lo que hace que Kino olvide las filas de Inicio guardadas.

`kino.browser.capture` (usado en `resolve`) solo funciona dentro de la app; el kit de Node lo simula en los tests.

## Licencia

Apache 2.0 (ver `LICENSE` y `NOTICE`).
