// AlAnguloTV: la agenda de alangulotv como canales en vivo.
// Cada opción de un evento es un ítem live cuyo ref es la URL del embed; resolve abre ese embed
// en el navegador oculto de Kino y devuelve la primera petición de video que hace la página.
// Único lugar con el dominio de la agenda. Si cambia, se cambia aquí y en "hosts" de kino-plugin.json
// (un JSON no puede leerlo; un test comprueba que ambos coincidan).
export const BASE = "https://alangulotv.sx";
const AGENDA = BASE + "/agenda.php";
const MIME_HLS = "application/vnd.apple.mpegurl";
const MAX_FILAS = 20;

// Un extractor por dominio del embed. Si el método de uno cambia, se escribe otra función con la
// misma firma (embed) => Stream y se apunta aquí. Un dominio sin entrada usa extraerPorRed.
const EXTRACTORES = {
  "spf24live.st": extraerPorRed,
  "latamzy.com": extraerPorRed,
  "sudamericafy.com": extraerPorRed,
};

async function cargarAgenda() {
  const r = await kino.fetch(AGENDA, { headers: { Referer: BASE + "/" } });
  if (!r.ok) throw kino.error("unavailable", "la agenda respondió " + r.status);
  return parsearAgenda(r.text()).filter((e) => e.opciones.length);
}

const idEvento = (e) => "ev-" + hash(e.evento);
const idOpcion = (o) => "op-" + hash(o.embed);
const tituloEvento = (e) => (e.hora ? e.hora + " · " : "") + e.evento;

// Inicio: una fila por evento, con una tarjeta live por cada opción de señal.
export async function home() {
  const eventos = await cargarAgenda();
  return eventos.slice(0, MAX_FILAS).map((e) => ({
    id: idEvento(e),
    title: tituloEvento(e),
    items: e.opciones.map((o) => ({
      id: idOpcion(o),
      ref: o.embed,
      title: o.texto,
      kind: "live",
      overview: e.evento,
      badges: e.tipo ? [e.tipo] : undefined,
    })),
  }));
}

// Pestaña "En vivo": cada evento es una categoría y sus opciones son los canales.
export async function liveCategories() {
  const eventos = await cargarAgenda();
  return eventos.slice(0, 200).map((e) => ({ id: idEvento(e), title: tituloEvento(e), genre: "deportes" }));
}

export async function liveChannels({ categoryId }) {
  const eventos = await cargarAgenda();
  const evento = eventos.find((e) => idEvento(e) === categoryId);
  if (!evento) return { items: [] };
  return {
    items: evento.opciones.map((o, i) => ({
      id: idOpcion(o),
      title: o.texto,
      ref: o.embed,
      categoryId,
      number: i + 1,
    })),
  };
}

export async function resolve(ref) {
  await Promise.resolve(); // Kino 0.9.49 y anteriores no atajan un throw antes del primer await
  let embed;
  try {
    embed = new URL(ref);
  } catch {
    throw kino.error("not_found", "ref inválido");
  }
  kino.log("resolve", embed.hostname);
  const extraer = EXTRACTORES[embed.hostname] ?? extraerPorRed;
  return extraer(embed.href);
}

// Método "red": la página arma el reproductor con sus scripts, así que se abre oculta y se toma la
// petición .m3u8. Los headers que devuelve (Referer, User-Agent…) hay que pasarlos al reproductor.
async function extraerPorRed(embed) {
  let captura;
  try {
    captura = await kino.browser.capture(embed, {
      headers: { Referer: BASE + "/" },
      timeoutMs: 20000,
      match: "\\.m3u8",
    });
  } catch (e) {
    kino.log("captura falló", new URL(embed).hostname, e.code, e.message);
    throw kino.error("unavailable", "captura " + (e.code || "falló"), {
      userMessage: String(kino.lang).startsWith("en")
        ? "This signal could not be opened right now. Try another option of the event."
        : "No se pudo abrir esta señal ahora. Prueba otra opción del evento.",
    });
  }
  kino.log("captura ok", new URL(embed).hostname, captura.media.length + " medios");
  const medio = captura.media.find((m) => /\.m3u8/i.test(m.url)) ?? captura.media[0];
  if (!medio) throw kino.error("not_found", "la página no pidió video");
  return { url: medio.url, mime: MIME_HLS, headers: medio.headers };
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
