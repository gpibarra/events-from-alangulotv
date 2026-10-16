import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const ARCHIVO = 'output/streams.json';
const indice = process.argv[2];

const streams = JSON.parse(await readFile(ARCHIVO, 'utf8'));

if (indice === undefined) {
  streams.forEach((s, i) => {
    console.log(`${String(i).padStart(2)} ${s.stream ? '✔' : '✘'} ${s.evento} | ${s.texto}`);
  });
  console.log('\nUso: npm run open -- <número>');
  process.exit(0);
}

const s = streams[Number(indice)];
if (!s?.stream) {
  console.error(`El índice ${indice} no existe o no tiene m3u8`);
  process.exit(1);
}

const { m3u8, referer, userAgent } = s.stream;
console.log(`Abriendo en VLC: ${s.evento} | ${s.texto}`);
// Las opciones van tras la URL (como opciones del medio): como opciones globales
// VLC ignora --http-user-agent y envía su propio UA, que el servidor rechaza con 403.
spawn('vlc', [m3u8, `:http-referrer=${referer}`, `:http-user-agent=${userAgent}`], {
  detached: true,
  stdio: 'ignore',
}).unref();
