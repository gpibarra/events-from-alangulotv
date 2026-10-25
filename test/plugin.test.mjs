import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schedule = readFileSync(new URL("./agenda.fixture.html", import.meta.url), "utf8");
// A real schedule from another day: 15 events, only 1 with signals (the site publishes them gradually).
const scheduleNoSignals = readFileSync(new URL("./agenda-sin-senales.fixture.html", import.meta.url), "utf8");
const emptySchedule = "<ul class=\"menu\"><b>Agenda - Viernes</b></ul>";
let activeSchedule = schedule;
const requests = [];
let captures = [];
let settings = {};
let storage = {};
// The current time is fixed: by default, 07:00 (UTC+1) on October 16, 2026, before every event of that day's schedule.
const DEFAULT_NOW = Date.UTC(2026, 9, 16, 6, 0);
let now = DEFAULT_NOW;
Date.now = () => now;
let scheduleFails = false;

// The missflight.net scheme in reverse (see decryptEconfig): base64(JSON) split into 4 chunks placed in the order 1, 3, 0, 2,
// each one base64 with a padding at position 3, all together in base64.
function encryptEconfig(config) {
  let json = JSON.stringify(config);
  while (btoa(json).length % 4 !== 0 || (btoa(json).length / 4) % 3 !== 0) json += " ";
  const b = btoa(json), q = b.length / 4;
  const dec = [];
  [1, 3, 0, 2].forEach((i, k) => { dec[i] = b.slice(k * q, (k + 1) * q); });
  return btoa(dec.map((d) => { const c = btoa(d); return c.slice(0, 3) + "a" + c.slice(3); }).join(""));
}

