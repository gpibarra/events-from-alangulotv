import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { pickExtractor } from './extractors/index.js';
import { BASE } from '../plugin.js';

const INPUT = process.argv[2] ?? 'output/links.json';
const OUTPUT = process.argv[3] ?? 'output/streams.json';
const REFERER = `${BASE}/`;
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const links = JSON.parse(await readFile(INPUT, 'utf8'));
const embeds = [...new Set(links.map((l) => l.embed).filter(Boolean))];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.SHOW_WINDOW === '1' ? false : 'new',
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

const byEmbed = new Map();
for (const embed of embeds) {
  const page = await browser.newPage();
  // Headless Chrome announces itself as "HeadlessChrome" and spf24live will not serve the video; the mark is removed.
  await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
  try {
    const info = await pickExtractor(embed)({ page, embed, referer: REFERER });
    byEmbed.set(embed, info);
    console.log(info ? `OK    ${embed}\n      ${info.m3u8}` : `FAIL  ${embed} (no m3u8)`);
  } catch (e) {
    byEmbed.set(embed, null);
    console.log(`ERROR ${embed}: ${e.message}`);
  } finally {
    await page.close();
  }
}
await browser.close();

const result = links.map((l) => ({ ...l, stream: byEmbed.get(l.embed) ?? null }));
await writeFile(OUTPUT, JSON.stringify(result, null, 2));
console.log(`Done: ${result.filter((r) => r.stream).length}/${result.length} with m3u8 -> ${OUTPUT}`);
