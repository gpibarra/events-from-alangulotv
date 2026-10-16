import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agenda = readFileSync(new URL("./agenda.fixture.html", import.meta.url), "utf8");
// Una agenda real de otro día: 15 eventos, de los que solo 1 tiene señales (el sitio las publica de a poco).
const agendaSinSenales = readFileSync(new URL("./agenda-sin-senales.fixture.html", import.meta.url), "utf8");
const agendaVacia = "<ul class=\"menu\"><b>Agenda - Viernes</b></ul>";
let agendaActiva = agenda;
const pedidos = [];
let capturas = [];
let ajustes = {};
let almacen = {};
// La hora de ahora se fija: por defecto, las 07:00 (UTC+1) del 16 de octubre de 2026, antes de todos los eventos de la agenda de ese día.
const AHORA_POR_DEFECTO = Date.UTC(2026, 9, 16, 6, 0);
let ahora = AHORA_POR_DEFECTO;
Date.now = () => ahora;
let fallaAgenda = false;

globalThis.kino = {
  lang: "es-CO",
  log: () => {},
  config: { get: (clave) => ajustes[clave] },
  storage: { get: (k) => (k in almacen ? almacen[k] : null), set: (k, v) => { almacen[k] = v; } },
  error: (code, message, options) => Object.assign(new Error(message), { code, options }),
  fetch: async (url, options) => {
    pedidos.push({ url, options });
    if (fallaAgenda) return { ok: false, status: 503, text: () => "" };
    return { ok: true, status: 200, text: () => agendaActiva };
  },
  browser: {
    capture: async (url, options) => {
      capturas.push({ url, options });
      if (url.includes("falla") || url.includes("spf24live")) throw Object.assign(new Error("x"), { code: "timeout" });
      if (url.includes("vacio")) return { media: [], subtitles: [], finalUrl: url };
      return {
        media: [
          { url: "https://cdn.example/a.mp4", headers: {} },
          { url: "https://cdn.example/x.m3u8?t=1", headers: { Referer: "https://p.example/", "User-Agent": "UA" } },
        ],
        subtitles: [],
        finalUrl: url,
      };
    },
  },
};

const {
  home, resolve, action, AJUSTES_A_VACIAR, ordenarEventos, ordenEtiquetas, duracionHoras, mapaDeEtiquetas, paginasDelMapa, iconosDeAgenda, etiquetasDelSitio, parsearAgenda, liveCategories, liveChannels, separarEvento, agruparPorCompeticion,
  convertirHora, BASE, VERSION,
} = await import("../plugin.js");
const manifiesto = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const ID_VALIDO = /^[A-Za-z0-9._~-]{1,128}$/;

test("parsearAgenda: eventos, hora, tipo y embeds decodificados", () => {
  const eventos = parsearAgenda(agenda);
  assert.equal(eventos.length, 3);
  assert.equal(eventos.flatMap((x) => x.opciones).length, 11);
  const e = eventos[0];
  assert.equal(e.tipo, "AR");
  assert.equal(e.hora, "00:00");
  assert.equal(e.evento, "Liga Profesional: Huracán vs Gimnasia La Plata");
  assert.deepEqual(e.opciones.map((o) => o.texto), [
    "TNT Sports Calidad 720p", "TNT Sports Op2 Calidad 720p", "TNT Sports Op3 Calidad 720p",
  ]);
  assert.equal(e.opciones[0].embed, "https://spf24live.st/channels/ch8.php");
  assert.equal(e.opciones[1].embed, "https://latamzy.com/global1.php?stream=tntsports");
});

test("separarEvento: la competición es el texto antes de los dos puntos", () => {
  assert.deepEqual(separarEvento("Copa Libertadores: Estudiantes LP vs Flamengo", "LIB"), {
    competicion: "Copa Libertadores", partido: "Estudiantes LP vs Flamengo",
  });
  assert.deepEqual(separarEvento("Partido sin competición", "AR"), { competicion: "AR", partido: "Partido sin competición" });
});

test("agruparPorCompeticion: junta los eventos de una misma competición, en orden", () => {
  const e = (evento, tipo) => ({ evento, tipo, hora: "00:00", opciones: [] });
  const grupos = agruparPorCompeticion([e("Liga: A vs B", "AR"), e("Copa: C vs D", "COL"), e("Liga: E vs F", "AR")]);
  assert.deepEqual(grupos.map((g) => [g.titulo, g.eventos.map((x) => x.partido)]), [
    ["Liga", ["A vs B", "E vs F"]],
    ["Copa", ["C vs D"]],
  ]);
});