globalThis.kino = {
  lang: "es-CO",
  log: () => {},
  config: { get: (key) => settings[key] },
  storage: { get: (k) => (k in storage ? storage[k] : null), set: (k, v) => { storage[k] = v; } },
  error: (code, message, options) => Object.assign(new Error(message), { code, options }),
  fetch: async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith("https://streamtp99a.sbs/") && url.includes("caido")) throw Object.assign(new Error("connect failed"), { code: "timeout" });
    if (url.startsWith("https://vivolatam1.com/")) {
      return { ok: true, status: 200, text: () => `<iframe src="https://traitaunt.net/e/xyz" width="100%"></iframe>` };
    }
    if (url.startsWith("https://traitaunt.net/")) {
      return { ok: true, status: 200, text: () => `<script>window._econfig='${encryptEconfig({ stream_url: "https://c089pa.ejemplo.net:8443/hls/v.m3u8?s=t" })}';</script>` };
    }
    if (url.startsWith("https://spf24live.st/")) {
      return { ok: true, status: 200, text: () => (url.includes("sin-iframe") ? "<html></html>" : `<iframe src="https://missflight.net/e/${url.includes("apagado") ? "apagado" : "abc123"}" width="100%"></iframe>`) };
    }
    if (url.includes(".m3u8")) {
      if (url.includes("no-declarado")) throw Object.assign(new Error("host"), { code: "host_not_allowed" });
      if (url.includes("lento")) throw Object.assign(new Error("timeout"), { code: "timeout" });
      if (url.includes("apagado")) return { ok: false, status: 404, text: () => "not found" };
      return { ok: true, status: 200, text: () => "#EXTM3U\n#EXT-X-VERSION:3\n" };
    }
    if (url.startsWith("https://streamtp99a.sbs/") || url.startsWith("https://la18hd.su/")) {
      // Only the "directo" stream has playbackURL; the others fall back to the hidden browser.
      // "cdnpeer" carries it as window.CDNPEER.src, like la18hd.su since October 2026.
      const stream = new URL(url).searchParams.get("stream");
      const html = ["directo", "apagado", "no-declarado", "lento"].includes(stream)
        ? `var playbackURL = "https:\\/\\/99.cdn.example:443\\/global\\/${stream}\\/index.m3u8?token=t&ip=1.2.3.4";`
        : stream === "cdnpeer"
          ? `<script>window.CDNPEER = {"src":"https://abc.cdn.example:443/espn2/mono.m3u8?token=t","swarm":"x","trackers":["wss://t.example"]};</script>`
          : "<html></html>";
      return { ok: true, status: 200, text: () => html };
    }
    if (url.startsWith("https://missflight.net/")) {
      const m3u8 = url.includes("apagado") ? "https://c089pa.ejemplo.net:8443/hls/apagado.m3u8" : "https://c089pa.ejemplo.net:8443/hls/x.m3u8?s=t&e=1";
      return { ok: true, status: 200, text: () => `<script id="config">window._econfig='${encryptEconfig({ stream_url: m3u8 })}';</script>` };
    }
    if (scheduleFails) return { ok: false, status: 503, text: () => "" };
    return { ok: true, status: 200, text: () => activeSchedule };
  },
  browser: {
    capture: async (url, options) => {
      captures.push({ url, options });
      if (url.includes("falla")) throw Object.assign(new Error("x"), { code: "timeout" });
      if (url.includes("vacio")) return { media: [], subtitles: [], finalUrl: url };
      if (url.includes("captura-apagada")) return { media: [{ url: "https://cdn.example/apagado.m3u8", headers: {} }], subtitles: [], finalUrl: url };
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
  home, resolve, action, SETTINGS_TO_CLEAR, sortEvents, tagOrder, durationHours, tagMap, paginate, scheduleIcons, siteTags, decryptEconfig, SERVERS, parseSchedule, liveCategories, liveChannels, splitEvent, groupByCompetition,
  convertTime, t, BASE, VERSION,
} = await import("../plugin.js");
const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const VALID_ID = /^[A-Za-z0-9._~-]{1,128}$/;

test("parseSchedule: events, time, tag and decoded embeds", () => {
  const events = parseSchedule(schedule);
  assert.equal(events.length, 3);
  assert.equal(events.flatMap((x) => x.options).length, 11);
  const e = events[0];
  assert.equal(e.tag, "AR");
  assert.equal(e.time, "00:00");
  assert.equal(e.name, "Liga Profesional: Huracán vs Gimnasia La Plata");
  assert.deepEqual(e.options.map((o) => o.label), [
    "TNT Sports Calidad 720p", "TNT Sports Op2 Calidad 720p", "TNT Sports Op3 Calidad 720p",
  ]);
  assert.equal(e.options[0].embed, "https://spf24live.st/channels/ch8.php");
  assert.equal(e.options[1].embed, "https://latamzy.com/global1.php?stream=tntsports");
});

test("splitEvent: the competition is the text before the colon", () => {
  assert.deepEqual(splitEvent("Copa Libertadores: Estudiantes LP vs Flamengo", "LIB"), {
    competition: "Copa Libertadores", match: "Estudiantes LP vs Flamengo",
  });
  assert.deepEqual(splitEvent("Partido sin competición", "AR"), { competition: "AR", match: "Partido sin competición" });
});

test("groupByCompetition: groups the events of one competition, in order", () => {
  const e = (name, tag) => ({ name, tag, time: "00:00", options: [] });
  const groups = groupByCompetition([e("Liga: A vs B", "AR"), e("Copa: C vs D", "COL"), e("Liga: E vs F", "AR")]);
  assert.deepEqual(groups.map((g) => [g.title, g.events.map((x) => x.match)]), [
    ["Liga", ["A vs B", "E vs F"]],
    ["Copa", ["C vs D"]],
  ]);
});

test("convertTime: the schedule is in UTC+1", () => {
  assert.equal(convertTime("00:00", -3), "20:00");
  assert.equal(convertTime("01:30", -3), "21:30");
  assert.equal(convertTime("00:00", 1), "00:00");
  assert.equal(convertTime("23:30", 3), "01:30"); // crosses midnight forward
  assert.equal(convertTime("10:05", -5), "04:05");
  assert.equal(convertTime(null, -3), null);
  assert.equal(convertTime("a las 9", -3), "a las 9");
});

test("home: a single \"Todos los eventos\" row, with the competition in the title", async () => {
  settings = {};
  const rows = await home();
  assert.equal(requests.at(-1).url, BASE + "/agenda.php");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Todos los eventos");
  const items = rows[0].items;
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
  for (const id of [...items.map((i) => i.id), rows[0].id]) assert.match(id, VALID_ID);
  assert.ok(items.every((i) => i.kind === "live" && i.ref.startsWith("evt:") && i.ref.length < 64));
  assert.equal(items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata"); // UTC-3 by default
});

test("time zone: -3 by default, the tz setting changes it and an invalid value is ignored", async () => {
  settings = { tz: "-5" };
  assert.equal((await home())[0].items[0].title, "18:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  settings = { tz: "basura" };
  assert.equal((await home())[0].items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  settings = { tz: "99" };
  assert.equal((await home())[0].items[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  settings = {};
});

test("manifest: the tz setting is a select defaulting to -3, and the default is one of its options", () => {
  const tz = manifest.settings.find((s) => s.key === "tz");
  assert.equal(tz.type, "select");
  assert.equal(tz.default, "-3");
  assert.ok(tz.options.some((o) => o.value === tz.default));
  assert.ok(tz.options.length <= 20);
  assert.ok(tz.hint.length <= 80);
});

test("action actualizar: reads the schedule and clears only the `forzar` flag, never the time zone", async () => {
  scheduleFails = false;
  const r = await action("actualizar");
  assert.deepEqual(r.clearSettings, ["forzar"]);
  assert.ok(!r.clearSettings.includes("tz") && !SETTINGS_TO_CLEAR.includes("tz"));
  assert.match(r.message, /3 eventos \(3 con señal\) en 3 competiciones/);
  assert.ok(r.message.length <= 300);
});

test("action: if the schedule cannot be read, it throws and clears nothing", async () => {
  scheduleFails = true;
  await assert.rejects(action("actualizar"), (e) => e.code === "unavailable");
  scheduleFails = false;
});

test("action: an unknown key clears nothing", async () => {
  const r = await action("otra");
  assert.equal(r.clearSettings, undefined);
});

test("manifest: the button and the flag exist, and the flag is a toggle without its own default", () => {
  const byKey = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.equal(byKey.actualizar.type, "action");
  assert.equal(byKey.forzar.type, "toggle");
  assert.ok(SETTINGS_TO_CLEAR.every((k) => byKey[k] && byKey[k].type !== "action" && byKey[k].type !== "section"));
  assert.ok(manifest.settings.every((x) => x.label.length <= 40 && (!x.hint || x.hint.length <= 80)));
});

test("Live: \"Todos\" category first, then one per competition, and one channel per event", async () => {
  const cats = await liveCategories();
  assert.deepEqual(cats.map((c) => c.title), ["Todos", "Liga Profesional", "Copa Colombia", "Copa Libertadores"]);
  assert.ok(cats.every((c) => c.genre === "deportes" && VALID_ID.test(c.id)));
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  const all = (await liveChannels({ categoryId: cats[0].id })).items;
  assert.equal(all.length, 3);
  assert.equal(all[0].title, "20:00 · Liga Profesional: Huracán vs Gimnasia La Plata");
  const { items } = await liveChannels({ categoryId: cats[1].id });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "20:00 · Huracán vs Gimnasia La Plata");
  assert.equal(items[0].categoryId, cats[1].id);
  assert.match(items[0].ref, /^evt:/);
  assert.equal(items[0].id, all[0].id); // the same event has the same id in "Todos" and in its competition
  assert.deepEqual((await liveChannels({ categoryId: "no-existe" })).items, []);
});

test("resolve of an event: tries the signals in schedule order and leaves the rest as copies", async () => {
  captures = [];
  const rows = await home();
  const s = await resolve(rows[0].items[0].ref); // TNT Sports (spf24live), Op2 (latamzy), Op3 (sudamericafy)
  assert.equal(captures.length, 0); // the first one, spf24live, resolves without the browser
  assert.equal(s.url, "https://c089pa.ejemplo.net:8443/hls/x.m3u8?s=t&e=1");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.equal(s.label, "TNT Sports Calidad 720p");
  assert.deepEqual(s.alternatives.map((a) => a.label), ["TNT Sports Op2 Calidad 720p", "TNT Sports Op3 Calidad 720p"]);
  assert.ok(s.alternatives.every((a) => a.ref.startsWith("https://") && a.ref.length <= 512));
});

test("direct resolve: latamzy and sudamericafy go to the player without the browser and unescape playbackURL", async () => {
  for (const [embed, host] of [
    ["https://latamzy.com/global1.php?stream=directo", "streamtp99a.sbs"],
    ["https://sudamericafy.com/global1.php?stream=directo", "la18hd.su"],
  ]) {
    captures = [];
    requests.length = 0;
    const s = await resolve(embed);
    assert.equal(captures.length, 0, embed);
    assert.equal(s.url, "https://99.cdn.example:443/global/directo/index.m3u8?token=t&ip=1.2.3.4");
    assert.equal(new URL(requests[0].url).hostname, host);
    assert.ok(manifest.hosts.includes(host) && manifest.hosts.includes("*." + host), host + " missing from hosts");
  }
  assert.equal(requests[0].options.headers["Sec-Fetch-Dest"], "iframe"); // la18hd.su only answers an iframe
});

test("direct resolve: when the schedule links the player itself (streamtp99a.sbs, la18hd.su) it is fetched as is", async () => {
  for (const [embed, m3u8] of [
    ["https://streamtp99a.sbs/global1.php?stream=directo", "https://99.cdn.example:443/global/directo/index.m3u8?token=t&ip=1.2.3.4"],
    ["https://la18hd.su/vivo/canales.php?stream=cdnpeer", "https://abc.cdn.example:443/espn2/mono.m3u8?token=t"],
  ]) {
    captures = [];
    requests.length = 0;
    const s = await resolve(embed);
    assert.equal(captures.length, 0, embed);
    assert.equal(s.url, m3u8);
    assert.equal(requests[0].url, embed);
  }
  assert.equal(requests[0].options.headers["Sec-Fetch-Dest"], "iframe");
  assert.equal(requests[0].options.headers.Referer, BASE + "/");
});

test("channel off air: the m3u8 is checked before returning it and, if it is not a playlist, the next signal is tried", async () => {
  captures = [];
  // off: the direct method fails and the browser is not tried (it would see the same channel off)
  await assert.rejects(resolve("https://latamzy.com/global1.php?stream=apagado"), (e) => e.code === "unavailable" && e.offAir);
  assert.equal(captures.length, 0);
  // in an event, an off signal without fallback yields to the next
  const ref = "ev:" + JSON.stringify([
    { n: "Apagada", e: "https://spf24live.st/channels/apagado.php" },
    { n: "Buena", e: "https://latamzy.com/global1.php?stream=directo" },
  ]);
  assert.equal((await resolve(ref)).label, "Buena");
  // an m3u8 that does not answer in time is also a channel off air, without trying the browser
  captures = [];
  await assert.rejects(resolve("https://latamzy.com/global1.php?stream=lento"), (e) => e.offAir && /did not respond/.test(e.message));
  assert.equal(captures.length, 0);
  // what the browser captures is also checked
  captures = [];
  await assert.rejects(resolve("https://latamzy.com/global1.php?stream=captura-apagada"), (e) => e.offAir && /apagado|responded 404/.test(e.message));
  assert.equal(captures.length, 1, "direct found no playbackURL and tried the browser");
  // a video server the person did not allow cannot be checked: it is returned anyway
  const unchecked = await resolve("https://latamzy.com/global1.php?stream=no-declarado");
  assert.match(unchecked.url, /no-declarado/);
  // video servers are not declared: Kino asks about each one
  for (const h of ["fubo18.com", "domhsd.com", "7m12bgo8dx9z.net"]) assert.ok(!manifest.hosts.some((d) => d.endsWith(h)), h);
});

test("resolve: if the direct method fails, falls back to the browser and returns the captured m3u8 with its headers", async () => {
  captures = [];
  const s = await resolve("https://latamzy.com/global1.php?stream=tntsports");
  assert.deepEqual(captures[0].options.headers, { Referer: BASE + "/" });
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.deepEqual(s.headers, { Referer: "https://p.example/", "User-Agent": "UA" });
});

test("resolve of a legacy ref (JSON): if a signal fails it moves to the next one", async () => {
  captures = [];
  const ref = "ev:" + JSON.stringify([
    { n: "Rota", e: "https://latamzy.com/falla" },
    { n: "Buena", e: "https://sudamericafy.com/global1.php?stream=x" },
  ]);
  const s = await resolve(ref);
  assert.equal(captures.length, 2);
  assert.equal(s.label, "Buena");
  assert.deepEqual(s.alternatives.map((a) => a.label), ["Rota"]);
});

test("resolve of a legacy ref (JSON): if no signal works, error with a message for the person", async () => {
  const ref = "ev:" + JSON.stringify([{ n: "Rota", e: "https://latamzy.com/falla" }]);
  await assert.rejects(resolve(ref), (e) => e.code === "unavailable" && !!e.options.userMessage);
});

test("resolve of a copy (an embed): opens the embed with Referer and returns the m3u8", async () => {
  captures = [];
  const s = await resolve("https://latamzy.com/global1.php?stream=espn");
  assert.equal(captures[0].url, "https://latamzy.com/global1.php?stream=espn");
  assert.equal(captures[0].options.headers.Referer, BASE + "/");
  assert.equal(s.url, "https://cdn.example/x.m3u8?t=1");
  assert.equal(s.alternatives, undefined);
});

test("resolve: spf24live.st without the browser, reads the iframe with a Chrome User-Agent and decrypts the m3u8", async () => {
  captures = [];
  requests.length = 0;
  const s = await resolve("https://spf24live.st/channels/ch8.php");
  assert.equal(captures.length, 0);
  assert.equal(s.url, "https://c089pa.ejemplo.net:8443/hls/x.m3u8?s=t&e=1");
  assert.equal(s.mime, "application/vnd.apple.mpegurl");
  assert.equal(s.headers.Referer, "https://missflight.net/");
  assert.doesNotMatch(s.headers["User-Agent"], /; wv\)/);
  const iframe = requests.find((p) => p.url.startsWith("https://missflight.net/"));
  assert.equal(iframe.options.headers.Referer, "https://spf24live.st/");
  assert.doesNotMatch(iframe.options.headers["User-Agent"], /; wv\)/);
  for (const h of ["missflight.net", "*.missflight.net"]) assert.ok(manifest.hosts.includes(h), h);
});

test("resolve: vivolatam1.com is read like spf24live, with its own domain as the iframe's Referer", async () => {
  captures = [];
  requests.length = 0;
  const s = await resolve("https://vivolatam1.com/channels/espnpremium.php");
  assert.equal(captures.length, 0);
  assert.equal(s.url, "https://c089pa.ejemplo.net:8443/hls/v.m3u8?s=t");
  assert.equal(s.headers.Referer, "https://traitaunt.net/");
  assert.equal(requests.find((p) => p.url.startsWith("https://traitaunt.net/")).options.headers.Referer, "https://vivolatam1.com/");
  for (const h of ["vivolatam1.com", "*.vivolatam1.com", "traitaunt.net", "*.traitaunt.net"]) assert.ok(manifest.hosts.includes(h), h);
});

test("resolve: if the player is the embed and it does not connect, the browser is not tried (it would wait for the same host)", async () => {
  captures = [];
  await assert.rejects(resolve("https://streamtp99a.sbs/global1.php?stream=caido"), (e) => e.code === "timeout" && e.unreachable);
  assert.equal(captures.length, 0);
  const ref = "ev:" + JSON.stringify([{ n: "Caída", e: "https://streamtp99a.sbs/global1.php?stream=caido" }, { n: "Buena", e: "https://streamtp99a.sbs/global1.php?stream=directo" }]);
  const s = await resolve(ref);
  assert.equal(s.url, "https://99.cdn.example:443/global/directo/index.m3u8?token=t&ip=1.2.3.4");
  assert.equal(captures.length, 0);
});

test("resolve: spf24live.st without iframe answers not_found", async () => {
  await assert.rejects(resolve("https://spf24live.st/channels/sin-iframe.php"), (e) => e.code === "not_found");
});

test("decryptEconfig: recovers the JSON and rejects garbage", () => {
  const config = { stream_url: "https://h.example/a.m3u8", p2p: true };
  assert.deepEqual(decryptEconfig(encryptEconfig(config)), config);
  assert.throws(() => decryptEconfig(btoa("corto")));
});

test("unsupported server: skipped without trying, logged and, if all are, the message asks to tell the author", async () => {
  captures = [];
  requests.length = 0;
  const logLines = [];
  const log = kino.log;
  kino.log = (...a) => logLines.push(a.join(" "));
  try {
    await assert.rejects(resolve("https://servidornuevo.com/embed.php?stream=x"), (e) => e.code === "not_found" && /no conoce/.test(e.options.userMessage));
    assert.equal(captures.length + requests.length, 0, "does not try to open it");
    assert.ok(logLines.some((l) => l.includes("unsupported server: servidornuevo.com")));
    // all unknown: the new-server message
    const onlyNew = "ev:" + JSON.stringify([{ n: "A", e: "https://nuevo1.com/x" }, { n: "B", e: "https://nuevo2.com/y" }]);
    await assert.rejects(resolve(onlyNew), (e) => e.code === "not_found" && /no conoce/.test(e.options.userMessage));
    // mixed with one that fails: the usual message
    const mixed = "ev:" + JSON.stringify([{ n: "A", e: "https://nuevo1.com/x" }, { n: "B", e: "https://latamzy.com/falla" }]);
    await assert.rejects(resolve(mixed), (e) => e.code === "unavailable" && /ninguna señal/.test(e.options.userMessage));
    // and if another works, it is used without a notice
    const withGood = "ev:" + JSON.stringify([{ n: "A", e: "https://nuevo1.com/x" }, { n: "B", e: "https://latamzy.com/global1.php?stream=directo" }]);
    assert.equal((await resolve(withGood)).label, "B");
  } finally {
    kino.log = log;
  }
});

test("every supported server is in the manifest hosts, with and without *.", () => {
  for (const h of SERVERS) {
    assert.ok(manifest.hosts.includes(h), h + " missing from hosts");
    assert.ok(manifest.hosts.includes("*." + h), "*." + h + " missing from hosts");
  }
});

test("resolve: typed errors and invalid ref", async () => {
  await assert.rejects(resolve("https://latamzy.com/falla"), (e) => e.code === "unavailable" && !!e.options.userMessage);
  await assert.rejects(resolve("https://latamzy.com/vacio"), (e) => e.code === "not_found");
  await assert.rejects(resolve("no es una url"), (e) => e.code === "not_found");
  await assert.rejects(resolve("ev:{no es json"), (e) => e.code === "not_found");
  await assert.rejects(resolve("ev:[]"), (e) => e.code === "not_found");
});

test("the BASE domain is declared in the manifest hosts", () => {
  const { hostname } = new URL(BASE);
  assert.ok(manifest.hosts.includes(hostname), `${hostname} missing from hosts`);
  assert.ok(manifest.hosts.includes("*." + hostname), `*.${hostname} missing from hosts`);
});

test("package.json and kino-plugin.json have the same version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.version, manifest.version);
});

test("plugin.js VERSION matches kino-plugin.json", () => {
  assert.equal(VERSION, manifest.version);
});

test("schedule with events without signals: all are shown, those with signals first, and only those can be opened", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    settings = {};
    const rows = await home();
    assert.equal(rows.length, 1);
    const items = rows[0].items;
    assert.equal(items.length, 15);
    assert.equal(new Set(items.map((i) => i.id)).size, 15);
    assert.ok(items.every((i) => !/sin señal|no signal/.test(i.title)), "the title carries no notice");
    assert.equal(items[0].title, "10:15 · Liga Profesional Saudí: Al Quadisiya vs Abha"); // 14:15 UTC+1 -> UTC-3
    const cats = await liveCategories();
    assert.equal(cats.length, 12); // Todos + 11 competitions
    assert.equal(cats[0].title, "Todos");
  } finally {
    activeSchedule = schedule;
  }
});

