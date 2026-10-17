import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const FILE = 'output/streams.json';
const index = process.argv[2];

const streams = JSON.parse(await readFile(FILE, 'utf8'));

if (index === undefined) {
  streams.forEach((s, i) => {
    console.log(`${String(i).padStart(2)} ${s.stream ? '✔' : '✘'} ${s.name} | ${s.label}`);
  });
  console.log('\nUsage: npm run open -- <number>');
  process.exit(0);
}

const s = streams[Number(index)];
if (!s?.stream) {
  console.error(`Index ${index} does not exist or has no m3u8`);
  process.exit(1);
}

const { m3u8, referer, userAgent } = s.stream;
console.log(`Opening in VLC: ${s.name} | ${s.label}`);
// The options go after the URL (as media options): as global options
// VLC ignores --http-user-agent and sends its own UA, which the server rejects with 403.
spawn('vlc', [m3u8, `:http-referrer=${referer}`, `:http-user-agent=${userAgent}`], {
  detached: true,
  stdio: 'ignore',
}).unref();
