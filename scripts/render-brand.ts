import { readFileSync, writeFileSync } from 'node:fs';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import satori from 'satori';
await initWasm(await WebAssembly.compile(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm')));
const svg = readFileSync('assets/logo.svg', 'utf8');
const renderer = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } });
writeFileSync('assets/logo.png', renderer.render().asPng());
renderer.free();
console.log('Rendered 512px submission logo');
const social = await satori({ type: 'div', props: {
  style: { width: 1200, height: 630, display: 'flex', flexDirection: 'column', padding: 64, backgroundColor: '#08090c', color: '#e6e8ee', fontFamily: 'Inter' },
  children: [
    { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: 24 }, children: [
      { type: 'img', props: { src: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), width: 100, height: 100 } },
      { type: 'div', props: { style: { fontSize: 44, fontWeight: 700 }, children: 'Bet or Book' } },
    ] } },
    { type: 'div', props: { style: { display: 'flex', fontSize: 54, fontWeight: 700, marginTop: 42 }, children: "Look beyond the whale alert." } },
    { type: 'div', props: { style: { display: 'flex', fontSize: 30, lineHeight: 1.4, marginTop: 24, color: '#a3a8b6' }, children: 'A directional bet, a hedge, or trading inventory? Read the evidence behind a Hyperliquid position.' } },
    { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', marginTop: 'auto', fontSize: 22, color: '#858a99' }, children: [
      { type: 'span', props: { children: 'bet-or-book.trade' } },
      { type: 'span', props: { children: 'Hyperliquid · Powered by Nansen API' } },
    ] } },
  ],
} }, { width: 1200, height: 630, fonts: [
  { name: 'Inter', data: readFileSync('assets/inter-regular.woff'), weight: 400 },
  { name: 'Inter', data: readFileSync('assets/inter-bold.woff'), weight: 700 },
] });
const preview = new Resvg(social);
writeFileSync('assets/og-fallback.png', preview.render().asPng());
preview.free();
console.log('Rendered branded 1200x630 root preview');
