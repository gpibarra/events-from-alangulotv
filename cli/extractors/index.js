import { extractByNetwork } from './network.js';

// One extractor per domain. If a domain's method changes, write another
// function in this directory and point to it here. Signature: ({ page, embed, referer }) => info | null
const BY_DOMAIN = {
  'spf24live.st': extractByNetwork,
  'latamzy.com': extractByNetwork,
  'sudamericafy.com': extractByNetwork,
};

export function pickExtractor(embed) {
  const { hostname } = new URL(embed);
  return BY_DOMAIN[hostname] ?? extractByNetwork;
}
