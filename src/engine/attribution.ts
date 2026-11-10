/**
 * Who a reading credits, worked out from the sources the reading itself used.
 *
 * A share, an embed, a downloaded card and a link-preview picture each print
 * a credit line. The line used to depend on nothing but `source`: Nansen for
 * a reading that used it, Hyperliquid for any other. Since the Nansen client
 * was removed a new reading uses Hyperliquid (positions, orders, fills, PnL),
 * the public nodes (balances on three chains) and, when it looked for the
 * wallets that funded the account, the Blockscout explorer, and the credit
 * has to say exactly that - no more and no less. The page scripts cannot
 * import this file (they are bundled for the browser without src/), so the
 * Worker works the three strings out and sends them with the reading.
 *
 * A reading made with Nansen keeps its Nansen credit exactly: it is still
 * shown, and the data in it is Nansen's. "Made with Nansen" is wider than
 * `source === 'nansen'` (see `madeWithNansen`): the old Worker set `source`
 * to 'hyperliquid' whenever the Nansen positions call had not succeeded, and
 * such a reading can still carry Nansen's PnL, balances or funders.
 */
import type { CheckResponse } from '../api/check';
import { madeWithExplorer } from './evidence';

export interface Attribution {
  /** The DTO's and the embed's credit line. */
  publisher: string;
  /** The line at the end of a share text and a post. */
  post: string;
  /** The line on the downloaded card and on the link-preview picture. */
  card: string;
}

const NANSEN: Attribution = {
  publisher: 'Powered by Nansen API',
  post: 'Powered by @nansen_ai',
  card: 'Powered by Nansen API',
};

type Reading = Pick<CheckResponse, 'source' | 'hedgeScope' | 'positionsVenues' | 'linkedHedge' | 'vitals' | 'evidence'> &
  // Optional: a reading that is being worked out now has no count yet, and
  // none made since stage 3 has a Nansen call to count.
  Partial<Pick<CheckResponse, 'nansenCalls'>>;

/**
 * Whether any of the data a reading carries is Nansen's, so that it keeps the
 * Nansen credit exactly. Any one of these is enough:
 *
 * - `source` says 'nansen';
 * - it counts a Nansen call (`nansenCalls` above zero);
 * - an evidence row or a vital names Nansen as its source;
 * - its scope is 'all-chains': only Nansen read every chain;
 * - it was made before the links moved to the explorer and lists funders: the
 *   funders came from Nansen.
 *
 * The first alone is not enough. Two readings in the bundled archive, and any
 * stored reading made while the Nansen positions call failed, say
 * source 'hyperliquid' and still carry Nansen's PnL, balances or funders.
 */
function madeWithNansen(r: Reading): boolean {
  if (r.source === 'nansen') return true;
  if ((r.nansenCalls ?? 0) > 0) return true;
  if ([...(r.evidence ?? []), ...(r.vitals ?? [])].some((item) => item.source.includes('Nansen'))) return true;
  if (r.hedgeScope === 'all-chains') return true;
  return !madeWithExplorer(r) && (r.linkedHedge ?? null) !== null;
}

/**
 * What a reading used, named by the part of the credit it earns.
 *
 * - Hyperliquid: always. The positions, orders and fills are its.
 * - Public nodes: when the balances were read from them: a reading whose scope
 *   is `known-tokens`, or one made since the links moved to the explorer that
 *   lists funders (their balances came from the nodes even when its own node
 *   reads all failed and its scope fell back to `hyperliquid`).
 * - Blockscout: when anything on the reading carries an explorer source, or
 *   when a reading made since the links moved to the explorer lists funding
 *   wallets at all. The five evidence rows can leave the "Linked wallets" row
 *   out (a decisive row of another kind comes first, or the funders hold
 *   nothing that matches), so the rows alone would under-credit a reading
 *   whose funders decided it.
 *
 * "Made since" is `madeWithExplorer`, the one rule the Linked wallets row and
 * the page use. It is not `source`: the old Worker set `source` to 'hyperliquid'
 * whenever the Nansen positions call had not succeeded, and such a reading can
 * still carry funders, which came from Nansen and are not Blockscout's - it
 * keeps the Nansen credit (`madeWithNansen`).
 */
export function attributionOf(r: Reading): Attribution {
  if (madeWithNansen(r)) return { ...NANSEN };
  const listsFunders = madeWithExplorer(r) && (r.linkedHedge ?? null) !== null;
  const usesNodes = r.hedgeScope === 'known-tokens' || listsFunders;
  const usesExplorer =
    listsFunders || [...(r.evidence ?? []), ...(r.vitals ?? [])].some((item) => item.source.includes('Explorer'));
  const line = (hyperliquid: string): string =>
    'Data: ' + [hyperliquid, ...(usesNodes ? ['public nodes'] : []), ...(usesExplorer ? ['Blockscout'] : [])].join(', ');
  return { publisher: line('Hyperliquid API'), post: line('Hyperliquid'), card: line('Hyperliquid API') };
}
