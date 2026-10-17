import { readFile } from 'node:fs/promises';
import { SERVIDORES } from '../plugin.js';

// Compara los dominios que aparecieron en output/streams.json con los que conoce el plugin:
// - embed: el dominio de cada señal de la agenda. Tiene que tener métodos en EXTRACTORES y estar en "hosts"; si no,
//   el plugin descarta esa señal ("servidor no soportado"). Es un error.
// - reproductor: el frame que pidió el m3u8 (el iframe del embed). Los métodos directo y descifrado lo piden con
//   kino.fetch; si no está en "hosts", Kino le pregunta a la persona si lo permite. Es un aviso: conviene declararlo.
// - video: el servidor del m3u8. No se declara a propósito (cambia seguido): Kino pregunta por él al comprobar que el
//   canal esté en el aire. Solo se lista.

const ENTRADA = process.argv[2] ?? 'output/streams.json';
const { hosts } = JSON.parse(await readFile(new URL('../kino-plugin.json', import.meta.url), 'utf8'));
const streams = JSON.parse(await readFile(ENTRADA, 'utf8'));

const declarado = (host) => hosts.some((h) => h === host || (h.startsWith('*.') && host.endsWith(h.slice(1))));
const hostDe = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

// dominio -> eventos en los que aparece, por tipo
const vistos = { embed: new Map(), reproductor: new Map(), video: new Map() };
const anotar = (tipo, url, evento) => {
  const host = hostDe(url);
  if (!host) return;
  if (!vistos[tipo].has(host)) vistos[tipo].set(host, new Set());
  vistos[tipo].get(host).add(evento);
};

for (const s of streams) {
  anotar('embed', s.embed, s.evento);
  if (!s.stream) continue;
  if (s.stream.reproductor && hostDe(s.stream.reproductor) !== hostDe(s.embed)) anotar('reproductor', s.stream.reproductor, s.evento);
  anotar('video', s.stream.m3u8, s.evento);
}

let errores = 0;
let avisos = 0;
const listar = (titulo, mapa, ok, problema) => {
  console.log(`\n${titulo}`);
  if (!mapa.size) console.log('  (ninguno)');
  for (const [host, eventos] of [...mapa].sort()) {
    const mal = problema(host);
    console.log(`  ${mal ? '✗' : '✓'} ${host}${mal ? `  ← ${mal}` : ''}  (${eventos.size} evento${eventos.size === 1 ? '' : 's'})`);
  }
};

listar('Embeds (servidores de la agenda)', vistos.embed, null, (host) => {
  const msg = !SERVIDORES.includes(host) ? 'sin métodos en EXTRACTORES' : !declarado(host) ? 'falta en hosts' : null;
  if (msg) errores++;
  return msg;
});
listar('Reproductores (iframes que piden el m3u8)', vistos.reproductor, null, (host) => {
  const msg = !declarado(host) ? 'falta en hosts: Kino le va a preguntar a la persona' : null;
  if (msg) avisos++;
  return msg;
});
listar('Servidores de video (m3u8, Kino pregunta por ellos)', vistos.video, null, () => null);

const sinStream = streams.filter((s) => !s.stream).length;
console.log(`\n${streams.length} señales, ${sinStream} sin m3u8 en Chrome.`);
if (errores) {
  console.log(`${errores} servidor(es) de la agenda que el plugin no soporta. Agrega sus métodos en EXTRACTORES y su host en kino-plugin.json.`);
  process.exitCode = 1;
} else {
  console.log('Todos los servidores de la agenda están soportados.');
}
if (avisos) console.log(`${avisos} aviso(s): revisa los dominios marcados con ✗.`);
