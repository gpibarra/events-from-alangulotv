// AlAnguloTV: la agenda de alangulotv como canales en vivo.
// Estructura: categoría = competición (el texto antes de los ":" del evento), canal = evento, y las
// señales del evento (TNT Sports, Op2, Op3…) son copias con etiqueta del canal, en el menú "Servidor".
// resolve abre el embed de una señal en el navegador oculto de Kino y devuelve la petición de video.

// Único lugar con el dominio de la agenda. Si cambia, se cambia aquí y en "hosts" de kino-plugin.json
// (un JSON no puede leerlo; un test comprueba que ambos coincidan).
export const BASE = "https://alangulotv.sx";
// Debe coincidir con "version" de kino-plugin.json (un test lo comprueba). Se escribe en el log de
// cada resolve para saber con certeza qué versión corre en el aparato: Kino no la imprime.
export const VERSION = "0.7.8";
const AGENDA = BASE + "/agenda.php";
const MIME_HLS = "application/vnd.apple.mpegurl";
// Inicio es una sola fila "Todos" (Kino admite 20 filas de 60 ítems) y En vivo tiene la categoría "Todos".
const MAX_ITEMS_FILA = 60;
const ID_TODOS = "todos";
// El ref de un canal es solo el id del evento: resolve vuelve a leer la agenda y usa las señales de ese
// momento, así un evento que el sitio listó sin enlaces funciona en cuanto los publica.
const PREFIJO_EVENTO = "evt:";
// Formato anterior (0.5.x y antes): llevaba las señales copiadas en JSON. Kino puede conservar filas
// guardadas con ese ref hasta 6 h, así que se sigue entendiendo.
const PREFIJO_LEGADO = "ev:";

// Las horas de la agenda vienen en UTC+1: el /hora.js del sitio las pasa a la zona del visitante con
// hora_local = hora + (UTC_del_visitante - 1). El ajuste "tz" (kino-plugin.json) es esa zona.
const UTC_AGENDA = 1;
const TZ_POR_DEFECTO = -3; // Argentina
// Un evento "ya terminó" cuando pasaron DURACION horas desde su inicio (ajuste "duracion"); los terminados van al final.
const DURACION_POR_DEFECTO = 3;

// Cada dominio de embed tiene una lista de métodos que se prueban en orden: el primero que devuelve un Stream gana y,
// si uno falla, se pasa al siguiente. Si el método de un servidor cambia, se escribe otra función con la firma
// (embed) => Stream y se agrega a su lista. Las señales de un evento se prueban en el orden en que las trae la agenda.
// Un dominio sin entrada es un servidor que el plugin no conoce: ni kino.fetch ni el navegador oculto pueden abrirlo
// (no está en los hosts del manifiesto), así que se descarta sin intentarlo. Cada dominio de aquí debe estar en
// "hosts" de kino-plugin.json (un test lo comprueba).
const EXTRACTORES = {
  // spf24live.st: su iframe (missflight.net) rechaza el User-Agent del WebView de Android ("; wv") con "domain protected",
  // así que el navegador oculto nunca sirve. Se lee con kino.fetch y se descifra la configuración del reproductor.
  "spf24live.st": [metodo("descifrado", extraerSpf24)],
  // latamzy.com y sudamericafy.com arman con un script ofuscado un iframe a un reproductor que trae el m3u8 en texto
  // plano (`playbackURL`). Se va directo a ese reproductor; si su dominio cambió, queda el navegador oculto.
  "latamzy.com": [
    metodo("directo", extraerPlayback((stream) => "https://streamtp99a.sbs/global1.php?stream=" + stream)),
    metodo("navegador", extraerPorRed({ referer: BASE + "/" })),
  ],
  "sudamericafy.com": [
    metodo("directo", extraerPlayback((stream) => "https://la18hd.su/vivo/canales.php?stream=" + stream, {
      Referer: "https://sudamericafy.com/", // la18hd.su solo responde a una carga que parece un iframe
      "Sec-Fetch-Dest": "iframe",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "cross-site",
    })),
    metodo("navegador", extraerPorRed({ referer: BASE + "/" })),
  ],
};
export const SERVIDORES = Object.keys(EXTRACTORES);

