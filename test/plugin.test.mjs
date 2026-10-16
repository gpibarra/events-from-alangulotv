import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const agenda = readFileSync(new URL("./agenda.fixture.html", import.meta.url), "utf8");
const pedidos = [];
let capturas = [];

globalThis.kino = {
  lang: "es-CO",
  log: () => {},
  error: (code, message, options) => Object.assign(new Error(message), { code, options }),
  fetch: async (url, options) => {
    pedidos.push({ url, options });
    return { ok: true, status: 200, text: () => agenda };
  },
  browser: {
    capture: async (url, options) => {
      capturas.push({ url, options });
      if (url.includes("falla")) throw Object.assign(new Error("x"), { code: "timeout" });
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

const { home, resolve, parsearAgenda, liveCategories, liveChannels, BASE, VERSION } = await import("../plugin.js");
const manifiesto = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));

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

test("home: una fila por evento, ítems live con ids válidos y únicos", async () => {
  const filas = await home();
  assert.equal(pedidos[0].url, BASE + "/agenda.php");
  assert.equal(filas.length, 3);
  const ids = filas.flatMap((f) => f.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [...ids, ...filas.map((f) => f.id)]) assert.match(id, /^[A-Za-z0-9._~-]{1,128}$/);
  assert.ok(filas.every((f) => f.items.every((i) => i.kind === "live" && i.ref.startsWith("https://"))));
  assert.equal(filas[0].title, "00:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
});

test("resolve: abre el embed con Referer y devuelve el m3u8 con sus headers", async () => {
  capturas = [];
  const s = await resolve("https://latamzy.com/global1.php?stream=espn");
  assert.equal(capturas[0].url, "https://latamzy.com/global1.php?stream=espn");
  assert.equal(capturas[0].options.headers.Referer, BASE + "/");
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.deepEqual(s.headers, { Referer: "https://p.example/", "User-Agent": "UA" });
});

test("resolve: spf24live.st no manda Referer (su iframe lo rechazaría)", async () => {
  capturas = [];
  await resolve("https://spf24live.st/channels/ch8.php");
  assert.equal(capturas[0].options.headers, undefined);
});

test("resolve: errores tipados y ref inválido", async () => {
  await assert.rejects(resolve("https://latamzy.com/falla"), (e) => e.code === "unavailable" && !!e.options.userMessage);
  await assert.rejects(resolve("https://latamzy.com/vacio"), (e) => e.code === "not_found");
  await assert.rejects(resolve("no es una url"), (e) => e.code === "not_found");
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

test("En vivo: una categoría por evento y sus opciones como canales", async () => {
  const cats = await liveCategories();
  assert.equal(cats.length, 3);
  assert.ok(cats.every((c) => c.genre === "deportes" && /^[A-Za-z0-9._~-]{1,128}$/.test(c.id)));
  const { items } = await liveChannels({ categoryId: cats[0].id });
  assert.deepEqual(items.map((i) => i.title), [
    "TNT Sports Calidad 720p", "TNT Sports Op2 Calidad 720p", "TNT Sports Op3 Calidad 720p",
  ]);
  assert.ok(items.every((i) => i.categoryId === cats[0].id && i.ref.startsWith("https://")));
  assert.deepEqual((await liveChannels({ categoryId: "no-existe" })).items, []);
});

test("VERSION de plugin.js coincide con kino-plugin.json", () => {
  assert.equal(VERSION, manifiesto.version);
});
