import { writeFile } from 'node:fs/promises';
import { fetchHtml, parseIframes, parseLinks } from './scraper.js';
import { BASE } from '../plugin.js';

const START_URL = process.argv[2] ?? `${BASE}/`;
const PREFIX = process.argv[3] ?? '/eventos.html';

const html = await fetchHtml(START_URL);
const links = parseLinks(html, START_URL, PREFIX);

for (const iframeUrl of parseIframes(html, START_URL)) {
  console.log(`Iframe: ${iframeUrl}`);
  const iframeHtml = await fetchHtml(iframeUrl, START_URL);
  links.push(...parseLinks(iframeHtml, iframeUrl, PREFIX));
}

const unique = [...new Map(links.map((l) => [`${l.name}|${l.url}`, l])).values()];

if (unique.length === 0) {
  console.error(`No "${PREFIX}*" links found: the schedule is empty or changed. output/links.json was not touched.`);
  process.exit(1);
}

await writeFile('output/links.json', JSON.stringify(unique, null, 2));
console.log(`Done: ${unique.length} "${PREFIX}*" links saved to output/links.json`);