test("sortEvents without time: with signal before without, and schedule order kept on ties", () => {
  const e = (n, signals) => ({ name: n, options: new Array(signals).fill({}) });
  assert.deepEqual(sortEvents([e("a", 0), e("b", 1), e("c", 0), e("d", 2)]).map((x) => x.name), ["b", "d", "a", "c"]);
});

test("limits: the Home row is cut at 60 and Live \"Todos\" lists all", async () => {
  const event = (n) => `<li class="AR"><a href="#">Liga: Equipo ${n} vs Rival ${n}<span class="t">10:00</span></a><ul>\n</ul>\n</li>`;
  activeSchedule = `<ul class="menu">${Array.from({ length: 70 }, (_, i) => event(i)).join("\n")}</ul>`;
  try {
    const rows = await home();
    assert.equal(rows[0].items.length, 60);
    assert.equal(new Set(rows[0].items.map((i) => i.id)).size, 60);
    const cats = await liveCategories();
    assert.deepEqual(cats.map((c) => c.title), ["Todos", "Liga"]);
    assert.equal((await liveChannels({ categoryId: "todos" })).items.length, 70);
    assert.equal((await liveChannels({ categoryId: cats[1].id })).items.length, 70);
  } finally {
    activeSchedule = schedule;
  }
});

