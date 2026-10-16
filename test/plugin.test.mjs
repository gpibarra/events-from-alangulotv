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
let fallaAgenda = false;

globalThis.kino = {
  lang: "es-CO",
  log: () => {},
  config: { get: (clave) => ajustes[clave] },
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
  home, resolve, action, AJUSTES_A_VACIAR, ordenarParaTodos, parsearAgenda, liveCategories, liveChannels, separarEvento, agruparPorCompeticion,
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

test("resolve de un evento: prueba primero las señales que andan y deja spf24live al final", async () => {
  capturas = [];
  const filas = await home();
  const s = await resolve(filas[0].items[0].ref); // TNT Sports (spf24live), Op2 (latamzy), Op3 (sudamericafy)
  assert.deepEqual(capturas.map((c) => new URL(c.url).hostname), ["latamzy.com"]); // una sola captura
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.deepEqual(s.headers, { Referer: "https://p.example/", "User-Agent": "UA" });
  assert.equal(s.label, "TNT Sports Op2 Calidad 720p");
  assert.deepEqual(s.alternatives.map((a) => a.label), ["TNT Sports Op3 Calidad 720p", "TNT Sports Calidad 720p"]);
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
    assert.equal(items.filter((i) => i.title.endsWith("(sin señal aún)")).length, 14);
    assert.equal(items[0].title, "10:15 · Liga Profesional Saudí: Al Quadisiya vs Abha"); // 14:15 UTC+1 -> UTC-3
    assert.ok(items.slice(1).every((i) => i.title.endsWith("(sin señal aún)")), "los sin señal van al final");
    const cats = await liveCategories();
    assert.equal(cats.length, 12); // Todos + 11 competiciones
    assert.equal(cats[0].title, "Todos");
  } finally {
    agendaActiva = agenda;
  }
});

test("ordenarParaTodos: los que tienen señal primero y el orden de la agenda se conserva", () => {
  const e = (n, senales) => ({ evento: n, opciones: new Array(senales).fill({}) });
  assert.deepEqual(ordenarParaTodos([e("a", 0), e("b", 1), e("c", 0), e("d", 2)]).map((x) => x.evento), ["b", "d", "a", "c"]);
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