const MENSAJE_SERVIDOR_NUEVO = () =>
  texto(
    "Este evento usa un servidor que el plugin todavía no conoce. Avisa al autor y comparte el registro del modo debug.",
    "This event uses a server the plugin does not know yet. Tell the author and share the debug mode log.",
  );

function metodo(nombre, extraer) {
  return { nombre, extraer };
}

const texto = (es, en) => (String(kino.lang).startsWith("en") ? en : es);

// --- Agenda: competiciones y eventos --------------------------------------------------------------

async function pedirAgenda() {
  const r = await kino.fetch(AGENDA, { headers: { Referer: BASE + "/" } });
  if (!r.ok) throw kino.error("unavailable", "la agenda respondió " + r.status);
  return r.text();
}

// El sitio lista los eventos del día antes de tener sus enlaces: se devuelven todos, también los de 0 señales.
async function cargarAgenda() {
  return parsearAgenda(await pedirAgenda());
}

// "Copa Libertadores: Estudiantes LP vs Flamengo" -> { competicion, partido }. Sin ":", la
// competición es el tipo (AR, COL…) que el sitio le puso al evento.
export function separarEvento(evento, tipo) {
  const i = evento.indexOf(": ");
  return i > 0
    ? { competicion: evento.slice(0, i), partido: evento.slice(i + 2) }
    : { competicion: tipo || "Otros", partido: evento };
}

// Etiquetas: los códigos que el sitio le pone a cada evento (AR, LIB, MEX…; el `tipo` de la agenda).
// El ajuste "orden" las ordena a gusto de la persona: "AR,LIB,SUD" pone esas primero, en ese orden, y el resto
// va detrás en el orden de la agenda (a medida que aparecen). Vacío = el orden de la agenda.
export function ordenEtiquetas() {
  const crudo = kino.config.get("orden");
  return typeof crudo === "string" ? crudo.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
}

const rangoEtiqueta = (tipo, orden) => {
  const i = orden.indexOf(String(tipo || "").toUpperCase());
  return i < 0 ? orden.length : i;
};