test("convertirHora: la agenda viene en UTC+1", () => {
  assert.equal(convertirHora("00:00", -3), "20:00");
  assert.equal(convertirHora("01:30", -3), "21:30");
  assert.equal(convertirHora("00:00", 1), "00:00");
  assert.equal(convertirHora("23:30", 3), "01:30"); // cruza la medianoche hacia adelante
  assert.equal(convertirHora("10:05", -5), "04:05");
  assert.equal(convertirHora(null, -3), null);
  assert.equal(convertirHora("a las 9", -3), "a las 9");
});

test("home: una sola fila \"Todos los eventos\", con la competición en el título", async () => {
  ajustes = {};
  const filas = await home();
  assert.equal(pedidos.at(-1).url, BASE + "/agenda.php");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].title, "Todos los eventos");
  const items = filas[0].items;
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
  for (const id of [...items.map((i) => i.id), filas[0].id]) assert.match(id, ID_VALIDO);
  assert.ok(items.every((i) => i.kind === "live" && i.ref.startsWith("evt:") && i.ref.length < 64));
  assert.equal(items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata"); // UTC-3 por defecto
});

test("zona horaria: por defecto -3, el ajuste tz la cambia y un valor inválido se ignora", async () => {
  ajustes = { tz: "-5" };
  assert.equal((await home())[0].items[0].title, "18:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  ajustes = { tz: "basura" };
  assert.equal((await home())[0].items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  ajustes = { tz: "99" };
  assert.equal((await home())[0].items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  ajustes = {};
});

test("manifiesto: el ajuste tz es un select con default -3 y su default es una de sus opciones", () => {
  const tz = manifiesto.settings.find((s) => s.key === "tz");
  assert.equal(tz.type, "select");
  assert.equal(tz.default, "-3");
  assert.ok(tz.options.some((o) => o.value === tz.default));
  assert.ok(tz.options.length <= 20);
  assert.ok(tz.hint.length <= 80);
});

test("action actualizar: lee la agenda y vacía solo la bandera `forzar`, nunca la zona horaria", async () => {
  fallaAgenda = false;
  const r = await action("actualizar");
  assert.deepEqual(r.clearSettings, ["forzar"]);
  assert.ok(!r.clearSettings.includes("tz") && !AJUSTES_A_VACIAR.includes("tz"));
  assert.match(r.message, /3 eventos \(3 con señal\) en 3 competiciones/);
  assert.ok(r.message.length <= 300);
});

test("action: si la agenda no se puede leer, lanza error y no vacía nada", async () => {
  fallaAgenda = true;
  await assert.rejects(action("actualizar"), (e) => e.code === "unavailable");
  fallaAgenda = false;
});

test("action: una clave desconocida no vacía nada", async () => {
  const r = await action("otra");
  assert.equal(r.clearSettings, undefined);
});

test("manifiesto: el botón y la bandera existen y la bandera es un toggle sin default propio", () => {
  const por = Object.fromEntries(manifiesto.settings.map((x) => [x.key, x]));
  assert.equal(por.actualizar.type, "action");
  assert.equal(por.forzar.type, "toggle");
  assert.ok(AJUSTES_A_VACIAR.every((k) => por[k] && por[k].type !== "action" && por[k].type !== "section"));
  assert.ok(manifiesto.settings.every((x) => x.label.length <= 40 && (!x.hint || x.hint.length <= 80)));
});

test("En vivo: categoría \"Todos\" primero, luego una por competición, y un canal por evento", async () => {
  const cats = await liveCategories();
  assert.deepEqual(cats.map((c) => c.title), ["Todos", "Liga Profesional", "Copa Colombia", "Copa Libertadores"]);
  assert.ok(cats.every((c) => c.genre === "deportes" && ID_VALIDO.test(c.id)));
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  const todos = (await liveChannels({ categoryId: cats[0].id })).items;
  assert.equal(todos.length, 3);
  assert.equal(todos[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  const { items } = await liveChannels({ categoryId: cats[1].id });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "20:00 · Huracán vs Gimnasia La Plata");
  assert.equal(items[0].categoryId, cats[1].id);
  assert.match(items[0].ref, /^evt:/);
  assert.equal(items[0].id, todos[0].id); // el mismo evento tiene el mismo id en "Todos" y en su competición
  assert.deepEqual((await liveChannels({ categoryId: "no-existe" })).items, []);
});

test("resolve de un evento: prueba las señales en el orden de la agenda y pasa a la siguiente si una falla", async () => {
  capturas = [];
  const filas = await home();
  const s = await resolve(filas[0].items[0].ref); // TNT Sports (spf24live, el mock la hace fallar), Op2 (latamzy), Op3 (sudamericafy)
  assert.deepEqual(capturas.map((c) => new URL(c.url).hostname), ["spf24live.st", "latamzy.com"]); // primero la de la agenda, luego la siguiente
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.deepEqual(s.headers, { Referer: "https://p.example/", "User-Agent": "UA" });
  assert.equal(s.label, "TNT Sports Op2 Calidad 720p");
  assert.deepEqual(s.alternatives.map((a) => a.label), ["TNT Sports Calidad 720p", "TNT Sports Op3 Calidad 720p"]);
  assert.ok(s.alternatives.every((a) => a.ref.startsWith("https://") && a.ref.length <= 512));
});

test("resolve de un ref anterior (JSON): si una señal falla pasa a la siguiente", async () => {
  capturas = [];
  const ref = "ev:" + JSON.stringify([
    { n: "Rota", e: "https://latamzy.com/falla" },
    { n: "Buena", e: "https://sudamericafy.com/global1.php?stream=x" },
  ]);
  const s = await resolve(ref);
  assert.equal(capturas.length, 2);
  assert.equal(s.label, "Buena");
  assert.deepEqual(s.alternatives.map((a) => a.label), ["Rota"]);
});

test("resolve de un ref anterior (JSON): si ninguna señal anda, error con mensaje para la persona", async () => {
  const ref = "ev:" + JSON.stringify([{ n: "Rota", e: "https://latamzy.com/falla" }]);
  await assert.rejects(resolve(ref), (e) => e.code === "unavailable" && !!e.options.userMessage);
});

test("resolve de una copia (un embed): abre el embed con Referer y devuelve el m3u8", async () => {
  capturas = [];
  const s = await resolve("https://latamzy.com/global1.php?stream=espn");
  assert.equal(capturas[0].url, "https://latamzy.com/global1.php?stream=espn");
  assert.equal(capturas[0].options.headers.Referer, BASE + "/");
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.equal(s.alternatives, undefined);
});

test("resolve: spf24live.st no manda Referer (su iframe lo rechazaría)", async () => {
  capturas = [];
  await assert.rejects(resolve("https://spf24live.st/channels/ch8.php")); // el mock lo hace fallar
  assert.equal(capturas[0].options.headers, undefined);
});

test("resolve: errores tipados y ref inválido", async () => {
  await assert.rejects(resolve("https://latamzy.com/falla"), (e) => e.code === "unavailable" && !!e.options.userMessage);
  await assert.rejects(resolve("https://latamzy.com/vacio"), (e) => e.code === "not_found");
  await assert.rejects(resolve("no es una url"), (e) => e.code === "not_found");
  await assert.rejects(resolve("ev:{no es json"), (e) => e.code === "not_found");
  await assert.rejects(resolve("ev:[]"), (e) => e.code === "not_found");
});

test("el dominio de BASE está declarado en los hosts del manifiesto", () => {
  const { hostname } = new URL(BASE);
  assert.ok(manifiesto.hosts.includes(hostname), `${hostname} falta en hosts`);
  assert.ok(manifiesto.hosts.includes("*." + hostname), `*.${hostname} falta en hosts`);
});

test("package.json y kino-plugin.json tienen la misma versión", () => {
  const paquete = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(paquete.version, manifiesto.version);
});

test("VERSION de plugin.js coincide con kino-plugin.json", () => {
  assert.equal(VERSION, manifiesto.version);
});

test("agenda con eventos sin señal: se muestran todos, los que tienen señal primero, y solo esos son abribles", async () => {
  agendaActiva = agendaSinSenales;
  try {
    ajustes = {};
    const filas = await home();
    assert.equal(filas.length, 1);
    const items = filas[0].items;
    assert.equal(items.length, 15);
    assert.equal(new Set(items.map((i) => i.id)).size, 15);
    assert.ok(items.every((i) => !/sin señal|no signal/.test(i.title)), "el título no lleva aviso");
    assert.equal(items[0].title, "10:15 · Liga Profesional Saudí: Al Quadisiya vs Abha"); // 14:15 UTC+1 -> UTC-3
    const cats = await liveCategories();
    assert.equal(cats.length, 12); // Todos + 11 competiciones
    assert.equal(cats[0].title, "Todos");
  } finally {
    agendaActiva = agenda;
  }
});

test("ordenarEventos sin hora: con señal antes que sin señal y la agenda se conserva en los empates", () => {
  const e = (n, senales) => ({ evento: n, opciones: new Array(senales).fill({}) });
  assert.deepEqual(ordenarEventos([e("a", 0), e("b", 1), e("c", 0), e("d", 2)]).map((x) => x.evento), ["b", "d", "a", "c"]);
});

test("límites: la fila de Inicio se corta en 60 y En vivo \"Todos\" lista todos", async () => {
  const evento = (n) => `<li class="AR"><a href="#">Liga: Equipo ${n} vs Rival ${n}<span class="t">10:00</span></a><ul>\n</ul>\n</li>`;
  agendaActiva = `<ul class="menu">${Array.from({ length: 70 }, (_, i) => evento(i)).join("\n")}</ul>`;
  try {
    const filas = await home();
    assert.equal(filas[0].items.length, 60);
    assert.equal(new Set(filas[0].items.map((i) => i.id)).size, 60);
    const cats = await liveCategories();
    assert.deepEqual(cats.map((c) => c.title), ["Todos", "Liga"]);
    assert.equal((await liveChannels({ categoryId: "todos" })).items.length, 70);
    assert.equal((await liveChannels({ categoryId: cats[1].id })).items.length, 70);
  } finally {
    agendaActiva = agenda;
  }
});

test("resolve por id: relee la agenda y usa las señales de ese momento", async () => {
  agendaActiva = agendaSinSenales;
  try {
    const saudi = (await home()).flatMap((f) => f.items).find((i) => i.title.includes("Al Quadisiya"));
    const antes = pedidos.length;
    capturas = [];
    const s = await resolve(saudi.ref);
    assert.ok(pedidos.length > antes, "debe volver a pedir la agenda");
    assert.equal(pedidos.at(-1).url, BASE + "/agenda.php");
    assert.equal(new URL(capturas[0].url).hostname, "sudamericafy.com");
    assert.equal(s.label, "Fox Deportes Calidad 720p");
    assert.equal(s.alternatives.length, 1);
  } finally {
    agendaActiva = agenda;
  }
});

test("resolve por id: un evento sin señal responde con un mensaje claro y no abre el navegador", async () => {
  agendaActiva = agendaSinSenales;
  try {
    const sin = (await home()).flatMap((f) => f.items).find((i) => i.title.includes("Sport Huancayo"));
    capturas = [];
    await assert.rejects(resolve(sin.ref), (e) => e.code === "not_found" && /Todavía no hay señal/.test(e.options.userMessage));
    assert.equal(capturas.length, 0);
  } finally {
    agendaActiva = agenda;
  }
});

test("resolve por id: un evento que ya no está en la agenda -> not_found con mensaje", async () => {
  agendaActiva = agendaSinSenales;
  try {
    const item = (await home()).flatMap((f) => f.items)[0];
    agendaActiva = agenda; // al día siguiente el evento ya no existe
    await assert.rejects(resolve(item.ref), (e) => e.code === "not_found" && !!e.options.userMessage);
  } finally {
    agendaActiva = agenda;
  }
});

test("action: con eventos sin señal los cuenta; con la agenda vacía avisa y no vacía nada", async () => {
  agendaActiva = agendaSinSenales;
  try {
    const r = await action("actualizar");
    assert.match(r.message, /15 eventos \(1 con señal\)/);
    assert.deepEqual(r.clearSettings, ["forzar"]);
    agendaActiva = agendaVacia;
    const v = await action("actualizar");
    assert.match(v.message, /No hay eventos en la agenda de hoy/);
    assert.equal(v.clearSettings, undefined);
    assert.deepEqual(await home(), []);
  } finally {
    agendaActiva = agenda;
  }
});

test("ordenEtiquetas: lista separada por comas, sin espacios ni mayúsculas, vacía por defecto", () => {
  ajustes = {};
  assert.deepEqual(ordenEtiquetas(), []);
  ajustes = { orden: "" };
  assert.deepEqual(ordenEtiquetas(), []);
  ajustes = { orden: " ar , lib ,, SUD " };
  assert.deepEqual(ordenEtiquetas(), ["AR", "LIB", "SUD"]);
  ajustes = { orden: 5 };
  assert.deepEqual(ordenEtiquetas(), []);
  ajustes = {};
});

test("ordenarEventos con etiquetas: las nombradas primero y el resto en el orden de la agenda", () => {
  const e = (n, tipo, senales = 1) => ({ evento: n, tipo, opciones: new Array(senales).fill({}) });
  const ctx = (orden) => ({ orden, ahora: -Infinity, duracionMs: 0 });
  const lista = [e("a", "COL"), e("b", "AR"), e("c", "PE"), e("d", "LIB"), e("e", "AR", 0), e("f", "SUD")];
  assert.deepEqual(ordenarEventos(lista, ctx(["AR", "LIB", "SUD"])).map((x) => x.evento), ["b", "e", "d", "f", "a", "c"]);
  assert.deepEqual(ordenarEventos(lista, ctx([])).map((x) => x.evento), ["a", "b", "c", "d", "f", "e"]); // sin orden: con señal antes en los empates
  assert.deepEqual(ordenarEventos(lista, ctx(["AR"])).map((x) => x.evento), ["b", "e", "a", "c", "d", "f"]);
});

test("parsearAgenda: inicioMs sale de la fecha de la cabecera, la hora en UTC+1 y el cambio de día", () => {
  const ev = parsearAgenda(agendaSinSenales);
  assert.equal(ev[0].inicioMs, Date.UTC(2026, 9, 16, 13, 15)); // 14:15 UTC+1
  const boca = ev.find((x) => x.evento.includes("Boca Juniors"));
  assert.equal(boca.inicioMs, Date.UTC(2026, 9, 17, 0, 30)); // 01:30 UTC+1 ya es el día siguiente
  assert.ok(ev.every((x, i) => i === 0 || x.inicioMs >= ev[i - 1].inicioMs), "la agenda queda en orden cronológico");
  assert.equal(parsearAgenda("<ul class=\"menu\"></ul>").length, 0);
  // sin fecha en la cabecera no se puede saber si ya terminó
  const sinFecha = agendaSinSenales.replace(/Agenda - [^<]*/, "Agenda");
  assert.ok(parsearAgenda(sinFecha).every((x) => x.inicioMs === null));
});

test("ordenarEventos: los que ya terminaron (inicio + duración) van al final, y el resto por hora", () => {
  const ev = parsearAgenda(agendaSinSenales);
  const nombres = (ctx) => ordenarEventos(ev, ctx).map((x) => x.evento.split(": ")[1]);
  const base = { orden: [], duracionMs: 3 * 3600000 };
  // 19:00 en UTC-3 = 22:00 UTC: terminaron los que empezaron hasta las 19:00 UTC (hora local 16:00 o antes)
  const tarde = nombres({ ...base, ahora: Date.UTC(2026, 9, 16, 22, 0) });
  assert.equal(tarde[0], "Los Chankas vs ADT"); // 17:30 locales, aún no terminó
  assert.equal(tarde.indexOf("Al Quadisiya vs Abha"), 8); // 10:15 locales: terminó, va tras los 8 que siguen
  assert.deepEqual(tarde.slice(8, 10), ["Al Quadisiya vs Abha", "Sport Huancayo vs Cusco"]); // los terminados, por hora
  assert.equal(tarde.length, 15);
  // justo cuando se cumplen las 3 h cuenta como terminado
  const justo = nombres({ ...base, ahora: Date.UTC(2026, 9, 16, 16, 15) });
  assert.equal(justo.at(-1), "Al Quadisiya vs Abha");
  const antes = nombres({ ...base, ahora: Date.UTC(2026, 9, 16, 16, 14) });
  assert.equal(antes[0], "Al Quadisiya vs Abha");
  // sin terminados el orden es el de la agenda
  assert.deepEqual(nombres({ ...base, ahora: Date.UTC(2026, 9, 16, 6, 0) }), ev.map((x) => x.evento.split(": ")[1]));
});

test("las etiquetas mandan después de lo terminado: un AR que terminó va tras los no terminados", () => {
  const ev = parsearAgenda(agendaSinSenales);
  const ctx = { orden: ["ARA"], ahora: Date.UTC(2026, 9, 16, 22, 0), duracionMs: 3 * 3600000 };
  const lista = ordenarEventos(ev, ctx).map((x) => x.tipo);
  assert.notEqual(lista[0], "ARA"); // el ARA ya terminó
  assert.equal(lista.indexOf("ARA"), 8); // y es el primero de los terminados
});

test("duracionHoras: por defecto 3, acepta coma decimal y vuelve a 3 si el valor no vale", () => {
  const con = (v) => { ajustes = v === undefined ? {} : { duracion: v }; return duracionHoras(); };
  assert.equal(con(undefined), 3);
  assert.equal(con("3"), 3);
  assert.equal(con("2,5"), 2.5);
  assert.equal(con("1.5"), 1.5);
  assert.equal(con("0"), 3);
  assert.equal(con("99"), 3);
  assert.equal(con("mucho"), 3);
  assert.equal(con(""), 3);
  ajustes = {};
});

test("Inicio y En vivo usan la hora de ahora y la duración del ajuste", async () => {
  agendaActiva = agendaSinSenales;
  try {
    ahora = Date.UTC(2026, 9, 16, 22, 0); // las 19:00 en UTC-3
    ajustes = {};
    const items = (await home())[0].items;
    assert.ok(items[0].title.includes("Los Chankas"));
    assert.ok(items.at(-1).title.includes("Championship")); // el último de los terminados es el que más tarde empezó
    assert.equal(items[8].title.split(" (")[0], "10:15 · Liga Profesional Saudí: Al Quadisiya vs Abha");
    const cats = await liveCategories();
    assert.deepEqual(cats.slice(0, 4).map((c) => c.title), ["Todos", "Liga 1", "Liga Profesional", "Primera División"]);
    assert.equal(cats.at(-1).title, "Championship");
    // con una duración de 12 h nada ha terminado y vuelve el orden de la agenda
    ajustes = { duracion: "12" };
    assert.ok((await home())[0].items[0].title.includes("Al Quadisiya"));
  } finally {
    ajustes = {};
    ahora = AHORA_POR_DEFECTO;
    agendaActiva = agenda;
  }
});

test("mapaDeEtiquetas: etiqueta -> competiciones, sin repetir, en el orden de la agenda", () => {
  const mapa = mapaDeEtiquetas(parsearAgenda(agendaSinSenales));
  assert.equal(mapa.length, 11);
  assert.ok(mapa.includes("AR: Liga Profesional"));
  assert.ok(mapa.includes("ARA: Liga Profesional Saudí"));
  assert.ok(mapa.includes("PE: Liga 1")); // dos eventos de Liga 1, una sola vez
  assert.equal(mapa[0], "ARA: Liga Profesional Saudí");
  const e = (n, tipo) => ({ evento: n, tipo, opciones: [] });
  assert.deepEqual(mapaDeEtiquetas([e("Liga: a vs b", "AR"), e("Copa Argentina: c vs d", "AR"), e("Liga: e vs f", "AR")]), ["AR: Liga, Copa Argentina"]);
});

test("paginasDelMapa: reparte en páginas que caben en el límite", () => {
  const entradas = Array.from({ length: 30 }, (_, i) => `ET${i}: Competición número ${i}`);
  const paginas = paginasDelMapa(entradas, 100);
  assert.ok(paginas.length > 1);
  assert.ok(paginas.every((p) => p.length <= 100));
  assert.deepEqual(paginas.join("\n").split("\n"), entradas); // no se pierde ni se repite nada
  assert.deepEqual(paginasDelMapa([], 100), []);
  assert.ok(paginasDelMapa(["x".repeat(500)], 100)[0].length <= 100);
});

test("action mapa: muestra el mapa, no vacía nada y cicla las páginas cuando son varias", async () => {
  almacen = {};
  agendaActiva = agendaSinSenales;
  try {
    const r = await action("mapa");
    assert.match(r.message, /AR: Liga Profesional/);
    assert.match(r.message, /ARA: Liga Profesional Saudí/);
    assert.ok(r.message.length <= 300);
    assert.equal(r.clearSettings, undefined);
    // una agenda con muchas competiciones se reparte en páginas y cada pulsación muestra la siguiente
    const muchas = Array.from({ length: 25 }, (_, i) => `<li class="T${i}"><a href="#">Competición larga número ${i}: A vs B<span class="t">10:00</span></a><ul>\n</ul>\n</li>`).join("\n");
    agendaActiva = `<ul class="menu"><b>Agenda - Viernes 16 de Octubre de 2026</b>${muchas}</ul>`;
    almacen = {};
    const p1 = await action("mapa");
    const p2 = await action("mapa");
    assert.match(p1.message, /\(1\/\d+\)/);
    assert.match(p2.message, /\(2\/\d+\)/);
    assert.ok(p1.message.length <= 300 && p2.message.length <= 300);
    assert.notEqual(p1.message, p2.message);
    // sin eventos
    agendaActiva = agendaVacia;
    assert.match((await action("mapa")).message, /No hay eventos/);
  } finally {
    almacen = {};
    agendaActiva = agenda;
  }
});

test("manifiesto: duración (texto, 3 por defecto) y botón del mapa", () => {
  const por = Object.fromEntries(manifiesto.settings.map((x) => [x.key, x]));
  assert.equal(por.duracion.type, "text");
  assert.equal(por.duracion.default, "3");
  assert.equal(por.mapa.type, "action");
  assert.ok(!AJUSTES_A_VACIAR.includes("mapa") && !AJUSTES_A_VACIAR.includes("duracion"));
  const conValor = manifiesto.settings.filter((x) => !["section", "status", "action"].includes(x.type));
  assert.ok(conValor.length <= 12);
  assert.equal(new Set(manifiesto.settings.map((x) => x.key)).size, manifiesto.settings.length);
});
test("orden de etiquetas en Inicio y En vivo: Todos y las competiciones siguen el ajuste", async () => {
  agendaActiva = agendaSinSenales;
  try {
    ajustes = { orden: "MEX,AR" };
    const items = (await home())[0].items;
    assert.deepEqual(items.slice(0, 5).map((i) => i.badges[0]), ["MEX", "MEX", "MEX", "AR", "AR"]);
    const cats = await liveCategories();
    assert.deepEqual(cats.slice(0, 4).map((c) => c.title), ["Todos", "Liga MX", "Liga Profesional", "Liga Profesional Saudí"]);
    const todos = (await liveChannels({ categoryId: "todos" })).items;
    assert.ok(todos[0].title.includes("Liga MX"));
    assert.equal(todos.length, 15);
    const mx = (await liveChannels({ categoryId: cats[1].id })).items;
    assert.equal(mx.length, 3);
    ajustes = {};
    const sinOrden = (await home())[0].items;
    assert.ok(sinOrden[0].title.includes("Al Quadisiya")); // con señal primero, como antes
  } finally {
    ajustes = {};
    agendaActiva = agenda;
  }
});

test("manifiesto: el ajuste orden es un texto sin valor por defecto", () => {
  const orden = manifiesto.settings.find((x) => x.key === "orden");
  assert.equal(orden.type, "text");
  assert.equal(orden.default, undefined);
  assert.ok(orden.label.length <= 40 && orden.hint.length <= 80);
  assert.ok(!AJUSTES_A_VACIAR.includes("orden"));
});

test("iconosDeAgenda: lee del CSS de la agenda la imagen de cada etiqueta", () => {
  const iconos = iconosDeAgenda(agendaSinSenales);
  assert.equal(Object.keys(iconos).length, 39);
  assert.equal(iconos.AR, "https://tvtveshd.com/iconos/argentina.png");
  assert.equal(iconos.LIB, "https://tvtveshd.com/iconos/libertadore.png");
  assert.equal(iconos.SUD, "https://tvtveshd.com/iconos/sudamericana.png");
  assert.equal(iconos.UEFA, "https://tvtveshd.com/iconos/uefa%20hd.png"); // el espacio se codifica
  assert.ok(Object.values(iconos).every((u) => /^https:\/\/\S+$/.test(u) && u.length <= 2048));
  // la agenda del 14 también trae el CSS
  assert.equal(Object.keys(iconosDeAgenda(agenda)).length, 39);
  assert.deepEqual(iconosDeAgenda("<ul></ul>"), {});
  // solo https, comillas opcionales
  const css = `.A > a:before { background-image: url("https://x.test/a.png") } .B > a:before { background-image: url(http://x.test/b.png) } .C > a:before { background-image: url('https://x.test/c d.png') }`;
  assert.deepEqual(iconosDeAgenda(css), { A: "https://x.test/a.png", C: "https://x.test/c%20d.png" });
});

test("miniaturas: poster en las tarjetas de Inicio y logo en los canales de En vivo, según la etiqueta", async () => {
  agendaActiva = agendaSinSenales;
  try {
    ajustes = {};
    const items = (await home())[0].items;
    const por = (txt) => items.find((i) => i.title.includes(txt));
    assert.equal(por("Al Quadisiya").poster, "https://tvtveshd.com/iconos/arabia.png"); // ARA
    assert.equal(por("Boca Juniors").poster, "https://tvtveshd.com/iconos/argentina.png"); // AR
    assert.equal(por("Necaxa").poster, "https://tvtveshd.com/iconos/mexico.png"); // MEX
    assert.ok(items.every((i) => /^https:\/\//.test(i.poster)));
    const canales = (await liveChannels({ categoryId: "todos" })).items;
    assert.equal(canales.find((c) => c.title.includes("Boca Juniors")).logo, "https://tvtveshd.com/iconos/argentina.png");
    assert.ok(canales.every((c) => /^https:\/\//.test(c.logo)));
    // una etiqueta sin imagen no lleva miniatura
    agendaActiva = `<style>.AR > a:before { background-image: url(https://x.test/ar.png) }</style><ul class="menu"><b>Agenda - Viernes 16 de Octubre de 2026</b>` +
      `<li class="AR"><a href="#">Liga: a vs b<span class="t">10:00</span></a><ul>\n</ul>\n</li><li class="ZZZ"><a href="#">Copa: c vs d<span class="t">11:00</span></a><ul>\n</ul>\n</li></ul>`;
    const dos = (await home())[0].items;
    assert.equal(dos[0].poster, "https://x.test/ar.png");
    assert.equal(dos[1].poster, undefined);
  } finally {
    agendaActiva = agenda;
  }
});

test("etiquetasDelSitio: etiqueta y nombre de su imagen, sin carpeta ni extensión", () => {
  const lista = etiquetasDelSitio({ LIB: "https://x.test/iconos/libertadore.png", UEFA: "https://x.test/iconos/uefa%20hd.png", FUT: "https://x.test/iconos/fut.webp" });
  assert.deepEqual(lista, ["LIB: libertadore", "UEFA: uefa hd", "FUT: fut"]);
});

test("action etiquetas: lista las 39 etiquetas del sitio en páginas de menos de 300 caracteres y las cicla", async () => {
  almacen = {};
  agendaActiva = agendaSinSenales;
  try {
    const paginas = [];
    for (let i = 0; i < 4; i++) {
      const r = await action("etiquetas");
      assert.ok(r.message.length <= 300, `página ${i + 1} mide ${r.message.length}`);
      assert.equal(r.clearSettings, undefined);
      paginas.push(r.message);
    }
    assert.match(paginas[0], /\(1\/3\)/);
    assert.match(paginas[2], /\(3\/3\)/);
    assert.equal(paginas[3], paginas[0]); // vuelve a la primera
    const todo = paginas.slice(0, 3).join(" · ");
    for (const etiqueta of ["TUR: turquia", "LIB: libertadore", "SUD: sudamericana", "ARA: arabia", "CONNAT: CONNAT"]) assert.ok(todo.includes(etiqueta), etiqueta);
    // la paginación de este botón y la del mapa no se pisan
    almacen = {};
    await action("etiquetas");
    assert.equal(almacen.mapaPagina, undefined);
    assert.ok("etiquetasPagina" in almacen);
    // sin CSS legible
    agendaActiva = agendaVacia;
    assert.match((await action("etiquetas")).message, /No pude leer las etiquetas/);
  } finally {
    almacen = {};
    agendaActiva = agenda;
  }
});

test("manifiesto: el botón de todas las etiquetas existe y no vacía ajustes", () => {
  const por = Object.fromEntries(manifiesto.settings.map((x) => [x.key, x]));
  assert.equal(por.etiquetas.type, "action");
  assert.ok(!AJUSTES_A_VACIAR.includes("etiquetas"));
  assert.ok(manifiesto.settings.every((x) => x.label.length <= 40 && (!x.hint || x.hint.length <= 80)));
});
