// Run once (and again only if the design changes): renders the generic,
// verdict-less picture served when a specific reading's own image could not
// be rendered in time - a Worker on the free plan's 10ms CPU budget cannot
// reliably run satori and resvg synchronously (measured: ~26-28ms warm,
// ~55-127ms cold, well documented independently - see docs/architecture.md).
// This keeps a shared link from ever showing a broken image.
import { readFileSync, writeFileSync } from 'node:fs';
import { renderOgPng, type OgFont } from '../src/engine/ogRender';
import type { OgCardData } from '../src/engine/ogCard';

const data: OgCardData = {
  badgeText: 'Bet or Book',
  accent: '#0c447c',
  summary: 'Paste a Hyperliquid address. Is that whale position a bet, a hedge, or a market maker’s book?',
  segments: null,
  footerLeft: 'bet-or-book.sofiaseremeteva.workers.dev',
  // No reading behind this card, so no date and no caveat to give.
  provenance: '',
  limitText: null,
  elsewhere: null,
  // No breakdown at all, same as a card with nothing left to show a caveat
  // about - see OgCardData.dataQuality (25.09 audit, A03/A05 follow-up).
  dataQuality: 'measured',
};

async function main() {
  const fonts: OgFont[] = [
    { name: 'Inter', data: readFileSync('assets/inter-regular.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: readFileSync('assets/inter-bold.woff'), weight: 700, style: 'normal' },
  ];
  const wasmModule = await WebAssembly.compile(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
  const png = await renderOgPng(data, fonts, wasmModule);
  writeFileSync('assets/og-fallback.png', png);
  console.log(`wrote assets/og-fallback.png, ${png.length} bytes`);
}

await main();
