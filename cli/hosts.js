import { readFile } from 'node:fs/promises';
import { SERVERS } from '../plugin.js';

// Compares the domains found in output/streams.json with the ones the plugin knows:
// - embed: the domain of each schedule signal. It must have methods in EXTRACTORS and be in "hosts"; otherwise
//   the plugin skips that signal ("unsupported server"). It is an error.
// - player: the frame that requested the m3u8 (the embed's iframe). The direct and decrypt methods fetch it with
//   kino.fetch; if it is not in "hosts", Kino asks the person whether to allow it. It is a warning: better declare it.
// - video: the m3u8 server. Not declared on purpose (it changes often): Kino asks about it when checking that the
//   channel is on air. Only listed.

const INPUT = process.argv[2] ?? 'output/streams.json';
const { hosts } = JSON.parse(await readFile(new URL('../kino-plugin.json', import.meta.url), 'utf8'));
const streams = JSON.parse(await readFile(INPUT, 'utf8'));

const declared = (host) => hosts.some((h) => h === host || (h.startsWith('*.') && host.endsWith(h.slice(1))));
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

// domain -> events it appears in, by kind
const seen = { embed: new Map(), player: new Map(), video: new Map() };
const note = (kind, url, event) => {
  const host = hostOf(url);
  if (!host) return;
  if (!seen[kind].has(host)) seen[kind].set(host, new Set());
  seen[kind].get(host).add(event);
};

for (const s of streams) {
  note('embed', s.embed, s.name);
  if (!s.stream) continue;
  if (s.stream.player && hostOf(s.stream.player) !== hostOf(s.embed)) note('player', s.stream.player, s.name);
  note('video', s.stream.m3u8, s.name);
}

let errors = 0;
let warnings = 0;
const list = (title, map, problem) => {
  console.log(`\n${title}`);
  if (!map.size) console.log('  (none)');
  for (const [host, events] of [...map].sort()) {
    const bad = problem(host);
    console.log(`  ${bad ? '✗' : '✓'} ${host}${bad ? `  ← ${bad}` : ''}  (${events.size} event${events.size === 1 ? '' : 's'})`);
  }
};

list('Embeds (schedule servers)', seen.embed, (host) => {
  const msg = !SERVERS.includes(host) ? 'no methods in EXTRACTORS' : !declared(host) ? 'missing from hosts' : null;
  if (msg) errors++;
  return msg;
});
list('Players (iframes that request the m3u8)', seen.player, (host) => {
  const msg = !declared(host) ? 'missing from hosts: Kino will ask the person' : null;
  if (msg) warnings++;
  return msg;
});
list('Video servers (m3u8, Kino asks for them)', seen.video, () => null);

const withoutStream = streams.filter((s) => !s.stream).length;
console.log(`\n${streams.length} signals, ${withoutStream} without m3u8 in Chrome.`);
if (errors) {
  console.log(`${errors} schedule server(s) the plugin does not support. Add their methods to EXTRACTORS and their host to kino-plugin.json.`);
  process.exitCode = 1;
} else {
  console.log('Every schedule server is supported.');
}
if (warnings) console.log(`${warnings} warning(s): check the domains marked with ✗.`);