test("resolve by id: rereads the schedule and uses the current signals", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    const saudi = (await home()).flatMap((f) => f.items).find((i) => i.title.includes("Al Quadisiya"));
    const before = requests.length;
    captures = [];
    const s = await resolve(saudi.ref);
    assert.ok(requests.length > before, "must fetch the schedule again");
    assert.ok(requests.slice(before).some((p) => p.url === BASE + "/agenda.php"), "must fetch the schedule again");
    assert.equal(new URL(captures[0].url).hostname, "sudamericafy.com");
    assert.equal(s.label, "Fox Deportes Calidad 720p");
    assert.equal(s.alternatives.length, 1);
  } finally {
    activeSchedule = schedule;
  }
});

test("resolve by id: an event without signals answers with a clear message and does not open the browser", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    const noSignal = (await home()).flatMap((f) => f.items).find((i) => i.title.includes("Sport Huancayo"));
    captures = [];
    await assert.rejects(resolve(noSignal.ref), (e) => e.code === "not_found" && /Todavía no hay señal/.test(e.options.userMessage));
    assert.equal(captures.length, 0);
  } finally {
    activeSchedule = schedule;
  }
});

test("resolve by id: an event no longer in the schedule -> not_found with a message", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    const item = (await home()).flatMap((f) => f.items)[0];
    activeSchedule = schedule; // the next day the event no longer exists
    await assert.rejects(resolve(item.ref), (e) => e.code === "not_found" && !!e.options.userMessage);
  } finally {
    activeSchedule = schedule;
  }
});

