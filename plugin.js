// AlAnguloTV: the alangulotv schedule as live channels.
// Structure: category = competition (the text before the event's ":"), channel = event, and the
// event's signals (TNT Sports, Op2, Op3…) are tried in order until one returns video.
// Code, names and log in English; what the person sees comes from the MESSAGES catalog (see t()).

// The only place with the schedule's domain. If it changes, change it here and in "hosts" of kino-plugin.json
// (a JSON cannot read it; a test checks that both match).
export const BASE = "https://alangulotv.sx";
// Must match "version" in kino-plugin.json (a test checks it). It is written to the log on every
// resolve to know for sure which version runs on the device: Kino does not print it.
export const VERSION = "0.8.1";
const SCHEDULE_URL = BASE + "/agenda.php";
const MIME_HLS = "application/vnd.apple.mpegurl";
// Home is a single "Todos" row (Kino allows 20 rows of 60 items) and Live has the "Todos" category.
const MAX_ROW_ITEMS = 60;
// Ids and keys that Kino or the person already stored: not translated.
const ALL_ID = "todos";
const GENRE = "deportes";
// A channel's ref is just the event id: resolve rereads the schedule and uses the signals of that
// moment, so an event the site listed without links works as soon as it publishes them.
const EVENT_PREFIX = "evt:";
// Previous format (0.5.x and earlier): carried the signals copied as JSON ({ n: label, e: embed }). Kino may
// keep stored rows with that ref for up to 6 h, so it is still understood.
const LEGACY_PREFIX = "ev:";

// Schedule times are in UTC+1: the site's /hora.js converts them to the visitor's zone with
// local_time = time + (visitor_UTC - 1). The "tz" setting (kino-plugin.json) is that zone.
const SCHEDULE_UTC = 1;
const DEFAULT_TZ = -3; // Argentina
// An event "has ended" once DURATION hours have passed since its start ("duracion" setting); ended ones go last.
const DEFAULT_DURATION = 3;

// --- Texts for the person -------------------------------------------------------------------------
// Everything Kino shows the person comes from here, with its translation. To change a text or add a
// language, only this catalog is touched. `{name}` is replaced with the parameter of the same name.
const MESSAGES = {
  allEvents: { es: "Todos los eventos", en: "All events" },
  allCategory: { es: "Todos", en: "All" },
  otherCompetition: { es: "Otros", en: "Other" },
  done: { es: "Listo", en: "Done" },
  noEventsToday: {
    es: "No hay eventos en la agenda de hoy. El sitio aún no los publicó.",
    en: "There are no events in today's schedule. The site has not published them yet.",
  },
  scheduleRead: {
    es: "Agenda leída: {events} eventos ({withSignal} con señal) en {competitions} competiciones. Kino volverá a pedirla.",
    en: "Schedule read: {events} events ({withSignal} with a signal) in {competitions} competitions. Kino will ask for it again.",
  },
  pressAgain: { es: "Pulsa otra vez para ver más.", en: "Press again for more." },
  noTagsYet: {
    es: "No hay eventos en la agenda de hoy: todavía no hay etiquetas que mostrar.",
    en: "There are no events in today's schedule: no tags to show yet.",
  },
  siteTagsUnreadable: { es: "No pude leer las etiquetas del sitio.", en: "Could not read the site's tags." },
  eventGone: { es: "Este evento ya no está en la agenda.", en: "This event is no longer in the schedule." },
  noSignalYet: {
    es: "Todavía no hay señal para este evento. Prueba más tarde.",
    en: "There is no signal for this event yet. Try again later.",
  },
  unknownServer: {
    es: "Este evento usa un servidor que el plugin todavía no conoce. Avisa al autor y comparte el registro del modo debug.",
    en: "This event uses a server the plugin does not know yet. Tell the author and share the debug mode log.",
  },
  noSignalWorked: {
    es: "No se pudo abrir ninguna señal de este evento ahora. Prueba de nuevo más tarde.",
    en: "None of this event's signals could be opened right now. Try again later.",
  },
  signalUnavailable: {
    es: "No se pudo abrir esta señal ahora. Prueba otra opción del evento.",
    en: "This signal could not be opened right now. Try another option of the event.",
  },
};

