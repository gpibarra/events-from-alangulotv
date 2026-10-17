import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (compatible; ScraperBasico/1.0)';

export async function fetchHtml(url, referer) {
  const headers = { 'User-Agent': USER_AGENT };
  if (referer) headers.Referer = referer;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Error ${response.status} fetching ${url}`);
  }
  return response.text();
}

// Absolute URLs of the page's iframes (the schedule loads inside one).
export function parseIframes(html, baseUrl) {
  const $ = cheerio.load(html);
  return $('iframe[src]')
    .map((_, el) => new URL($(el).attr('src'), baseUrl).href)
    .get();
}

// The `r` parameter of /eventos.html is the player URL in base64.
export function decodeR(r) {
  if (!r) return null;
  const text = Buffer.from(r, 'base64').toString('utf8');
  return URL.canParse(text) ? text : null;
}

// <a> links whose href starts with the given prefix, together with the event
// (<li class="TAG"><a href="#">Event <span class="t">time</span></a><ul>...)
// they belong to.
export function parseLinks(html, baseUrl, prefix = '/eventos.html') {
  const $ = cheerio.load(html);
  return $('a[href]')
    .filter((_, el) => $(el).attr('href').startsWith(prefix))
    .map((_, el) => {
      const a = $(el);
      const li = a.closest('ul').parent('li');
      const header = li.children('a').first().clone();
      const time = header.find('.t').text().trim();
      header.find('.t').remove();
      const url = new URL(a.attr('href'), baseUrl);
      return {
        name: header.text().replace(/\s+/g, ' ').trim() || null,
        tag: li.attr('class') ?? null,
        time: time || null,
        label: a.text().replace(/\s+/g, ' ').trim(),
        url: url.href,
        embed: decodeR(url.searchParams.get('r')),
      };
    })
    .get();
}