test("action: counts events without signals; with an empty schedule it warns and clears nothing", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    const r = await action("actualizar");
    assert.match(r.message, /15 eventos \(1 con señal\)/);
    assert.deepEqual(r.clearSettings, ["forzar"]);
    activeSchedule = emptySchedule;
    const v = await action("actualizar");
    assert.match(v.message, /No hay eventos en la agenda de hoy/);
    assert.equal(v.clearSettings, undefined);
    assert.deepEqual(await home(), []);
  } finally {
    activeSchedule = schedule;
  }
});

test("tagOrder: comma-separated list, trimmed and uppercased, empty by default", () => {
  settings = {};
  assert.deepEqual(tagOrder(), []);
  settings = { orden: "" };
  assert.deepEqual(tagOrder(), []);
  settings = { orden: " ar , lib ,, SUD " };
  assert.deepEqual(tagOrder(), ["AR", "LIB", "SUD"]);
  settings = { orden: 5 };
  assert.deepEqual(tagOrder(), []);
  settings = {};
});

test("sortEvents with tags: the named ones first and the rest in schedule order", () => {
  const e = (n, tag, signals = 1) => ({ name: n, tag, options: new Array(signals).fill({}) });
  const ctx = (order) => ({ order, now: -Infinity, durationMs: 0 });
  const list = [e("a", "COL"), e("b", "AR"), e("c", "PE"), e("d", "LIB"), e("e", "AR", 0), e("f", "SUD")];
  assert.deepEqual(sortEvents(list, ctx(["AR", "LIB", "SUD"])).map((x) => x.name), ["b", "e", "d", "f", "a", "c"]);
  assert.deepEqual(sortEvents(list, ctx([])).map((x) => x.name), ["a", "b", "c", "d", "f", "e"]); // no order: with signal first on ties
  assert.deepEqual(sortEvents(list, ctx(["AR"])).map((x) => x.name), ["b", "e", "a", "c", "d", "f"]);
});

