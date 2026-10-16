// AlAnguloTV: la agenda de alangulotv como canales en vivo.
// Estructura: categoría = competición (el texto antes de los ":" del evento), canal = evento, y las
// señales del evento (TNT Sports, Op2, Op3…) son copias con etiqueta del canal, en el menú "Servidor".
// resolve abre el embed de una señal en el navegador oculto de Kino y devuelve la petición de video.

// Único lugar con el dominio de la agenda. Si cambia, se cambia aquí y en "hosts" de kino-plugin.json
// (un JSON no puede leerlo; un test comprueba que ambos coincidan).
export const BASE = "https://alangulotv.sx";
// Debe coincidir con "version" de kino-plugin.json (un test lo comprueba). Se escribe en el log de
// cada resolve para saber con certeza qué versión corre en el aparato: Kino no la imprime.
export const VERSION = "0.4.0";
const AGENDA = BASE + "/agenda.php";
const MIME_HLS = "application/vnd.apple.mpegurl";
const MAX_FILAS = 20;
const PREFIJO_EVENTO = "ev:";

// Las horas de la agenda vienen en UTC+1: el /hora.js del sitio las pasa a la zona del visitante con
// hora_local = hora + (UTC_del_visitante - 1). El ajuste "tz" (kino-plugin.json) es esa zona.
const UTC_AGENDA = 1;
const TZ_POR_DEFECTO = -3; // Argentina

// Un extractor por dominio del embed. Si el método de uno cambia, se escribe otra función con la
// misma firma (embed) => Stream y se apunta aquí. `prioridad` ordena las señales de un evento: se
// prueba primero la de número menor. Un dominio sin entrada usa extraerPorRed() con prioridad 5.
const EXTRACTORES = {
  // Sin Referer a propósito: el iframe de missflight.net solo sirve el reproductor si su Referer es
  // spf24live.st; un Referer puesto a la primera carga se le pasa también y responde "NOT ALLOWED".
  // En la app de Kino igual falla ("domain protected"), por eso va al final.
  "spf24live.st": { extraer: extraerPorRed(), prioridad: 9 },
  "latamzy.com": { extraer: extraerPorRed({ referer: BASE + "/" }), prioridad: 1 },
  "sudamericafy.com": { extraer: extraerPorRed({ referer: BASE + "/" }), prioridad: 1 },
};
const POR_DEFECTO = { extraer: extraerPorRed(), prioridad: 5 };
const extractorDe = (embed) => EXTRACTORES[new URL(embed).hostname] ?? POR_DEFECTO;

const texto = (es, en) => (String(kino.lang).startsWith("en") ? en : es);

// --- Agenda: competiciones y eventos --------------------------------------------------------------

async function cargarAgenda() {
  const r = await kino.fetch(AGENDA, { headers: { Referer: BASE + "/" } });
  if (!r.ok) throw kino.error("unavailable", "la agenda respondió " + r.status);
  return parsearAgenda(r.text()).filter((e) => e.opciones.length);
}

// "Copa Libertadores: Estudiantes LP vs Flamengo" -> { competicion, partido }. Sin ":", la
// competición es el tipo (AR, COL…) que el sitio le puso al evento.
export function separarEvento(evento, tipo) {
  const i = evento.indexOf(": ");
  return i > 0
    ? { competicion: evento.slice(0, i), partido: evento.slice(i + 2) }
    : { competicion: tipo || "Otros", partido: evento };
}