export function t(key, params = {}) {
  const entry = MESSAGES[key];
  const text = String(kino.lang).startsWith("en") ? entry.en : entry.es;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

// --- Servers ---------------------------------------------------------------------------------------
// Each embed domain has a list of methods tried in order: the first one that returns a Stream wins and,
// if one fails, the next is tried. If a server's method changes, write another function with the signature
// (embed) => Stream and add it to its list. An event's signals are tried in the order the schedule lists them.
// A domain without an entry is a server the plugin does not know: there is no way to get its video, so it is skipped
// without trying. Every domain here must be in "hosts" of kino-plugin.json (a test checks it).
const EXTRACTORS = {
  // spf24live.st: its iframe (missflight.net, now tossequip.net) rejects the Android WebView User-Agent ("; wv")
  // with "domain protected", so the hidden browser never works. It is read with kino.fetch and the player's
  // config is decrypted.
  "spf24live.st": [method("decrypt", extractSpf24)],
  // latamzy.com and sudamericafy.com build, with an obfuscated script, an iframe to a player that has the m3u8 in
  // plain text. We go straight to that player; if its domain changed, the hidden browser remains.
  "latamzy.com": [
    method("direct", extractPlayback((stream) => "https://streamtp99a.sbs/global1.php?stream=" + stream)),
    method("browser", extractByNetwork({ referer: BASE + "/" })),
  ],
  "sudamericafy.com": [
    method("direct", extractPlayback((stream) => "https://la18hd.su/vivo/canales.php?stream=" + stream, la18hdHeaders("https://sudamericafy.com/"))),
    method("browser", extractByNetwork({ referer: BASE + "/" })),
  ],
  // Since October 2026 the schedule links those players directly: the embed is already the player.
  "streamtp99a.sbs": [
    method("direct", extractPlayback((stream, embed) => embed)),
    method("browser", extractByNetwork({ referer: BASE + "/" })),
  ],
  "la18hd.su": [
    method("direct", extractPlayback((stream, embed) => embed, la18hdHeaders(BASE + "/"))),
    method("browser", extractByNetwork({ referer: BASE + "/" })),
  ],
};
export const SERVERS = Object.keys(EXTRACTORS);

function method(name, extract) {
  return { name, extract };
}

// --- Schedule: competitions and events ------------------------------------------------------------

async function fetchSchedule() {
  const r = await kino.fetch(SCHEDULE_URL, { headers: { Referer: BASE + "/" } });
  if (!r.ok) throw kino.error("unavailable", "schedule responded " + r.status);
  return r.text();
}

// The site lists the day's events before it has their links: all are returned, including those with 0 signals.
async function loadSchedule() {
  return parseSchedule(await fetchSchedule());
}

// "Copa Libertadores: Estudiantes LP vs Flamengo" -> { competition, match }. Without ":", the
// competition is the tag (AR, COL…) the site gave the event.
export function splitEvent(name, tag) {
  const i = name.indexOf(": ");
  return i > 0
    ? { competition: name.slice(0, i), match: name.slice(i + 2) }
    : { competition: tag || t("otherCompetition"), match: name };
}

// Tags: the codes the site gives each event (AR, LIB, MEX…; the class of the schedule's <li>).
// The "orden" setting sorts them to the person's liking: "AR,LIB,SUD" puts those first, in that order, and the rest
// go after in schedule order (as they appear). Empty = schedule order.
export function tagOrder() {
  const raw = kino.config.get("orden");
  return typeof raw === "string" ? raw.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
}

const tagRank = (tag, order) => {
  const i = order.indexOf(String(tag || "").toUpperCase());
  return i < 0 ? order.length : i;
};

// Hours a match lasts ("duracion" setting, text). An invalid value or one outside 0.5 to 12 falls back to the default.
export function durationHours() {
  const n = Number(String(kino.config.get("duracion") ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0.5 && n <= 12 ? n : DEFAULT_DURATION;
}

// What sorting uses: the setting's tags, the current time and how long a match lasts. Without context (now =
// -Infinity) nothing "has ended" and only the tag counts.
const NO_SORT = { order: [], now: -Infinity, durationMs: 0 };
export const sortContext = () => ({ order: tagOrder(), now: Date.now(), durationMs: durationHours() * 3600000 });

const hasEnded = (e, ctx) => e.startMs != null && e.startMs + ctx.durationMs <= ctx.now;

// Overall order: 1) ended ones last, 2) tags of the "orden" setting (the rest, after them, in schedule
// order), 3) start time, 4) with signal before without, 5) schedule order. So, if Kino trims a long
// list, what gets lost is what already happened.
export function sortEvents(events, ctx = NO_SORT) {
  return events
    .map((e, i) => ({ e, i, ended: hasEnded(e, ctx) ? 1 : 0, rank: tagRank(e.tag, ctx.order) }))
    .sort((a, b) =>
      a.ended - b.ended ||
      a.rank - b.rank ||
      (a.e.startMs ?? 0) - (b.e.startMs ?? 0) ||
      (b.e.options.length > 0) - (a.e.options.length > 0) ||
      a.i - b.i)
    .map((x) => x.e);
}

// Competitions with their events. The events are sorted (see sortEvents) and each competition takes the place of
// its first event: so a competition moves up or down with its highest-priority event.
export function groupByCompetition(events, ctx = NO_SORT) {
  const groups = new Map();
  for (const e of sortEvents(events, ctx)) {
    const { competition, match } = splitEvent(e.name, e.tag);
    if (!groups.has(competition)) groups.set(competition, { id: "co-" + hash(competition), title: competition, events: [] });
    groups.get(competition).events.push({ ...e, match });
  }
  return [...groups.values()];
}

export function timeZone() {
  const n = Number(kino.config.get("tz"));
  return Number.isFinite(n) && n >= -12 && n <= 14 ? n : DEFAULT_TZ;
}

// "00:00" (UTC+1) -> "20:00" in UTC-3. Time of day only: if it crosses midnight, the day is not marked.
export function convertTime(hhmm, tz) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return hhmm || null;
  const minutes = (((Number(m[1]) * 60 + Number(m[2]) + (tz - SCHEDULE_UTC) * 60) % 1440) + 1440) % 1440;
  const two = (n) => String(n).padStart(2, "0");
  return two(Math.floor(minutes / 60)) + ":" + two(minutes % 60);
}

const eventId = (e) => "ev-" + hash(e.name);

// In a mixed list ("Todos") the title carries the competition; inside a competition, it does not.
const eventTitle = (e, tz, withCompetition = false) => {
  const time = convertTime(e.time, tz);
  const name = withCompetition ? e.name : (e.match ?? splitEvent(e.name, e.tag).match);
  return (time ? time + " · " : "") + name;
};

const eventRef = (e) => EVENT_PREFIX + eventId(e);

const eventItem = (e, tz, withCompetition = false) => ({
  id: eventId(e),
  ref: eventRef(e),
  title: eventTitle(e, tz, withCompetition),
  kind: "live",
  overview: e.name,
  badges: e.tag ? [e.tag] : undefined,
  poster: e.icon || undefined,
});

// Home: a single row with every event (not split by competition).
export async function home() {
  const tz = timeZone();
  const events = sortEvents(await loadSchedule(), sortContext());
  if (!events.length) return [];
  return [{
    id: ALL_ID,
    title: t("allEvents"),
    items: events.slice(0, MAX_ROW_ITEMS).map((e) => eventItem(e, tz, true)),
  }];
}

// Live tab: the "Todos" category first and then one category per competition.
export async function liveCategories() {
  const events = await loadSchedule();
  if (!events.length) return [];
  const groups = groupByCompetition(events, sortContext()).slice(0, 199);
  return [
    { id: ALL_ID, title: t("allCategory"), genre: GENRE },
    ...groups.map((g) => ({ id: g.id, title: g.title, genre: GENRE })),
  ];
}

export async function liveChannels({ categoryId }) {
  const tz = timeZone();
  const events = await loadSchedule();
  const all = categoryId === ALL_ID;
  const ctx = sortContext();
  const list = all ? sortEvents(events, ctx) : groupByCompetition(events, ctx).find((g) => g.id === categoryId)?.events;
  if (!list) return { items: [] };
  return {
    items: list.slice(0, 500).map((e, i) => ({
      id: eventId(e),
      title: eventTitle(e, tz, all),
      ref: eventRef(e),
      categoryId,
      number: i + 1,
      logo: e.icon || undefined,
    })),
  };
}

// --- Settings: "Actualizar eventos ahora" button -------------------------------------------------------
// Kino keeps Home rows for 6 h and Live lists for 1 h, and the plugin cannot clear them. What Kino does do
// when an action clears a setting is close the sandbox and forget the stored Home rows (same as saving any
// change). That is why the button clears the "forzar" setting, which serves no other purpose: it must
// NEVER include "tz" (it would go back to UTC-3). If the schedule cannot be read, the action throws and
// Kino clears nothing.
export const SETTINGS_TO_CLEAR = ["forzar"];

export async function action(key) {
  if (key === "mapa") return tagMapAction();
  if (key === "etiquetas") return siteTagsAction();
  if (key !== "actualizar") return { message: t("done") };
  const events = await loadSchedule();
  const withSignal = events.filter((e) => e.options.length).length;
  const competitions = groupByCompetition(events).length;
  kino.log("forced refresh v" + VERSION, events.length + " events", withSignal + " with signal");
  // Without events there is nothing to refresh: nothing is cleared and the person is told.
  if (!events.length) return { message: t("noEventsToday") };
  return {
    message: t("scheduleRead", { events: events.length, withSignal, competitions }),
    clearSettings: SETTINGS_TO_CLEAR,
  };
}

// --- Settings: "Ver mapa de competiciones" button ------------------------------------------------------
// Live only shows the competition name, but the "orden" setting asks for the tag (AR, LIB…). The button
// lists which tag each competition of the current schedule has. An action message allows 300 characters,
// so if it does not fit it is split into pages: each press shows the next one (the page is kept in kino.storage).
const MAX_PAGE_CHARS = 230;

export function tagMap(events) {
  const byTag = new Map();
  for (const e of events) {
    const tag = String(e.tag || "?").toUpperCase();
    const { competition } = splitEvent(e.name, e.tag);
    if (!byTag.has(tag)) byTag.set(tag, []);
    if (!byTag.get(tag).includes(competition)) byTag.get(tag).push(competition);
  }
  return [...byTag].map(([tag, competitions]) => `${tag}: ${competitions.join(", ")}`);
}

export function paginate(entries, max = MAX_PAGE_CHARS) {
  const pages = [];
  let current = "";
  for (const entry of entries) {
    const short = entry.length > max ? entry.slice(0, max - 1) + "…" : entry;
    if (current && (current + "\n" + short).length > max) {
      pages.push(current);
      current = short;
    } else {
      current = current ? current + "\n" + short : short;
    }
  }
  if (current) pages.push(current);
  return pages;
}

// Shows a long list one chunk per press (the page is kept in kino.storage under `storageKey`).
function pagedMessage(entries, storageKey) {
  const pages = paginate(entries);
  let n = Number(kino.storage.get(storageKey));
  if (!Number.isInteger(n) || n < 0 || n >= pages.length) n = 0;
  kino.storage.set(storageKey, String((n + 1) % pages.length));
  const footer = pages.length > 1 ? `\n(${n + 1}/${pages.length}) ${t("pressAgain")}` : "";
  return { message: pages[n] + footer, pages: pages.length };
}

async function tagMapAction() {
  const entries = tagMap(await loadSchedule());
  if (!entries.length) return { message: t("noTagsYet") };
  const { message, pages } = pagedMessage(entries, "tagMapPage");
  kino.log("tag map v" + VERSION, entries.length + " tags", pages + " pages");
  return { message };
}

// "Ver todas las etiquetas" button: the tags the site knows in its CSS (even with no matches today) and the name
// of their image, which usually tells the tournament or country ("libertadore", "sudamericana", "championsleague"…).
async function siteTagsAction() {
  const entries = siteTags(scheduleIcons(await fetchSchedule()));
  if (!entries.length) return { message: t("siteTagsUnreadable") };
  const { message, pages } = pagedMessage(entries, "siteTagsPage");
  kino.log("site tags v" + VERSION, entries.length + " tags", pages + " pages");
  return { message };
}

// --- resolve ---------------------------------------------------------------------------------------

export async function resolve(ref) {
  await Promise.resolve(); // Kino 0.9.49 and earlier do not catch a throw before the first await
  if (ref.startsWith(EVENT_PREFIX)) return resolveEventById(ref.slice(EVENT_PREFIX.length));
  if (ref.startsWith(LEGACY_PREFIX)) return resolveLegacyEvent(ref);
  return resolveSignal(ref);
}

// An event by its id: rereads the schedule and resolves the signals it has now.
async function resolveEventById(id) {
  const event = (await loadSchedule()).find((e) => eventId(e) === id);
  if (!event) throw kino.error("not_found", "event is no longer in the schedule", { userMessage: t("eventGone") });
  if (!event.options.length) {
    kino.log("event without signals", event.tag);
    throw kino.error("not_found", "event has no signals yet", { userMessage: t("noSignalYet") });
  }
  return resolveSignals(event.options);
}

// Ref from earlier versions: the signals come copied in the ref itself as { n: label, e: embed }.
async function resolveLegacyEvent(ref) {
  let signals;
  try {
    signals = JSON.parse(ref.slice(LEGACY_PREFIX.length)).map((s) => ({ label: String(s.n), embed: String(s.e) }));
    if (!signals.length) throw new Error("no signals");
  } catch {
    throw kino.error("not_found", "invalid event ref");
  }
  return resolveSignals(signals);
}

// Tries the signals in schedule order and returns the first one that works. The rest go as labeled copies,
// although Kino ignores them on live channels.
async function resolveSignals(list) {
  const signals = list.map((s) => ({ label: s.label.slice(0, 48), embed: s.embed }));
  let unknown = 0;
  for (const [i, signal] of signals.entries()) {
    try {
      const stream = await resolveSignal(signal.embed);
      return {
        ...stream,
        label: signal.label,
        alternatives: signals.filter((_, j) => j !== i).map((s) => ({ label: s.label, ref: s.embed })),
      };
    } catch (e) {
      if (e.unknownServer) unknown++;
      kino.log("signal skipped", new URL(signal.embed).hostname, e.code);
    }
  }
  if (unknown === signals.length) {
    throw kino.error("not_found", "every signal is on an unsupported server", { userMessage: t("unknownServer") });
  }
  throw kino.error("unavailable", "no signal responded", { userMessage: t("noSignalWorked") });
}

// A signal (a server's embed): resolved with its domain's methods.
async function resolveSignal(ref) {
  let embed;
  try {
    embed = new URL(ref);
  } catch {
    throw kino.error("not_found", "invalid ref");
  }
  kino.log("resolve v" + VERSION, embed.hostname);
  const methods = EXTRACTORS[embed.hostname];
  if (!methods) {
    // Logged so it reaches the author through the debug mode log.
    kino.log("unsupported server: " + embed.hostname, embed.href);
    const error = kino.error("not_found", "unsupported server: " + embed.hostname, { userMessage: t("unknownServer") });
    error.unknownServer = true;
    throw error;
  }
  let last;
  for (const { name, extract } of methods) {
    try {
      const stream = await extract(embed.href);
      kino.log("method ok", embed.hostname, name);
      return stream;
    } catch (e) {
      kino.log("method failed", embed.hostname, name, e.code, e.message);
      last = e;
      if (e.offAir) break;
    }
  }
  throw last;
}

// la18hd.su only answers (403 otherwise) a load that looks like an iframe.
function la18hdHeaders(referer) {
  return { Referer: referer, "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site" };
}

// "direct" method: some servers' player has the m3u8 in plain text, as `var playbackURL = "…"` or as
// `window.CDNPEER = {"src":"…"}` (la18hd.su since October 2026).
// `playerUrl(stream, embed)` builds the player's address from the embed's `stream` parameter.
const MOBILE_CHROME_UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const PLAYBACK_PATTERNS = [/playbackURL\s*=\s*["']([^"']+)["']/, /CDNPEER\s*=\s*\{[^<]*?"src"\s*:\s*"([^"]+)"/];

function extractPlayback(playerUrl, headers = {}) {
  return async (embed) => {
    const stream = new URL(embed).searchParams.get("stream");
    if (!stream) throw kino.error("not_found", "embed has no stream parameter");
    const player = playerUrl(stream, embed);
    const r = await kino.fetch(player, { headers: { "User-Agent": MOBILE_CHROME_UA, ...headers } });
    if (!r.ok) throw kino.error("unavailable", new URL(player).hostname + " responded " + r.status);
    const html = await r.text();
    const url = PLAYBACK_PATTERNS.map((p) => p.exec(html)?.[1]).find(Boolean)?.replace(/\\\//g, "/");
    if (!/^https:\/\//.test(url ?? "")) throw kino.error("not_found", new URL(player).hostname + " has no playbackURL");
    const result = { url, mime: MIME_HLS, headers: { "User-Agent": MOBILE_CHROME_UA } };
    await checkOnAir(result);
    return result;
  };
}

// Players hand out the URL even when the channel is off air (before a match, for example), and the hidden
// browser also "captures" it even if it does not respond. Kino retries that m3u8 without moving to another signal, so
// the playlist is requested before returning it: if it answers an error, does not answer in time or is not an HLS
// playlist, the channel is off air and the next signal is tried right away (without trying another method of that
// server, which would see the same channel). Video servers are not in the manifest (they change often): Kino asks the
// person whether to allow each one, and if not allowed the m3u8 is returned unchecked.
async function checkOnAir({ url, headers }) {
  const host = new URL(url).hostname;
  const offAir = (reason) => {
    const error = kino.error("unavailable", "channel off air: " + host + " " + reason);
    error.offAir = true;
    return error;
  };
  let r;
  try {
    r = await kino.fetch(url, { headers, timeoutMs: 8000 });
  } catch (e) {
    if (e.code === "host_not_allowed") {
      kino.log("m3u8 not checked (host not allowed)", host);
      return;
    }
    throw offAir("did not respond (" + (e.code || e.message) + ")");
  }
  const playlist = r.ok ? await r.text() : "";
  if (!playlist.trimStart().startsWith("#EXTM3U")) throw offAir("responded " + r.status);
}

// "decrypt" method (spf24live): the page only has an iframe to the player (missflight.net, now tossequip.net), which
// serves it if the Referer is spf24live.st and the User-Agent is Chrome's (not a WebView). The iframe keeps the m3u8 in
// window._econfig: base64 of four equal chunks, each base64 with a padding character at position 3, which joined
// in the order 1, 3, 0, 2 are the base64 of a JSON with `stream_url`. The segments require the iframe's Referer.
const ECONFIG_ORDER = [1, 3, 0, 2];

export function decryptEconfig(econfig) {
  const all = atob(econfig);
  const n = all.length / 4;
  if (!Number.isInteger(n) || n < 5) throw new Error("econfig has an unexpected length");
  const chunks = [0, 1, 2, 3].map((i) => {
    const chunk = all.slice(i * n, (i + 1) * n);
    return atob(chunk.slice(0, 3) + chunk.slice(4));
  });
  return JSON.parse(atob(ECONFIG_ORDER.map((i) => chunks[i]).join("")));
}

async function extractSpf24(embed) {
  const get = async (url, referer) => {
    const r = await kino.fetch(url, { headers: { Referer: referer, "User-Agent": MOBILE_CHROME_UA } });
    if (!r.ok) throw kino.error("unavailable", new URL(url).hostname + " responded " + r.status);
    return r.text();
  };
  const page = await get(embed, BASE + "/");
  const iframe = /<iframe[^>]+src=["'](https:\/\/[^"']+)["']/i.exec(page)?.[1];
  if (!iframe) throw kino.error("not_found", "spf24live has no iframe");
  const player = await get(iframe, "https://spf24live.st/");
  const econfig = /_econfig\s*=\s*["']([A-Za-z0-9+/=]+)["']/.exec(player)?.[1];
  if (!econfig) throw kino.error("not_found", "iframe has no config (" + new URL(iframe).hostname + ")");
  let config;
  try {
    config = decryptEconfig(econfig);
  } catch (e) {
    throw kino.error("not_found", "could not decrypt config: " + e.message);
  }
  const url = config.stream_url || config.stream_url_nop2p;
  if (!/^https:\/\//.test(url ?? "")) throw kino.error("not_found", "config has no stream_url");
  const stream = { url, mime: MIME_HLS, headers: { Referer: new URL(iframe).origin + "/", "User-Agent": MOBILE_CHROME_UA } };
  await checkOnAir(stream);
  kino.log("spf24live ok", new URL(iframe).hostname, new URL(url).hostname);
  return stream;
}

// "browser" method: the page builds the player with its scripts, so it is opened hidden and the .m3u8
// request is taken. The headers it returns (Referer, User-Agent…) must be passed to the player.
// `referer` is optional: only for embeds that require it on the first load.
function extractByNetwork({ referer } = {}) {
  return async (embed) => {
    const host = new URL(embed).hostname;
    let capture;
    try {
      capture = await kino.browser.capture(embed, {
        ...(referer ? { headers: { Referer: referer } } : {}),
        timeoutMs: 15000, // Kino gives a lazy copy 20 s and the whole resolve 75 s
        match: "\\.m3u8",
      });
    } catch (e) {
      kino.log("capture failed", host, e.code, e.message);
      throw kino.error("unavailable", "capture " + (e.code || "failed"), { userMessage: t("signalUnavailable") });
    }
    kino.log("capture ok", host, capture.media.length + " media");
    const media = capture.media.find((m) => /\.m3u8/i.test(m.url)) ?? capture.media[0];
    if (!media) throw kino.error("not_found", "page requested no video");
    const result = { url: media.url, mime: MIME_HLS, headers: media.headers };
    await checkOnAir(result);
    return result;
  };
}

// agenda.php: <b>Agenda - Viernes 16 de Octubre de 2026</b>
//   <li class="TAG"><a href="#">Event <span class="t">time</span></a><ul>
//   <li><a href="/eventos.html?r=BASE64">Option <span>Quality</span></a></li>…</ul></li>
// Each event carries `startMs` (UTC): the header date + its UTC+1 time. The schedule is chronological and
// goes past midnight, so when the time drops compared to the previous one it is the next day.
// The months are in Spanish because that is how the site writes them.
const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };

function scheduleDate(html) {
  const m = /Agenda[^<]*?(\d{1,2})\s+de\s+([A-Za-zñÑ]+)\s+de\s+(\d{4})/.exec(html);
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return month === undefined ? null : Date.UTC(Number(m[3]), month, Number(m[1]));
}

// The schedule's CSS gives each tag its image: `.AR > a:before { background-image: url(https://…/argentina.png) }`.
// It is read from there (the list is not copied) so a new tag or a changed image is picked up on its own.
export function scheduleIcons(html) {
  const icons = {};
  for (const m of html.matchAll(/\.([A-Za-z0-9_]+)\s*>\s*a:before\s*\{[^}]*?url\(\s*["']?([^"')]+?)["']?\s*\)/g)) {
    const url = m[2].trim().replace(/ /g, "%20");
    if (/^https:\/\//.test(url)) icons[m[1]] = url;
  }
  return icons;
}

// "ARA: arabia", "LIB: libertadore"…: the tag and its image name (without folder or extension).
export function siteTags(icons) {
  return Object.entries(icons).map(([tag, url]) => {
    let name = url.split("/").pop().split("?")[0];
    try { name = decodeURIComponent(name); } catch { /* left as is */ }
    return `${tag}: ${name.replace(/\.[A-Za-z0-9]+$/, "")}`;
  });
}

export function parseSchedule(html) {
  const events = [];
  const eventRe = /<li class="([\w-]+)">\s*<a href="#">([\s\S]*?)<\/a>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
  for (const m of html.matchAll(eventRe)) {
    const header = m[2];
    const time = (/<span class="t">([^<]*)<\/span>/.exec(header) || [])[1];
    const options = [];
    for (const o of m[3].matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const embed = decodeR(o[1]);
      if (embed) options.push({ label: clean(o[2]), embed });
    }
    events.push({
      tag: m[1],
      time: time ? time.trim() : null,
      name: clean(header.replace(/<span class="t">[\s\S]*?<\/span>/, "")),
      options,
      startMs: null,
      icon: null,
    });
  }
  const icons = scheduleIcons(html);
  for (const e of events) e.icon = icons[e.tag] ?? null;
  const base = scheduleDate(html);
  let day = 0;
  let previous = -1;
  for (const e of events) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(e.time || "");
    if (base === null || !m) continue;
    const minutes = Number(m[1]) * 60 + Number(m[2]);
    if (previous >= 0 && minutes < previous) day++;
    previous = minutes;
    e.startMs = base + day * 86400000 + minutes * 60000 - SCHEDULE_UTC * 3600000;
  }
  return events;
}

// The link's `r` parameter is the embed URL in base64.
function decodeR(href) {
  const m = /[?&]r=([^&"]+)/.exec(href);
  if (!m) return null;
  try {
    const url = atob(decodeURIComponent(m[1]));
    return /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function clean(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stable, valid ids (^[A-Za-z0-9._~-]{1,128}$) from a text.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