test("parseSchedule: startMs comes from the header date, the UTC+1 time and the day change", () => {
  const ev = parseSchedule(scheduleNoSignals);
  assert.equal(ev[0].startMs, Date.UTC(2026, 9, 16, 13, 15)); // 14:15 UTC+1
  const boca = ev.find((x) => x.name.includes("Boca Juniors"));
  assert.equal(boca.startMs, Date.UTC(2026, 9, 17, 0, 30)); // 01:30 UTC+1 is already the next day
  assert.ok(ev.every((x, i) => i === 0 || x.startMs >= ev[i - 1].startMs), "the schedule stays in chronological order");
  assert.equal(parseSchedule("<ul class=\"menu\"></ul>").length, 0);
  // without a date in the header it cannot tell whether it ended
  const noDate = scheduleNoSignals.replace(/Agenda - [^<]*/, "Agenda");
  assert.ok(parseSchedule(noDate).every((x) => x.startMs === null));
});

test("sortEvents: ended events (start + duration) go last, the rest by time", () => {
  const ev = parseSchedule(scheduleNoSignals);
  const names = (ctx) => sortEvents(ev, ctx).map((x) => x.name.split(": ")[1]);
  const base = { order: [], durationMs: 3 * 3600000 };
  // 19:00 in UTC-3 = 22:00 UTC: those that started up to 19:00 UTC (local 16:00 or earlier) have ended
  const late = names({ ...base, now: Date.UTC(2026, 9, 16, 22, 0) });
  assert.equal(late[0], "Los Chankas vs ADT"); // 17:30 local, not ended yet
  assert.equal(late.indexOf("Al Quadisiya vs Abha"), 8); // 10:15 local: ended, goes after the 8 that follow
  assert.deepEqual(late.slice(8, 10), ["Al Quadisiya vs Abha", "Sport Huancayo vs Cusco"]); // the ended ones, by time
  assert.equal(late.length, 15);
  // right when the 3 h are up it counts as ended
  const exact = names({ ...base, now: Date.UTC(2026, 9, 16, 16, 15) });
  assert.equal(exact.at(-1), "Al Quadisiya vs Abha");
  const before = names({ ...base, now: Date.UTC(2026, 9, 16, 16, 14) });
  assert.equal(before[0], "Al Quadisiya vs Abha");
  // with none ended the order is the schedule's
  assert.deepEqual(names({ ...base, now: Date.UTC(2026, 9, 16, 6, 0) }), ev.map((x) => x.name.split(": ")[1]));
});

test("tags rank after ended: an ended AR goes after the ones not ended", () => {
  const ev = parseSchedule(scheduleNoSignals);
  const ctx = { order: ["ARA"], now: Date.UTC(2026, 9, 16, 22, 0), durationMs: 3 * 3600000 };
  const list = sortEvents(ev, ctx).map((x) => x.tag);
  assert.notEqual(list[0], "ARA"); // the ARA already ended
  assert.equal(list.indexOf("ARA"), 8); // and it is the first of the ended ones
});

test("durationHours: 3 by default, accepts a decimal comma and falls back to 3 on an invalid value", () => {
  const withValue = (v) => { settings = v === undefined ? {} : { duracion: v }; return durationHours(); };
  assert.equal(withValue(undefined), 3);
  assert.equal(withValue("3"), 3);
  assert.equal(withValue("2,5"), 2.5);
  assert.equal(withValue("1.5"), 1.5);
  assert.equal(withValue("0"), 3);
  assert.equal(withValue("99"), 3);
  assert.equal(withValue("mucho"), 3);
  assert.equal(withValue(""), 3);
  settings = {};
});

