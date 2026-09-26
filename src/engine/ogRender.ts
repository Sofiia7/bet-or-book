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
import { constellationSvg } from './constellation';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

// The site is dark-only since Task 1 of the 26.09 redesign, and this picture
// now embeds the constellation diagram (Task 6), which is drawn for a dark
// backdrop (its own dot glow and ghost colors read as intended only against
// something close to #0c0e13, the same panel tone the live page's card
// sits on) - so this whole picture went dark too, not only the diagram
// inside it.
const BG = '#0c0e13';
const FG = '#e6e8ee';
const FAINT = '#8b90a0';

/** A chunk of the 1200x630 card, inset by the same 64px padding the rest of
 * this tree uses on every side - full width minus that padding. Not as tall
 * as Task 3's on-page diagram (260px): this card also carries a badge, a
 * three-line summary and a two-line provenance line above it, and a footer
 * below, inside a fixed 630px height with no scrolling - checked against
 * all four real featured readings by rendering them and looking, not only
 * by arithmetic (this task's own report has what that looked like). */
const CONSTELLATION_WIDTH = OG_WIDTH - 128;
const CONSTELLATION_HEIGHT = 170;
const CONSTELLATION_MARGIN_TOP = 16;

/** satori's flex layout did not reliably reserve enough vertical space for
 * a real (not just worst-case) multi-line summary before this fix existed:
 * a 128-character summary - well under clip()'s own 210-character cap -
 * already wrapped to three lines and visually overlapped the provenance
 * line below it in this task's own rendered-and-looked-at output. A fixed
 * height plus `overflow: hidden` makes the space this box reserves in the
 * flex column deterministic regardless of how many lines the text actually
 * wraps to, so a sibling below it is never overlapped - the same fix this
 * file's own `clip()` doc comment already named ("`lineClamp` keeps the box
 * a fixed height") without actually applying it anywhere. */
const SUMMARY_LINE_HEIGHT = 52; // fontSize 40 * lineHeight 1.3
const SUMMARY_MAX_LINES = 3;
const PROVENANCE_SINGLE_LINE_HEIGHT = 30; // fontSize 22 at its default line height
const PROVENANCE_MAX_LINES = 2;

/**
 * Measured directly against the real font/size/width this line renders at
 * (fontSize 22, Inter regular, a 1072px-wide box - see this task's own
 * follow-up report): a word-wrapped line of ordinary prose holds roughly 88
 * characters before wrapping. PROVENANCE_CLIP_CHARS is sized to keep
 * clip()'s own output - INCLUDING the trailing "…" it adds when it
 * truncates - inside PROVENANCE_MAX_LINES lines with real margin to spare
 * for word-boundary slack (word wrapping does not split mid-word, so a line
 * rarely uses its full theoretical character budget). Without this, the
 * height+overflow fix below only stops the OVERLAP bug - a combined
 * provenance+limitText string past this box's real visual capacity still
 * silently loses its back half to `overflow: hidden`, with no "…" ever
 * appearing on screen, because clip()'s own ellipsis was appended to a
 * string that itself did not fit: a real reading's provenance+limitText
 * this task rendered and looked at was 251 characters combined, well past
 * both the old 180-character cap AND this box's real 2-line capacity of
 * roughly 176 characters, and its clip()-added "…" landed on the invisible
 * third line. This cap is picked so clip() itself is what a reader sees cut
 * a line short, not a mid-word stop with no explanation. */
const PROVENANCE_CLIP_CHARS = 150;

/** A cap on the character count satori is asked to lay out. `lineClamp`
 * keeps the box a fixed height; this keeps satori from doing flow layout
 * on a paragraph twelve lines long in the first place. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The constellation, as a satori `<img>` node with a base64 SVG data URI
 * `src` - the embedding technique this task's own spike (Step 4) proved
 * renders correctly through the real satori+resvg pipeline before any of
 * this function was written. The big stat number and its label sit in a
 * second, absolutely-positioned div over the same box - satori supports
 * `position: 'absolute'` within a flex tree, also confirmed in that spike -
 * matching the on-page centered-stat treatment (Task 2/3) in spirit, not
 * pixel-for-pixel.
 *
 * Returns null exactly when OgCardData.constellation is null - "nothing
 * open right now", the one case with no diagram to draw at all.
 */
function constellationBlockFor(d: OgCardData): object | null {
  if (!d.constellation || !d.constellationStat) return null;
  const svg = constellationSvg(d.constellation, CONSTELLATION_WIDTH, CONSTELLATION_HEIGHT);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'relative',
        width: `${CONSTELLATION_WIDTH}px`,
        height: `${CONSTELLATION_HEIGHT}px`,
        marginTop: CONSTELLATION_MARGIN_TOP,
        borderRadius: 8,
        overflow: 'hidden',
      },
      children: [
        {
          type: 'img',
          props: {
            src: dataUri,
            width: CONSTELLATION_WIDTH,
            height: CONSTELLATION_HEIGHT,
            style: { position: 'absolute', left: '0px', top: '0px' },
          },
        },
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'absolute',
              left: '0px',
              top: '0px',
              width: `${CONSTELLATION_WIDTH}px`,
              height: `${CONSTELLATION_HEIGHT}px`,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: { display: 'flex', color: FG, fontSize: 60, fontWeight: 700, letterSpacing: '-2px' },
                  children: d.constellationStat.value,
                },
              },
              {
                type: 'div',
                props: {
                  style: { display: 'flex', color: FAINT, fontSize: 18, marginTop: 8, letterSpacing: '2px' },
                  children: d.constellationStat.label.toUpperCase(),
                },
              },
              ...(d.dataQuality === 'measured' ? [] : [{
                type: 'div',
                props: {
                  style: { display: 'flex', color: '#f2b35c', fontSize: 16, marginTop: 10, letterSpacing: '1px' },
                  children: d.dataQuality === 'unknown' ? 'COVERAGE UNVERIFIED' : 'INCOMPLETE DATA',
                },
              }]),
            ],
          },
        },
      ],
    },
  };
}

/** A plain object tree - satori's own documented JSX-free API - so this
 * file has no dependency on React. */
export function ogTree(d: OgCardData): object {
  const constellationBlock = constellationBlockFor(d);

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: `${OG_WIDTH}px`,
        height: `${OG_HEIGHT}px`,
        backgroundColor: BG,
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
              color: FG,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.3,
              height: `${SUMMARY_LINE_HEIGHT * SUMMARY_MAX_LINES}px`,
              overflow: 'hidden',
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
                  style: {
                    display: 'flex',
                    color: FAINT,
                    fontSize: 22,
                    lineHeight: 1.3,
                    marginTop: 14,
                    height: `${PROVENANCE_SINGLE_LINE_HEIGHT * PROVENANCE_MAX_LINES}px`,
                    overflow: 'hidden',
                  },
                  // PROVENANCE_CLIP_CHARS (150), not the old 180: this box is two
                  // lines tall now, not one, and the cap is tuned so clip()'s own
                  // "…" is what a reader sees when a reading's caveat is genuinely
                  // long - never a mid-word stop with nothing after it (see that
                  // constant's own doc comment for the real-reading measurement
                  // this number came from).
                  children: clip(d.limitText ? `${d.provenance} · ${d.limitText}` : d.provenance, PROVENANCE_CLIP_CHARS),
                },
              },
            ]
          : []),
        ...(constellationBlock ? [constellationBlock] : []),
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
