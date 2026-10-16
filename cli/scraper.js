import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (compatible; ScraperBasico/1.0)';

export async function obtenerHtml(url, referer) {
  const headers = { 'User-Agent': USER_AGENT };
  if (referer) headers.Referer = referer;
  const respuesta = await fetch(url, { headers });
  if (!respuesta.ok) {
    throw new Error(`Error ${respuesta.status} al pedir ${url}`);
  }
  return respuesta.text();
}

// URLs absolutas de los iframes de la página (la agenda se carga dentro de uno).
export function parsearIframes(html, urlBase) {
  const $ = cheerio.load(html);
  return $('iframe[src]')
    .map((_, el) => new URL($(el).attr('src'), urlBase).href)
    .get();
}

// El parámetro `r` de /eventos.html es la URL del reproductor en base64.
export function decodificarR(r) {
  if (!r) return null;
  const texto = Buffer.from(r, 'base64').toString('utf8');
  return URL.canParse(texto) ? texto : null;
}

// Enlaces <a> cuyo href empieza con el prefijo indicado, junto con el evento
// (<li class="TIPO"><a href="#">Evento <span class="t">hora</span></a><ul>...)
// al que pertenecen.
export function parsearLinks(html, urlBase, prefijo = '/eventos.html') {
  const $ = cheerio.load(html);
  return $('a[href]')
    .filter((_, el) => $(el).attr('href').startsWith(prefijo))
    .map((_, el) => {
      const a = $(el);
      const li = a.closest('ul').parent('li');
      const cabecera = li.children('a').first().clone();
      const hora = cabecera.find('.t').text().trim();
      cabecera.find('.t').remove();
      const url = new URL(a.attr('href'), urlBase);
      return {
        evento: cabecera.text().replace(/\s+/g, ' ').trim() || null,
        tipo: li.attr('class') ?? null,
        hora: hora || null,
        texto: a.text().replace(/\s+/g, ' ').trim(),
        url: url.href,
        embed: decodificarR(url.searchParams.get('r')),
      };
    })
    .get();
}
