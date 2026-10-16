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
npm run hosts                    # compara los dominios de output/streams.json con los del plugin
npm run all                      # schedule + streams + hosts
```

`npm run hosts` revisa tres cosas: que cada servidor de la agenda (embed) tenga métodos en `EXTRACTORES` y esté en `hosts` (si no, es un error y termina con código 1); que el reproductor (el iframe que pide el m3u8) esté en `hosts`, porque si no el método directo no lo alcanza; y que el servidor de video también lo esté, para poder comprobar si el canal está en el aire. Ojo: que Chrome encuentre un m3u8 no significa que el canal esté transmitiendo, porque la captura toma la petición aunque responda 404.

## Plugin de Kino

```bash
node sdk/validate.mjs .          # valida el manifiesto como lo hace Kino
node sdk/run.mjs . home          # ejecuta home() contra la agenda real
node --test test/plugin.test.mjs
```

**Estructura:** Inicio muestra una sola fila «Todos los eventos»; En vivo tiene la categoría «Todos» y una por competición (texto antes de los «:»). Cada evento es un canal con sus señales (las opciones de la agenda). Los eventos con señal van primero. **Orden:** primero los eventos que no han terminado (inicio + `duracion` horas, 3 por defecto; los terminados van al final), luego las etiquetas del ajuste `orden` (p. ej. `AR,LIB,SUD`; el resto, en el orden de la agenda), luego la hora. El botón «Ver mapa de competiciones» muestra la etiqueta de cada competición de hoy y «Ver todas las etiquetas» las 39 que conoce el sitio (con el nombre de su imagen). Cada evento lleva como miniatura (`poster` en Inicio, `logo` en En vivo) la imagen que el CSS de la agenda asigna a su etiqueta. Kino guarda las listas 6 h (Inicio) y 1 h (En vivo), así que «terminado» se recalcula cuando Kino las vuelve a pedir. **Zona horaria:** ajuste `tz` (por defecto UTC−3); la agenda viene en UTC+1. **Actualizar:** el botón «Actualizar eventos ahora» lee la agenda y vacía el ajuste `forzar`, lo que hace que Kino olvide las filas de Inicio guardadas.

### Señales y servidores

Al abrir un evento, el plugin prueba sus señales **en el orden de la agenda** y reproduce la primera que funciona. Las demás se devuelven como copias, pero Kino ignora las copias en los canales en vivo: no hay menú «Servidor» para elegirlas a mano, y si una señal falla el plugin pasa solo a la siguiente.

Cada dominio de embed tiene en `EXTRACTORES` (`plugin.js`) una **lista de métodos** que se prueban en orden:

| Embed | Métodos | Cómo |
|---|---|---|
| `spf24live.st` | descifrado | Lee con `kino.fetch` el iframe de `missflight.net` (Referer `spf24live.st`, User-Agent de Chrome) y descifra el m3u8 de `window._econfig`. El navegador oculto no sirve: `missflight.net` rechaza el User-Agent del WebView de Android (`; wv`). |
| `latamzy.com` | directo, navegador | Directo: el reproductor `streamtp99a.sbs/global1.php?stream=…` trae el m3u8 en texto plano (`playbackURL`). |
| `sudamericafy.com` | directo, navegador | Directo: el reproductor `la18hd.su/vivo/canales.php?stream=…`, que solo responde a una carga que parece un iframe (`Sec-Fetch-Dest: iframe`). |

El método «navegador» usa `kino.browser.capture`: abre el embed en el WebView oculto y toma la petición `.m3u8`.

Los métodos directo y descifrado **piden el m3u8 antes de devolverlo**: los reproductores entregan la URL aunque el canal esté fuera del aire (antes de un partido, por ejemplo), y Kino reintentaría ese m3u8 sin pasar a otra señal. Si no es una lista HLS, la señal se descarta (sin probar el navegador, que vería el mismo canal apagado) y se prueba la siguiente. Para eso los servidores de video (`*.fubo18.com`, `*.domhsd.com`, `*.7m12bgo8dx9z.net`) están en `hosts`; si uno cambia de dominio, el m3u8 se devuelve sin comprobar.

latamzy y sudamericafy arman el iframe con un script ofuscado, así que el dominio del reproductor está escrito en el plugin. Si cambia, el método directo falla y queda el navegador.

**Un servidor nuevo** (un dominio que no está en `EXTRACTORES`) no se puede abrir: `kino.fetch` y `kino.browser.capture` solo arrancan en los `hosts` del manifiesto. El plugin descarta esa señal sin intentarla, escribe `servidor no soportado: <dominio>` en el log y prueba la siguiente. Si todas las señales del evento son de servidores desconocidos, la persona ve «Este evento usa un servidor que el plugin todavía no conoce. Avisa al autor y comparte el registro del modo debug.» (con el «Modo debug» del plugin activado, Kino guarda ese registro y permite compartirlo). Para sumarlo hay que agregar sus métodos en `EXTRACTORES` y su host en `hosts` (un test exige que coincidan), subir la versión y aprobar la actualización en Kino (Ajustes ▸ Plugins), porque Kino no instala solo una versión que amplía `hosts`.

`kino.browser.capture` solo funciona dentro de la app; el kit de Node lo simula en los tests.

## Licencia

Apache 2.0 (ver `LICENSE` y `NOTICE`).
