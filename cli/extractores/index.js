import { extraerPorRed } from './red.js';

// Un extractor por dominio. Si el método de un dominio cambia, se escribe otra
// función en este directorio y se apunta aquí. Firma: ({ page, embed, referer }) => info | null
const POR_DOMINIO = {
  'spf24live.st': extraerPorRed,
  'latamzy.com': extraerPorRed,
  'sudamericafy.com': extraerPorRed,
};

export function elegirExtractor(embed) {
  const { hostname } = new URL(embed);
  return POR_DOMINIO[hostname] ?? extraerPorRed;
}