// Horas que dura un partido (ajuste "duracion", texto). Un valor inválido o fuera de 0,5 a 12 vuelve al de siempre.
export function duracionHoras() {
  const n = Number(String(kino.config.get("duracion") ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0.5 && n <= 12 ? n : DURACION_POR_DEFECTO;
}

// Con qué se ordena: las etiquetas del ajuste, la hora de ahora y cuánto dura un partido. Sin contexto (ahora =
// -Infinity) nada "ha terminado" y solo manda la etiqueta.
const SIN_ORDEN = { orden: [], ahora: -Infinity, duracionMs: 0 };
export const contextoOrden = () => ({ orden: ordenEtiquetas(), ahora: Date.now(), duracionMs: duracionHoras() * 3600000 });

const haTerminado = (e, ctx) => e.inicioMs != null && e.inicioMs + ctx.duracionMs <= ctx.ahora;

// Orden general: 1) los que ya terminaron al final, 2) etiquetas del ajuste "orden" (el resto, tras ellas, en el orden
// de la agenda), 3) hora de inicio, 4) con señal antes que sin señal, 5) orden de la agenda. Así, si Kino recorta una
// lista larga, lo que se pierde es lo que ya pasó.
export function ordenarEventos(eventos, ctx = SIN_ORDEN) {
  return eventos
    .map((e, i) => ({ e, i, fin: haTerminado(e, ctx) ? 1 : 0, rango: rangoEtiqueta(e.tipo, ctx.orden) }))
    .sort((a, b) =>
      a.fin - b.fin ||
      a.rango - b.rango ||
      (a.e.inicioMs ?? 0) - (b.e.inicioMs ?? 0) ||
      (b.e.opciones.length > 0) - (a.e.opciones.length > 0) ||
      a.i - b.i)
    .map((x) => x.e);
}

// Competiciones con sus eventos. Se ordenan los eventos (ver ordenarEventos) y cada competición toma el lugar de
// su primer evento: así una competición sube o baja según su evento más prioritario.
export function agruparPorCompeticion(eventos, ctx = SIN_ORDEN) {
  const grupos = new Map();
  for (const e of ordenarEventos(eventos, ctx)) {
    const { competicion, partido } = separarEvento(e.evento, e.tipo);
    if (!grupos.has(competicion)) grupos.set(competicion, { id: "co-" + hash(competicion), titulo: competicion, eventos: [] });
    grupos.get(competicion).eventos.push({ ...e, partido });
  }
  return [...grupos.values()];
}

export function zonaHoraria() {
  const n = Number(kino.config.get("tz"));
  return Number.isFinite(n) && n >= -12 && n <= 14 ? n : TZ_POR_DEFECTO;
}

// "00:00" (UTC+1) -> "20:00" en UTC-3. Solo la hora del día: si cruza la medianoche, no se marca el día.
export function convertirHora(hhmm, tz) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || null;
  const minutos = (((Number(m[1]) * 60 + Number(m[2]) + (tz - UTC_AGENDA) * 60) % 1440) + 1440) % 1440;
  const dos = (n) => String(n).padStart(2, "0");
  return dos(Math.floor(minutos / 60)) + ":" + dos(minutos % 60);
}

const idEvento = (e) => "ev-" + hash(e.evento);

// En una lista mezclada ("Todos") el título lleva la competición; dentro de una competición, no.
const tituloEvento = (e, tz, conCompeticion = false) => {
  const hora = convertirHora(e.hora, tz);
  const nombre = conCompeticion ? e.evento : (e.partido ?? separarEvento(e.evento, e.tipo).partido);
  return (hora ? hora + " · " : "") + nombre;
};

const refEvento = (e) => PREFIJO_EVENTO + idEvento(e);

const itemEvento = (e, tz, conCompeticion = false) => ({
  id: idEvento(e),
  ref: refEvento(e),
  title: tituloEvento(e, tz, conCompeticion),
  kind: "live",
  overview: e.evento,
  badges: e.tipo ? [e.tipo] : undefined,
  poster: e.icono || undefined,
});

// Inicio: una sola fila con todos los eventos (sin separar por competición).
export async function home() {
  const tz = zonaHoraria();
  const eventos = ordenarEventos(await cargarAgenda(), contextoOrden());
  if (!eventos.length) return [];
  return [{
    id: ID_TODOS,
    title: texto("Todos los eventos", "All events"),
    items: eventos.slice(0, MAX_ITEMS_FILA).map((e) => itemEvento(e, tz, true)),
  }];
}

// Pestaña "En vivo": la categoría "Todos" primero y después una categoría por competición.
export async function liveCategories() {
  const eventos = await cargarAgenda();
  if (!eventos.length) return [];
  const grupos = agruparPorCompeticion(eventos, contextoOrden()).slice(0, 199);
  return [
    { id: ID_TODOS, title: texto("Todos", "All"), genre: "deportes" },
    ...grupos.map((g) => ({ id: g.id, title: g.titulo, genre: "deportes" })),
  ];
}

export async function liveChannels({ categoryId }) {
  const tz = zonaHoraria();
  const eventos = await cargarAgenda();
  const todos = categoryId === ID_TODOS;
  const ctx = contextoOrden();
  const lista = todos ? ordenarEventos(eventos, ctx) : agruparPorCompeticion(eventos, ctx).find((g) => g.id === categoryId)?.eventos;
  if (!lista) return { items: [] };
  return {
    items: lista.slice(0, 500).map((e, i) => ({
      id: idEvento(e),
      title: tituloEvento(e, tz, todos),
      ref: refEvento(e),
      categoryId,
      number: i + 1,
      logo: e.icono || undefined,
    })),
  };
}

// --- Ajustes: botón "Actualizar eventos ahora" ---------------------------------------------------------
// Kino guarda las filas de Inicio 6 h y las listas de En vivo 1 h, y el plugin no puede borrarlas. Lo que sí
// hace Kino al vaciar un ajuste desde una acción es cerrar el sandbox y olvidar las filas de Inicio guardadas
// (igual que al guardar cualquier cambio). Por eso el botón vacía el ajuste "forzar", que no sirve para nada
// más: NUNCA debe incluir "tz" (volvería a UTC-3). Si la agenda no se puede leer, la acción lanza error y
// Kino no vacía nada.
export const AJUSTES_A_VACIAR = ["forzar"];

export async function action(key) {
  if (key === "mapa") return accionMapa();
  if (key === "etiquetas") return accionEtiquetas();
  if (key !== "actualizar") return { message: texto("Listo", "Done") };
  const eventos = await cargarAgenda();
  const conSenal = eventos.filter((e) => e.opciones.length).length;
  const competiciones = agruparPorCompeticion(eventos).length;
  kino.log("actualización forzada v" + VERSION, eventos.length + " eventos", conSenal + " con señal");
  // Sin eventos no hay nada que refrescar: no se vacía nada y se avisa.
  if (!eventos.length) {
    return {
      message: texto(
        "No hay eventos en la agenda de hoy. El sitio aún no los publicó.",
        "There are no events in today's schedule. The site has not published them yet.",
      ),
    };
  }
  return {
    message: texto(
      `Agenda leída: ${eventos.length} eventos (${conSenal} con señal) en ${competiciones} competiciones. Kino volverá a pedirla.`,
      `Schedule read: ${eventos.length} events (${conSenal} with a signal) in ${competiciones} competitions. Kino will ask for it again.`,
    ),
    clearSettings: AJUSTES_A_VACIAR,
  };
}

// --- Ajustes: botón "Ver mapa de competiciones" ---------------------------------------------------------
// En En vivo solo se ve el nombre de la competición, pero el ajuste "orden" pide la etiqueta (AR, LIB…). El botón
// lista qué etiqueta tiene cada competición de la agenda de ahora. El mensaje de una acción admite 300 caracteres,
// así que si no cabe se reparte en páginas: cada pulsación muestra la siguiente (la página se guarda en kino.storage).
const MAX_PAGINA_MAPA = 230;

export function mapaDeEtiquetas(eventos) {
  const porEtiqueta = new Map();
  for (const e of eventos) {
    const tipo = String(e.tipo || "?").toUpperCase();
    const { competicion } = separarEvento(e.evento, e.tipo);
    if (!porEtiqueta.has(tipo)) porEtiqueta.set(tipo, []);
    if (!porEtiqueta.get(tipo).includes(competicion)) porEtiqueta.get(tipo).push(competicion);
  }
  return [...porEtiqueta].map(([tipo, competiciones]) => `${tipo}: ${competiciones.join(", ")}`);
}

export function paginasDelMapa(entradas, max = MAX_PAGINA_MAPA) {
  const paginas = [];
  let actual = "";
  for (const entrada of entradas) {
    const corta = entrada.length > max ? entrada.slice(0, max - 1) + "…" : entrada;
    if (actual && (actual + "\n" + corta).length > max) {
      paginas.push(actual);
      actual = corta;
    } else {
      actual = actual ? actual + "\n" + corta : corta;
    }
  }
  if (actual) paginas.push(actual);
  return paginas;
}

// Muestra una lista larga de a un trozo por pulsación (la página se guarda en kino.storage bajo `clave`).
function mensajePaginado(entradas, clave) {
  const paginas = paginasDelMapa(entradas);
  let n = Number(kino.storage.get(clave));
  if (!Number.isInteger(n) || n < 0 || n >= paginas.length) n = 0;
  kino.storage.set(clave, String((n + 1) % paginas.length));
  const pie = paginas.length > 1 ? `\n(${n + 1}/${paginas.length}) ${texto("Pulsa otra vez para ver más.", "Press again for more.")}` : "";
  return { message: paginas[n] + pie, paginas: paginas.length };
}

async function accionMapa() {
  const eventos = await cargarAgenda();
  const entradas = mapaDeEtiquetas(eventos);
  if (!entradas.length) {
    return { message: texto("No hay eventos en la agenda de hoy: todavía no hay etiquetas que mostrar.", "There are no events in today's schedule: no tags to show yet.") };
  }
  const { message, paginas } = mensajePaginado(entradas, "mapaPagina");
  kino.log("mapa de etiquetas v" + VERSION, entradas.length + " etiquetas", paginas + " páginas");
  return { message };
}

// Botón "Ver todas las etiquetas": las que el sitio conoce en su CSS (aunque hoy no haya partidos de ellas) y el nombre
// de su imagen, que suele decir de qué torneo o país es ("libertadore", "sudamericana", "championsleague"…).
async function accionEtiquetas() {
  const iconos = iconosDeAgenda(await pedirAgenda());
  const entradas = etiquetasDelSitio(iconos);
  if (!entradas.length) {
    return { message: texto("No pude leer las etiquetas del sitio.", "Could not read the site's tags.") };
  }
  const { message, paginas } = mensajePaginado(entradas, "etiquetasPagina");
  kino.log("etiquetas del sitio v" + VERSION, entradas.length + " etiquetas", paginas + " páginas");
  return { message };
}

// --- resolve ---------------------------------------------------------------------------------------

export async function resolve(ref) {
  await Promise.resolve(); // Kino 0.9.49 y anteriores no atajan un throw antes del primer await
  if (ref.startsWith(PREFIJO_EVENTO)) return resolverEventoPorId(ref.slice(PREFIJO_EVENTO.length));
  if (ref.startsWith(PREFIJO_LEGADO)) return resolverEventoLegado(ref);
  return resolverSenal(ref);
}

// Un evento por su id: relee la agenda y resuelve las señales que tiene ahora.
async function resolverEventoPorId(id) {
  const evento = (await cargarAgenda()).find((e) => idEvento(e) === id);
  if (!evento) {
    throw kino.error("not_found", "el evento ya no está en la agenda", {
      userMessage: texto("Este evento ya no está en la agenda.", "This event is no longer in the schedule."),
    });
  }
  if (!evento.opciones.length) {
    kino.log("evento sin señales", evento.tipo);
    throw kino.error("not_found", "el evento no tiene señales todavía", {
      userMessage: texto(
        "Todavía no hay señal para este evento. Prueba más tarde.",
        "There is no signal for this event yet. Try again later.",
      ),
    });
  }
  return resolverSenales(evento.opciones.map((o) => ({ n: o.texto, e: o.embed })));
}

// Ref de versiones anteriores: las señales vienen copiadas en el propio ref.
async function resolverEventoLegado(ref) {
  let senales;
  try {
    senales = JSON.parse(ref.slice(PREFIJO_LEGADO.length)).map((s) => ({ n: String(s.n), e: String(s.e) }));
    if (!senales.length) throw new Error("sin señales");
  } catch {
    throw kino.error("not_found", "ref de evento inválido");
  }
  return resolverSenales(senales);
}

// Prueba las señales en el orden de la agenda y devuelve la primera que anda. Las demás van como copias con etiqueta
// (menú "Servidor"): Kino las resuelve solo si la persona las elige o si esta falla.
async function resolverSenales(lista) {
  const senales = lista.map((s) => ({ n: s.n.slice(0, 48), e: s.e }));
  let desconocidas = 0;
  for (const [i, senal] of senales.entries()) {
    try {
      const stream = await resolverSenal(senal.e);
      return {
        ...stream,
        label: senal.n,
        alternatives: senales.filter((_, j) => j !== i).map((s) => ({ label: s.n, ref: s.e })),
      };
    } catch (e) {
      if (e.servidorDesconocido) desconocidas++;
      kino.log("señal descartada", new URL(senal.e).hostname, e.code);
    }
  }
  if (desconocidas === senales.length) {
    throw kino.error("not_found", "todas las señales son de servidores no soportados", { userMessage: MENSAJE_SERVIDOR_NUEVO() });
  }
  throw kino.error("unavailable", "ninguna señal respondió", {
    userMessage: texto(
      "No se pudo abrir ninguna señal de este evento ahora. Prueba de nuevo más tarde.",
      "None of this event's signals could be opened right now. Try again later.",
    ),
  });
}

// Una señal (el embed de un servidor): se resuelve con el extractor de su dominio.
async function resolverSenal(ref) {
  let embed;
  try {
    embed = new URL(ref);
  } catch {
    throw kino.error("not_found", "ref inválido");
  }
  kino.log("resolve v" + VERSION, embed.hostname);
  const metodos = EXTRACTORES[embed.hostname];
  if (!metodos) {
    // Se registra para que llegue al autor por el registro del modo debug.
    kino.log("servidor no soportado: " + embed.hostname, embed.href);
    const error = kino.error("not_found", "servidor no soportado: " + embed.hostname, { userMessage: MENSAJE_SERVIDOR_NUEVO() });
    error.servidorDesconocido = true;
    throw error;
  }
  let ultimo;
  for (const { nombre, extraer } of metodos) {
    try {
      const stream = await extraer(embed.href);
      kino.log("método ok", embed.hostname, nombre);
      return stream;
    } catch (e) {
      kino.log("método falló", embed.hostname, nombre, e.code, e.message);
      ultimo = e;
      if (e.fueraDelAire) break;
    }
  }
  throw ultimo;
}

// Método "directo": el reproductor de algunos servidores trae el m3u8 en texto plano (`var playbackURL = "…"`).
// `urlDe` arma la dirección del reproductor a partir del parámetro `stream` del embed.
const UA_CHROME_MOVIL = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

function extraerPlayback(urlDe, headers = {}) {
  return async (embed) => {
    const stream = new URL(embed).searchParams.get("stream");
    if (!stream) throw kino.error("not_found", "el embed no trae stream");
    const reproductor = urlDe(stream);
    const r = await kino.fetch(reproductor, { headers: { "User-Agent": UA_CHROME_MOVIL, ...headers } });
    if (!r.ok) throw kino.error("unavailable", new URL(reproductor).hostname + " respondió " + r.status);
    const url = /playbackURL\s*=\s*["']([^"']+)["']/.exec(await r.text())?.[1]?.replace(/\\\//g, "/");
    if (!/^https:\/\//.test(url ?? "")) throw kino.error("not_found", new URL(reproductor).hostname + " sin playbackURL");
    const resultado = { url, mime: MIME_HLS, headers: { "User-Agent": UA_CHROME_MOVIL } };
    await comprobarEnElAire(resultado);
    return resultado;
  };
}

// Los reproductores entregan la URL aunque el canal esté fuera del aire (antes de un partido, por ejemplo), y Kino
// reintenta ese m3u8 sin pasar a otra señal. Por eso se pide la lista antes de devolverla: si no responde o no es una
// lista HLS, el método falla y se prueba la siguiente señal. Solo se puede pedir a un host del manifiesto; si el
// servidor de video es otro (cambió de dominio), no se comprueba y se devuelve igual.
async function comprobarEnElAire({ url, headers }) {
  let r;
  try {
    r = await kino.fetch(url, { headers, timeoutMs: 8000 });
  } catch (e) {
    if (e.code === "host_not_allowed") {
      kino.log("m3u8 sin comprobar (host no declarado)", new URL(url).hostname);
      return;
    }
    throw kino.error("unavailable", "el m3u8 no respondió: " + (e.code || e.message));
  }
  const lista = r.ok ? await r.text() : "";
  if (!lista.trimStart().startsWith("#EXTM3U")) {
    const error = kino.error("unavailable", "canal fuera del aire: " + new URL(url).hostname + " respondió " + r.status);
    error.fueraDelAire = true; // el navegador vería el mismo canal apagado: se pasa directo a la siguiente señal
    throw error;
  }
}

// Método "spf24live": la página solo trae un iframe a missflight.net, que sirve el reproductor si su Referer es
// spf24live.st y el User-Agent es el de un Chrome (no un WebView). El iframe guarda el m3u8 en window._econfig:
// base64 de cuatro trozos iguales, cada uno base64 con un carácter de relleno en la posición 3, que unidos en el
// orden 1, 3, 0, 2 son el base64 de un JSON con `stream_url`. Los segmentos piden Referer missflight.net.
const ORDEN_ECONFIG = [1, 3, 0, 2];

export function descifrarEconfig(econfig) {
  const todo = atob(econfig);
  const n = todo.length / 4;
  if (!Number.isInteger(n) || n < 5) throw new Error("econfig de largo inesperado");
  const trozos = [0, 1, 2, 3].map((i) => {
    const t = todo.slice(i * n, (i + 1) * n);
    return atob(t.slice(0, 3) + t.slice(4));
  });
  return JSON.parse(atob(ORDEN_ECONFIG.map((i) => trozos[i]).join("")));
}

async function extraerSpf24(embed) {
  const pedir = async (url, referer) => {
    const r = await kino.fetch(url, { headers: { Referer: referer, "User-Agent": UA_CHROME_MOVIL } });
    if (!r.ok) throw kino.error("unavailable", new URL(url).hostname + " respondió " + r.status);
    return r.text();
  };
  const pagina = await pedir(embed, BASE + "/");
  const iframe = /<iframe[^>]+src=["'](https:\/\/[^"']+)["']/i.exec(pagina)?.[1];
  if (!iframe) throw kino.error("not_found", "spf24live sin iframe");
  const reproductor = await pedir(iframe, "https://spf24live.st/");
  const econfig = /_econfig\s*=\s*["']([A-Za-z0-9+/=]+)["']/.exec(reproductor)?.[1];
  if (!econfig) throw kino.error("not_found", "el iframe no trae configuración (" + new URL(iframe).hostname + ")");
  let config;
  try {
    config = descifrarEconfig(econfig);
  } catch (e) {
    throw kino.error("not_found", "no se pudo descifrar la configuración: " + e.message);
  }
  const url = config.stream_url || config.stream_url_nop2p;
  if (!/^https:\/\//.test(url ?? "")) throw kino.error("not_found", "la configuración no trae stream_url");
  const stream = { url, mime: MIME_HLS, headers: { Referer: new URL(iframe).origin + "/", "User-Agent": UA_CHROME_MOVIL } };
  await comprobarEnElAire(stream);
  kino.log("spf24live ok", new URL(iframe).hostname, new URL(url).hostname);
  return stream;
}

// Método "red": la página arma el reproductor con sus scripts, así que se abre oculta y se toma la
// petición .m3u8. Los headers que devuelve (Referer, User-Agent…) hay que pasarlos al reproductor.
// `referer` es opcional: solo para los embeds que lo exigen en la primera carga.
function extraerPorRed({ referer } = {}) {
  return async (embed) => {
    const host = new URL(embed).hostname;
    let captura;
    try {
      captura = await kino.browser.capture(embed, {
        ...(referer ? { headers: { Referer: referer } } : {}),
        timeoutMs: 15000, // Kino da 20 s a una copia perezosa y 75 s a todo el resolve
        match: "\\.m3u8",
      });
    } catch (e) {
      kino.log("captura falló", host, e.code, e.message);
      throw kino.error("unavailable", "captura " + (e.code || "falló"), {
        userMessage: texto(
          "No se pudo abrir esta señal ahora. Prueba otra opción del evento.",
          "This signal could not be opened right now. Try another option of the event.",
        ),
      });
    }
    kino.log("captura ok", host, captura.media.length + " medios");
    const medio = captura.media.find((m) => /\.m3u8/i.test(m.url)) ?? captura.media[0];
    if (!medio) throw kino.error("not_found", "la página no pidió video");
    return { url: medio.url, mime: MIME_HLS, headers: medio.headers };
  };
}

// agenda.php: <b>Agenda - Viernes 16 de Octubre de 2026</b>
//   <li class="TIPO"><a href="#">Evento <span class="t">hora</span></a><ul>
//   <li><a href="/eventos.html?r=BASE64">Opción <span>Calidad</span></a></li>…</ul></li>
// Cada evento lleva `inicioMs` (UTC): la fecha de la cabecera + su hora en UTC+1. La agenda va en orden cronológico y
// pasa de medianoche, así que cuando la hora baja respecto de la anterior es el día siguiente.
const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

function fechaDeAgenda(html) {
  const m = /Agenda[^<]*?(\d{1,2})\s+de\s+([A-Za-zñÑ]+)\s+de\s+(\d{4})/.exec(html);
  const mes = m ? MESES[m[2].toLowerCase()] : undefined;
  return mes === undefined ? null : Date.UTC(Number(m[3]), mes, Number(m[1]));
}

// El CSS de la agenda le pone a cada etiqueta su imagen: `.AR > a:before { background-image: url(https://…/argentina.png) }`.
// Se lee de ahí (no se copia la lista) para que una etiqueta nueva o una imagen cambiada se tomen solas.
export function iconosDeAgenda(html) {
  const iconos = {};
  for (const m of html.matchAll(/\.([A-Za-z0-9_]+)\s*>\s*a:before\s*\{[^}]*?url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
    const url = m[2].trim().replace(/ /g, "%20");
    if (/^https:\/\//.test(url)) iconos[m[1]] = url;
  }
  return iconos;
}

// "ARA: arabia", "LIB: libertadore"…: la etiqueta y el nombre de su imagen (sin carpeta ni extensión).
export function etiquetasDelSitio(iconos) {
  return Object.entries(iconos).map(([tipo, url]) => {
    let nombre = url.split("/").pop().split("?")[0];
    try { nombre = decodeURIComponent(nombre); } catch { /* se deja tal cual */ }
    return `${tipo}: ${nombre.replace(/\.[A-Za-z0-9]+$/, "")}`;
  });
}

export function parsearAgenda(html) {
  const eventos = [];
  const reEvento = /<li class="([\w-]+)">\s*<a href="#">([\s\S]*?)<\/a>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
  for (const m of html.matchAll(reEvento)) {
    const cabecera = m[2];
    const hora = (/<span class="t">([^<]*)<\/span>/.exec(cabecera) || [])[1];
    const opciones = [];
    for (const o of m[3].matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const embed = decodificarR(o[1]);
      if (embed) opciones.push({ texto: limpiar(o[2]), embed });
    }
    eventos.push({
      tipo: m[1],
      hora: hora ? hora.trim() : null,
      evento: limpiar(cabecera.replace(/<span class="t">[\s\S]*?<\/span>/, "")),
      opciones,
      inicioMs: null,
      icono: null,
    });
  }
  const iconos = iconosDeAgenda(html);
  for (const e of eventos) e.icono = iconos[e.tipo] ?? null;
  const base = fechaDeAgenda(html);
  let dia = 0;
  let previo = -1;
  for (const e of eventos) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(e.hora || "");
    if (base === null || !m) continue;
    const minutos = Number(m[1]) * 60 + Number(m[2]);
    if (previo >= 0 && minutos < previo) dia++;
    previo = minutos;
    e.inicioMs = base + dia * 86400000 + minutos * 60000 - UTC_AGENDA * 3600000;
  }
  return eventos;
}

// El parámetro `r` del enlace es la URL del embed en base64.
function decodificarR(href) {
  const m = /[?&]r=([^&"]+)/.exec(href);
  if (!m) return null;
  try {
    const url = atob(decodeURIComponent(m[1]));
    return /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function limpiar(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ids estables y válidos (^[A-Za-z0-9._~-]{1,128}$) a partir de un texto.
function hash(texto) {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h * 33) ^ texto.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