// Competiciones en el orden en que aparecen, cada una con sus eventos.
export function agruparPorCompeticion(eventos) {
  const grupos = new Map();
  for (const e of eventos) {
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
const tituloEvento = (e, tz) => {
  const hora = convertirHora(e.hora, tz);
  return (hora ? hora + " · " : "") + e.partido;
};

// El ref del canal lleva todas sus señales, para resolver sin volver a pedir la agenda.
const refEvento = (e) => PREFIJO_EVENTO + JSON.stringify(e.opciones.map((o) => ({ n: o.texto, e: o.embed })));

const itemEvento = (e, tz) => ({
  id: idEvento(e),
  ref: refEvento(e),
  title: tituloEvento(e, tz),
  kind: "live",
  overview: e.evento,
  badges: e.tipo ? [e.tipo] : undefined,
});

// Una fila por competición; cada evento es una tarjeta live.
const filaDeGrupo = (g, tz) => ({ id: g.id, title: g.titulo, items: g.eventos.map((e) => itemEvento(e, tz)) });

// Inicio: una fila por competición.
export async function home() {
  const tz = zonaHoraria();
  const grupos = agruparPorCompeticion(await cargarAgenda());
  return grupos.slice(0, MAX_FILAS).map((g) => filaDeGrupo(g, tz));
}

// Sección propia (chip arriba de Inicio en el celular): pestaña "Todos" con una fila por competición y una
// pestaña por cada competición (Kino admite 8 pestañas como máximo).
const MAX_PESTANAS = 8;
export async function section({ tab }) {
  const tz = zonaHoraria();
  const grupos = agruparPorCompeticion(await cargarAgenda());
  const tabs = [
    { id: "todos", label: texto("Todos", "All") },
    ...grupos.slice(0, MAX_PESTANAS - 1).map((g) => ({ id: g.id, label: g.titulo.slice(0, 24) })),
  ];
  const grupo = grupos.find((g) => g.id === tab);
  const elegida = grupo ? tab : "todos";
  const rows = grupo ? [filaDeGrupo(grupo, tz)] : grupos.slice(0, MAX_FILAS).map((g) => filaDeGrupo(g, tz));
  return {
    tabs,
    tab: elegida,
    hero: {
      title: texto("Eventos en vivo", "Live events"),
      text: texto(
        `Agenda de alangulotv. Horas en UTC${tz >= 0 ? "+" : "−"}${Math.abs(tz)}; puedes cambiar la zona en los ajustes del plugin.`,
        `alangulotv schedule. Times in UTC${tz >= 0 ? "+" : "−"}${Math.abs(tz)}; you can change the zone in the plugin settings.`,
      ),
    },
    rows,
  };
}

// Pestaña "En vivo": cada competición es una categoría y sus eventos son los canales.
export async function liveCategories() {
  const grupos = agruparPorCompeticion(await cargarAgenda());
  return grupos.slice(0, 200).map((g) => ({ id: g.id, title: g.titulo, genre: "deportes" }));
}

export async function liveChannels({ categoryId }) {
  const tz = zonaHoraria();
  const grupos = agruparPorCompeticion(await cargarAgenda());
  const grupo = grupos.find((g) => g.id === categoryId);
  if (!grupo) return { items: [] };
  return {
    items: grupo.eventos.map((e, i) => ({
      id: idEvento(e),
      title: tituloEvento(e, tz),
      ref: refEvento(e),
      categoryId,
      number: i + 1,
    })),
  };
}

// --- resolve ---------------------------------------------------------------------------------------

export async function resolve(ref) {
  await Promise.resolve(); // Kino 0.9.49 y anteriores no atajan un throw antes del primer await
  return ref.startsWith(PREFIJO_EVENTO) ? resolverEvento(ref) : resolverSenal(ref);
}

// Un evento: prueba sus señales por prioridad y devuelve la primera que anda. Las demás van como copias
// con etiqueta (menú "Servidor"): Kino las resuelve solo si la persona las elige o si esta falla.
async function resolverEvento(ref) {
  let senales;
  try {
    senales = JSON.parse(ref.slice(PREFIJO_EVENTO.length)).map((s) => ({ n: String(s.n).slice(0, 48), e: String(s.e) }));
    if (!senales.length) throw new Error("sin señales");
  } catch {
    throw kino.error("not_found", "ref de evento inválido");
  }
  senales.sort((a, b) => prioridadDe(a.e) - prioridadDe(b.e));
  for (const [i, senal] of senales.entries()) {
    try {
      const stream = await resolverSenal(senal.e);
      return {
        ...stream,
        label: senal.n,
        alternatives: senales.filter((_, j) => j !== i).map((s) => ({ label: s.n, ref: s.e })),
      };
    } catch (e) {
      kino.log("señal descartada", new URL(senal.e).hostname, e.code);
    }
  }
  throw kino.error("unavailable", "ninguna señal respondió", {
    userMessage: texto(
      "No se pudo abrir ninguna señal de este evento ahora. Prueba de nuevo más tarde.",
      "None of this event's signals could be opened right now. Try again later.",
    ),
  });
}

function prioridadDe(embed) {
  try {
    return extractorDe(embed).prioridad;
  } catch {
    return 99;
  }
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
  return extractorDe(embed.href).extraer(embed.href);
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

// agenda.php: <li class="TIPO"><a href="#">Evento <span class="t">hora</span></a><ul>
//   <li><a href="/eventos.html?r=BASE64">Opción <span>Calidad</span></a></li>…</ul></li>
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
    });
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
