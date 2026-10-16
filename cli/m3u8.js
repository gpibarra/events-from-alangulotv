import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { elegirExtractor } from './extractores/index.js';
import { BASE } from '../plugin.js';

const ENTRADA = process.argv[2] ?? 'output/links.json';
const SALIDA = process.argv[3] ?? 'output/streams.json';
const REFERER = `${BASE}/`;
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const links = JSON.parse(await readFile(ENTRADA, 'utf8'));
const embeds = [...new Set(links.map((l) => l.embed).filter(Boolean))];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.VENTANA === '1' ? false : 'new',
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

const porEmbed = new Map();
for (const embed of embeds) {
  const page = await browser.newPage();
  // En modo sin ventana Chrome se anuncia como "HeadlessChrome" y spf24live no sirve el video; se le quita la marca.
  await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
  try {
    const info = await elegirExtractor(embed)({ page, embed, referer: REFERER });
    porEmbed.set(embed, info);
    console.log(info ? `OK   ${embed}\n     ${info.m3u8}` : `FALLO ${embed} (sin m3u8)`);
  } catch (e) {
    porEmbed.set(embed, null);
    console.log(`ERROR ${embed}: ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();

const resultado = links.map((l) => ({ ...l, stream: porEmbed.get(l.embed) ?? null }));
await writeFile(SALIDA, JSON.stringify(resultado, null, 2));
console.log(`Listo: ${resultado.filter((r) => r.stream).length}/${resultado.length} con m3u8 -> ${SALIDA}`);
