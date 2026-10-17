// "network" method: opens the embed in Chrome and captures the first .m3u8 request
// (the player, in any iframe, requests it by itself on load).
const WAIT_MS = 20000;

export async function extractByNetwork({ page, embed, referer }) {
  let found = null;

  page.on('request', (req) => {
    if (found || !/\.m3u8(\?|$)/i.test(req.url())) return;
    const h = req.headers();
    found = {
      m3u8: req.url(),
      referer: h.referer ?? null,
      origin: h.referer ? new URL(h.referer).origin : null,
      userAgent: h['user-agent'],
      player: req.frame()?.url() ?? null, // the frame that requested the m3u8 (e.g. the player's iframe)
    };
  });

  await page.goto(embed, { waitUntil: 'domcontentloaded', timeout: 60000, referer });

  const deadline = Date.now() + WAIT_MS;
  while (!found && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return found;
}
