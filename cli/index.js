import { writeFile } from 'node:fs/promises';
import { obtenerHtml, parsearIframes, parsearLinks } from './scraper.js';
import { BASE } from '../plugin.js';

const URL_INICIAL = process.argv[2] ?? `${BASE}/`;
const PREFIJO = process.argv[3] ?? '/eventos.html';

const html = await obtenerHtml(URL_INICIAL);
const links = parsearLinks(html, URL_INICIAL, PREFIJO);

for (const urlIframe of parsearIframes(html, URL_INICIAL)) {
  console.log(`Iframe: ${urlIframe}`);
  const htmlIframe = await obtenerHtml(urlIframe, URL_INICIAL);
  links.push(...parsearLinks(htmlIframe, urlIframe, PREFIJO));
}

const unicos = [...new Map(links.map((l) => [`${l.evento}|${l.url}`, l])).values()];

if (unicos.length === 0) {
  console.error(`No se encontraron links "${PREFIJO}*": la agenda está vacía o cambió. No se tocó output/links.json.`);
  process.exit(1);
}

await writeFile('output/links.json', JSON.stringify(unicos, null, 2));
console.log(`Listo: ${unicos.length} links "${PREFIJO}*" guardados en output/links.json`);