test("Home and Live use the current time and the duration setting", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    now = Date.UTC(2026, 9, 16, 22, 0); // 19:00 in UTC-3
    settings = {};
    const items = (await home())[0].items;
    assert.ok(items[0].title.includes("Los Chankas"));
    assert.ok(items.at(-1).title.includes("Championship")); // the last of the ended ones is the one that started latest
    assert.equal(items[8].title.split(" (")[0], "10:15 · Liga Profesional Saudí: Al Quadisiya vs Abha");
    const cats = await liveCategories();
    assert.deepEqual(cats.slice(0, 4).map((c) => c.title), ["Todos", "Liga 1", "Liga Profesional", "Primera División"]);
    assert.equal(cats.at(-1).title, "Championship");
    // with a 12 h duration nothing has ended and the schedule order returns
    settings = { duracion: "12" };
    assert.ok((await home())[0].items[0].title.includes("Al Quadisiya"));
  } finally {
    settings = {};
    now = DEFAULT_NOW;
    activeSchedule = schedule;
  }
});

test("tagMap: tag -> competitions, without repeats, in schedule order", () => {
  const map = tagMap(parseSchedule(scheduleNoSignals));
  assert.equal(map.length, 11);
  assert.ok(map.includes("AR: Liga Profesional"));
  assert.ok(map.includes("ARA: Liga Profesional Saudí"));
  assert.ok(map.includes("PE: Liga 1")); // two Liga 1 events, listed once
  assert.equal(map[0], "ARA: Liga Profesional Saudí");
  const e = (n, tag) => ({ name: n, tag, options: [] });
  assert.deepEqual(tagMap([e("Liga: a vs b", "AR"), e("Copa Argentina: c vs d", "AR"), e("Liga: e vs f", "AR")]), ["AR: Liga, Copa Argentina"]);
});

test("paginate: splits into pages that fit the limit", () => {
  const entries = Array.from({ length: 30 }, (_, i) => `ET${i}: Competición número ${i}`);
  const pages = paginate(entries, 100);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((p) => p.length <= 100));
  assert.deepEqual(pages.join("\n").split("\n"), entries); // nothing is lost or repeated
  assert.deepEqual(paginate([], 100), []);
  assert.ok(paginate(["x".repeat(500)], 100)[0].length <= 100);
});

test("action mapa: shows the map, clears nothing and cycles the pages when there are several", async () => {
  storage = {};
  activeSchedule = scheduleNoSignals;
  try {
    const r = await action("mapa");
    assert.match(r.message, /AR: Liga Profesional/);
    assert.match(r.message, /ARA: Liga Profesional Saudí/);
    assert.ok(r.message.length <= 300);
    assert.equal(r.clearSettings, undefined);
    // a schedule with many competitions is split into pages and each press shows the next
    const many = Array.from({ length: 25 }, (_, i) => `<li class="T${i}"><a href="#">Competición larga número ${i}: A vs B<span class="t">10:00</span></a><ul>\n</ul>\n</li>`).join("\n");
    activeSchedule = `<ul class="menu"><b>Agenda - Viernes 16 de Octubre de 2026</b>${many}</ul>`;
    storage = {};
    const p1 = await action("mapa");
    const p2 = await action("mapa");
    assert.match(p1.message, /\(1\/\d+\)/);
    assert.match(p2.message, /\(2\/\d+\)/);
    assert.ok(p1.message.length <= 300 && p2.message.length <= 300);
    assert.notEqual(p1.message, p2.message);
    // no events
    activeSchedule = emptySchedule;
    assert.match((await action("mapa")).message, /No hay eventos/);
  } finally {
    storage = {};
    activeSchedule = schedule;
  }
});

test("manifest: duration (text, 3 by default) and map button", () => {
  const byKey = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.equal(byKey.duracion.type, "text");
  assert.equal(byKey.duracion.default, "3");
  assert.equal(byKey.mapa.type, "action");
  assert.ok(!SETTINGS_TO_CLEAR.includes("mapa") && !SETTINGS_TO_CLEAR.includes("duracion"));
  const valued = manifest.settings.filter((x) => !["section", "status", "action"].includes(x.type));
  assert.ok(valued.length <= 12);
  assert.equal(new Set(manifest.settings.map((x) => x.key)).size, manifest.settings.length);
});
test("tag order on Home and Live: Todos and the competitions follow the setting", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    settings = { orden: "MEX,AR" };
    const items = (await home())[0].items;
    assert.deepEqual(items.slice(0, 5).map((i) => i.badges[0]), ["MEX", "MEX", "MEX", "AR", "AR"]);
    const cats = await liveCategories();
    assert.deepEqual(cats.slice(0, 4).map((c) => c.title), ["Todos", "Liga MX", "Liga Profesional", "Liga Profesional Saudí"]);
    const all = (await liveChannels({ categoryId: "todos" })).items;
    assert.ok(all[0].title.includes("Liga MX"));
    assert.equal(all.length, 15);
    const mx = (await liveChannels({ categoryId: cats[1].id })).items;
    assert.equal(mx.length, 3);
    settings = {};
    const unsorted = (await home())[0].items;
    assert.ok(unsorted[0].title.includes("Al Quadisiya")); // with signal first, as before
  } finally {
    settings = {};
    activeSchedule = schedule;
  }
});

test("manifest: the orden setting is a text without a default", () => {
  const order = manifest.settings.find((x) => x.key === "orden");
  assert.equal(order.type, "text");
  assert.equal(order.default, undefined);
  assert.ok(order.label.length <= 40 && order.hint.length <= 80);
  assert.ok(!SETTINGS_TO_CLEAR.includes("orden"));
});

