import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agenda = readFileSync(new URL("./agenda.fixture.html", import.meta.url), "utf8");
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
    return { ok: true, status: 200, text: () => agenda };
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
  home, resolve, action, AJUSTES_A_VACIAR, parsearAgenda, liveCategories, liveChannels, separarEvento, agruparPorCompeticion,
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

test("home: una fila por competición con un canal live por evento", async () => {
  ajustes = {};
  const filas = await home();
  assert.equal(pedidos.at(-1).url, BASE + "/agenda.php");
  assert.deepEqual(filas.map((f) => f.title), ["Liga Profesional", "Copa Colombia", "Copa Libertadores"]);
  const items = filas.flatMap((f) => f.items);
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
  for (const id of [...items.map((i) => i.id), ...filas.map((f) => f.id)]) assert.match(id, ID_VALIDO);
  assert.ok(items.every((i) => i.kind === "live" && i.ref.startsWith("ev:") && i.ref.length < 4096));
  assert.equal(items[0].title, "20:00 · Huracán vs Gimnasia La Plata"); // UTC-3 por defecto
});

test("zona horaria: por defecto -3, el ajuste tz la cambia y un valor inválido se ignora", async () => {
  ajustes = { tz: "-5" };
  assert.equal((await home())[0].items[0].title, "18:00 · Huracán vs Gimnasia La Plata");
  ajustes = { tz: "basura" };
  assert.equal((await home())[0].items[0].title, "20:00 · Huracán vs Gimnasia La Plata");
  ajustes = { tz: "99" };
  assert.equal((await home())[0].items[0].title, "20:00 · Huracán vs Gimnasia La Plata");
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
  assert.match(r.message, /3 eventos en 3 competiciones/);
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

test("En vivo: una categoría por competición y un canal por evento", async () => {
  const cats = await liveCategories();
  assert.deepEqual(cats.map((c) => c.title), ["Liga Profesional", "Copa Colombia", "Copa Libertadores"]);
  assert.ok(cats.every((c) => c.genre === "deportes" && ID_VALIDO.test(c.id)));
  const { items } = await liveChannels({ categoryId: cats[0].id });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "20:00 · Huracán vs Gimnasia La Plata");
  assert.equal(items[0].categoryId, cats[0].id);
  assert.match(items[0].ref, /^ev:/);
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

test("resolve de un evento: si una señal falla pasa a la siguiente", async () => {
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

test("resolve de un evento: si ninguna señal anda, error con mensaje para la persona", async () => {
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
