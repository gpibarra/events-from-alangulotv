// Método "red": abre el embed en Chrome y captura la primera petición .m3u8
// (el reproductor, en cualquier iframe, la pide solo al cargar).
const ESPERA_MS = 20000;

export async function extraerPorRed({ page, embed, referer }) {
  let hallado = null;

  page.on('request', (req) => {
    if (hallado || !/\.m3u8(\?|$)/i.test(req.url())) return;
    const h = req.headers();
    hallado = {
      m3u8: req.url(),
      referer: h.referer ?? null,
      origin: h.referer ? new URL(h.referer).origin : null,
      userAgent: h['user-agent'],
    };
  });

  await page.goto(embed, { waitUntil: 'domcontentloaded', timeout: 60000, referer });

  const limite = Date.now() + ESPERA_MS;
  while (!hallado && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return hallado;
}
