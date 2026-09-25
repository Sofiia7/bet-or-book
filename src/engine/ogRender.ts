/**
 * Turns OgCardData into a satori element tree, and that tree into a PNG.
 *
 * Split from src/engine/ogCard.ts because this half needs a WASM runtime and
 * that one does not: `ogTree` is a pure object builder, testable with a
 * plain assertion on its shape, and `renderOgPng` is the only function here
 * that touches satori or resvg. Both the deployed Worker (src/index.ts) and
 * the offline pre-render script (scripts/prerender-og.ts) call the same
 * `renderOgPng`, with the font and the compiled resvg module handed in by
 * whichever environment loaded them - a static `import` in the Worker, a
 * `readFileSync` in the script.
 */
import satori from 'satori';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import type { OgCardData } from './ogCard';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const WHITE = '#ffffff';
const INK = '#111111';
const FAINT = '#767676';

/** A cap on the character count satori is asked to lay out. `lineClamp`
 * keeps the box a fixed height; this keeps satori from doing flow layout
 * on a paragraph twelve lines long in the first place. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A plain object tree - satori's own documented JSX-free API - so this
 * file has no dependency on React. */
export function ogTree(d: OgCardData): object {
  // A read that never finished, or a matching holding with no price, can
  // leave every segment looking complete - Task 3's own reproduction has a
  // zero residual under a partial read. The border is the one cue this
  // picture can give that the text elsewhere on it does not already carry
  // (25.09 audit, A03 "Готово, когда").
  const uncertain = d.dataQuality !== 'measured';
  const bar = d.segments && {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: d.elsewhere ? '58%' : '100%',
        height: 28,
        borderRadius: 4,
        overflow: 'hidden',
        border: uncertain ? `2px dashed ${FAINT}` : '1px solid #d9d9d6',
      },
      children: d.segments.map((seg) => ({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            width: `${Math.max(0.6, seg.share * 100)}%`,
            height: '100%',
            backgroundColor: seg.color,
            opacity: seg.opacity,
          },
        },
      })),
    },
  };

  // What the funders hold goes beside the bar on a dashed line, never inside
  // it - the same drawing as the page's and the downloaded picture's, so the
  // picture that travels with a link does not leave the card's one
  // distinction to the sentence alone.
  const elsewhere = bar && d.elsewhere && [
    {
      type: 'div',
      props: { style: { display: 'flex', width: '6%', height: 0, margin: '0 10px', borderTop: `2px dashed ${FAINT}` } },
    },
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexGrow: 1,
          height: 28,
          alignItems: 'center',
          paddingLeft: 10,
          borderRadius: 4,
          border: `2px dashed ${FAINT}`,
          color: INK,
          fontSize: 20,
          fontWeight: 700,
        },
        children: d.elsewhere.amount,
      },
    },
  ];
  const barRow = bar && {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', width: '100%', marginTop: 30 },
      children: [
        { type: 'div', props: { style: { display: 'flex', alignItems: 'center', width: '100%' }, children: [bar, ...(elsewhere || [])] } },
        ...(d.elsewhere
          ? [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', justifyContent: 'flex-end', color: FAINT, fontSize: 18, marginTop: 6 },
                  children: d.elsewhere.caption,
                },
              },
            ]
          : []),
      ],
    },
  };

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        backgroundColor: WHITE,
        padding: '64px',
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', color: d.accent, fontSize: 30, fontWeight: 700, marginBottom: 22 },
            children: d.badgeText.toUpperCase(),
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              color: INK,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.3,
            },
            children: clip(d.summary, 210),
          },
        },
        // The date and the reading's own limit travel with the badge and the
        // summary now, not only with the page around them - a saved reading
        // opened as a bare image used to carry neither (23.09 audit, U02).
        // Absent on the generic, verdict-less fallback card, which is about
        // no reading in particular and has no date to give.
        ...(d.provenance
          ? [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', color: FAINT, fontSize: 22, marginTop: 14 },
                  children: clip(d.limitText ? `${d.provenance} · ${d.limitText}` : d.provenance, 180),
                },
              },
            ]
          : []),
        ...(barRow ? [barRow] : []),
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 22,
              color: FAINT,
              marginTop: 'auto',
            },
            children: [
              {
                type: 'div',
                props: { style: { display: 'flex', fontWeight: 400 }, children: `Bet or Book · ${d.footerLeft}` },
              },
              {
                type: 'div',
                props: { style: { display: 'flex', fontWeight: 400 }, children: 'Powered by Nansen API' },
              },
            ],
          },
        },
      ],
    },
  };
}

export interface OgFont {
  name: string;
  /** An ArrayBuffer in the Worker (a static `.woff` import); a Buffer when
   * the offline pre-render script or a test reads the same file from disk -
   * the same two types satori's own FontOptions.data accepts. */
  data: ArrayBuffer | Buffer;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style: 'normal' | 'italic';
}

/** Runs `initWasm` at most once per isolate: resvg-wasm throws if asked to
 * initialize a second time, and a Worker can reuse the same isolate - and
 * so the same module-level state - across many requests. */
let resvgReady: Promise<void> | null = null;

export async function renderOgPng(data: OgCardData, fonts: OgFont[], resvgWasmModule: unknown): Promise<Uint8Array> {
  const svg = await satori(ogTree(data) as never, { width: OG_WIDTH, height: OG_HEIGHT, fonts });
  if (!resvgReady) resvgReady = initWasm(resvgWasmModule as never);
  await resvgReady;
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } });
  return resvg.render().asPng();
}