test("scheduleIcons: reads each tag's image from the schedule CSS", () => {
  const icons = scheduleIcons(scheduleNoSignals);
  assert.equal(Object.keys(icons).length, 39);
  assert.equal(icons.AR, "https://tvtveshd.com/iconos/argentina.png");
  assert.equal(icons.LIB, "https://tvtveshd.com/iconos/libertadore.png");
  assert.equal(icons.SUD, "https://tvtveshd.com/iconos/sudamericana.png");
  assert.equal(icons.UEFA, "https://tvtveshd.com/iconos/uefa%20hd.png"); // el espacio se codifica
  assert.ok(Object.values(icons).every((u) => /^https:\/\/\S+$/.test(u) && u.length <= 2048));
  // the schedule of the 14th also has the CSS
  assert.equal(Object.keys(scheduleIcons(schedule)).length, 39);
  assert.deepEqual(scheduleIcons("<ul></ul>"), {});
  // https only, optional quotes
  const css = `.A > a:before { background-image: url("https://x.test/a.png") } .B > a:before { background-image: url(http://x.test/b.png) } .C > a:before { background-image: url('https://x.test/c d.png') }`;
  assert.deepEqual(scheduleIcons(css), { A: "https://x.test/a.png", C: "https://x.test/c%20d.png" });
});

test("thumbnails: poster on Home cards and logo on Live channels, by tag", async () => {
  activeSchedule = scheduleNoSignals;
  try {
    settings = {};
    const items = (await home())[0].items;
    const byKey = (txt) => items.find((i) => i.title.includes(txt));
    assert.equal(byKey("Al Quadisiya").poster, "https://tvtveshd.com/iconos/arabia.png"); // ARA
    assert.equal(byKey("Boca Juniors").poster, "https://tvtveshd.com/iconos/argentina.png"); // AR
    assert.equal(byKey("Necaxa").poster, "https://tvtveshd.com/iconos/mexico.png"); // MEX
    assert.ok(items.every((i) => /^https:\/\//.test(i.poster)));
    const channels = (await liveChannels({ categoryId: "todos" })).items;
    assert.equal(channels.find((c) => c.title.includes("Boca Juniors")).logo, "https://tvtveshd.com/iconos/argentina.png");
    assert.ok(channels.every((c) => /^https:\/\//.test(c.logo)));
    // a tag without an image gets no thumbnail
    activeSchedule = `<style>.AR > a:before { background-image: url(https://x.test/ar.png) }</style><ul class="menu"><b>Agenda - Viernes 16 de Octubre de 2026</b>` +
      `<li class="AR"><a href="#">Liga: a vs b<span class="t">10:00</span></a><ul>\n</ul>\n</li><li class="ZZZ"><a href="#">Copa: c vs d<span class="t">11:00</span></a><ul>\n</ul>\n</li></ul>`;
    const two = (await home())[0].items;
    assert.equal(two[0].poster, "https://x.test/ar.png");
    assert.equal(two[1].poster, undefined);
  } finally {
    activeSchedule = schedule;
  }
});

test("siteTags: tag and its image name, without folder or extension", () => {
  const list = siteTags({ LIB: "https://x.test/iconos/libertadore.png", UEFA: "https://x.test/iconos/uefa%20hd.png", FUT: "https://x.test/iconos/fut.webp" });
  assert.deepEqual(list, ["LIB: libertadore", "UEFA: uefa hd", "FUT: fut"]);
});

test("action etiquetas: lists the site's 39 tags in pages under 300 characters and cycles them", async () => {
  storage = {};
  activeSchedule = scheduleNoSignals;
  try {
    const pages = [];
    for (let i = 0; i < 4; i++) {
      const r = await action("etiquetas");
      assert.ok(r.message.length <= 300, `page ${i + 1} is ${r.message.length} long`);
      assert.equal(r.clearSettings, undefined);
      pages.push(r.message);
    }
    assert.match(pages[0], /\(1\/3\)/);
    assert.match(pages[2], /\(3\/3\)/);
    assert.equal(pages[3], pages[0]); // back to the first
    const joined = pages.slice(0, 3).join(" · ");
    for (const tag of ["TUR: turquia", "LIB: libertadore", "SUD: sudamericana", "ARA: arabia", "CONNAT: CONNAT"]) assert.ok(joined.includes(tag), tag);
    // this button's paging and the map's do not overwrite each other
    storage = {};
    await action("etiquetas");
    assert.equal(storage.tagMapPage, undefined);
    assert.ok("siteTagsPage" in storage);
    // no readable CSS
    activeSchedule = emptySchedule;
    assert.match((await action("etiquetas")).message, /No pude leer las etiquetas/);
  } finally {
    storage = {};
    activeSchedule = schedule;
  }
});

test("manifest: the all-tags button exists and clears no settings", () => {
  const byKey = Object.fromEntries(manifest.settings.map((x) => [x.key, x]));
  assert.equal(byKey.etiquetas.type, "action");
  assert.ok(!SETTINGS_TO_CLEAR.includes("etiquetas"));
  assert.ok(manifest.settings.every((x) => x.label.length <= 40 && (!x.hint || x.hint.length <= 80)));
});

test("t: texts for the person come from the catalog, in Spanish or English, with parameters", () => {
  assert.equal(t("allEvents"), "Todos los eventos");
  assert.match(t("scheduleRead", { events: 5, withSignal: 2, competitions: 3 }), /^Agenda leída: 5 eventos \(2 con señal\) en 3 competiciones/);
  kino.lang = "en-US";
  try {
    assert.equal(t("allEvents"), "All events");
    assert.match(t("scheduleRead", { events: 5, withSignal: 2, competitions: 3 }), /^Schedule read: 5 events \(2 with a signal\) in 3 competitions/);
  } finally {
    kino.lang = "es-CO";
  }
});
