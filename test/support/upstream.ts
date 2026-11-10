// Shared fakes for tests that run a whole check against canned Hyperliquid,
// block explorer and public-node answers: fetch routed by URL and request body.
import { vi } from 'vitest';
import type { HlClearinghouseState } from '../../src/sources/hyperliquid';
import { HOLDINGS_CHAINS, RPC_URLS, type HoldingsChain } from '../../src/sources/onchain';
import { onchainAnswers, walletOf } from './onchain';
import { arbitrumFunderPage, explorerAnswers, explorerRequestOf, funderPage, type ExplorerPages } from './explorer';
import perpDexs from '../fixtures/hyperliquid/perp-dexs.json';
import abxClearinghouse from '../fixtures/hyperliquid/abraxas/clearinghouse.json';
import abxXyz from '../fixtures/hyperliquid/abraxas/clearinghouse-xyz.json';
import abxOrders from '../fixtures/hyperliquid/abraxas/open-orders.json';
import abxSpot from '../fixtures/hyperliquid/abraxas/spot-balances.json';
import abxFills from '../fixtures/hyperliquid/abraxas/fills-24h.json';
import spotMeta from '../fixtures/hyperliquid/spot-meta.json';
import perpMeta from '../fixtures/hyperliquid/meta-and-asset-ctxs.json';
import abxPortfolio from '../fixtures/hyperliquid/portfolio-abraxas.json';

export const ABRAXAS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';

export type Body = Record<string, unknown>;
/** One canned answer. A factory, because a Response body can be read only once. */
export type Reply = () => Response;
export const reply = (body: unknown, status = 200): Reply => () => new Response(JSON.stringify(body), { status });

export function emptyState(time = abxClearinghouse.time): HlClearinghouseState {
  return {
    assetPositions: [],
    marginSummary: { accountValue: '0.0', totalMarginUsed: '0.0', totalNtlPos: '0.0', totalRawUsd: '0.0' },
    withdrawable: '0.0',
    time,
  };
}

export function hlPosition(coin: string, szi: number, positionValue: number): HlClearinghouseState['assetPositions'][number] {
  return {
    type: 'oneWay',
    position: {
      coin,
      szi: String(szi),
      entryPx: '100',
      leverage: { type: 'cross', value: 5 },
      liquidationPx: null,
      positionValue: String(positionValue),
      unrealizedPnl: '0',
      cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
      marginUsed: '0',
      maxLeverage: 20,
      returnOnEquity: '0',
    },
  };
}

export interface World {
  /** The perpDexs answer; the registry capture (ten named dexes) by default. */
  registry?: Reply;
  /** The main-dex clearinghouse answer; Abraxas's capture by default. */
  main?: Reply;
  /** Named-dex answers; `xyz` is Abraxas's capture, every other dex an empty state. */
  dex?: Record<string, Reply>;
  /** Resting orders on a named dex, by dex; none by default. */
  dexOrders?: Record<string, unknown[]>;
  /** Any other Hyperliquid answer, by request type; Abraxas's captures by default
   * (`portfolio` included, which is where the 30-day PnL comes from). */
  hl?: Record<string, unknown>;
  /** The public nodes, as `onchainAnswers` builds them. Unset, every wallet
   * holds nothing on Ethereum, Arbitrum and HyperEVM. */
  onchain?: (url: string, body: unknown) => Response | null;
  /** The block explorer's funding pages, by wallet and chain. Unset, nothing
   * funded any wallet: an empty last page on every chain. */
  explorer?: ExplorerPages;
}

/** Every request the check sent, in order. */
export interface Sent {
  all: string[];
  hyperliquid: Body[];
  /** Requests to any host the check is not expected to reach (Nansen among
   * them): recorded, and answered by throwing. */
  unrouted: string[];
  /** Holdings reads sent to the public nodes: the chain and the wallet. */
  rpc: Array<{ chain: HoldingsChain; wallet: string }>;
  /** Funding-link reads sent to the block explorer: the chain and the wallet. */
  explorer: Array<{ chain: string; wallet: string }>;
}

/** Routes fetch by URL and request body, the way the real endpoints tell
 * requests apart. Anything unrouted throws, so an unexpected request fails
 * the test loudly. */
export function stub(world: World = {}): Sent {
  const sent: Sent = { all: [], hyperliquid: [], unrouted: [], rpc: [], explorer: [] };
  const onchain = world.onchain ?? onchainAnswers({});
  const explorer = explorerAnswers(world.explorer ?? {});
  const hl: Record<string, unknown> = {
    frontendOpenOrders: abxOrders,
    spotClearinghouseState: abxSpot,
    spotMetaAndAssetCtxs: spotMeta,
    metaAndAssetCtxs: perpMeta,
    userFillsByTime: abxFills,
    portfolio: abxPortfolio.portfolio,
    ...world.hl,
  };
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? '{}')) as Body;
    const chain = HOLDINGS_CHAINS.find((c) => RPC_URLS[c] === u);
    if (chain !== undefined) {
      sent.all.push(`rpc:${chain}`);
      sent.rpc.push({ chain, wallet: walletOf(body) });
      const answer = onchain(u, body);
      if (!answer) throw new Error(`unrouted node request to ${u}`);
      return answer;
    }
    const funding = explorerRequestOf(u);
    if (funding !== null) {
      sent.all.push(`explorer:${funding.chain}`);
      sent.explorer.push(funding);
      return explorer(u)!;
    }
    if (!u.startsWith('https://api.hyperliquid.xyz/')) {
      sent.all.push(`unrouted:${u}`);
      sent.unrouted.push(u);
      throw new Error(`unrouted request ${u}`);
    }
    sent.all.push(`hl:${String(body.type)}${body.dex ? `:${String(body.dex)}` : ''}`);
    sent.hyperliquid.push(body);
    if (body.type === 'perpDexs') return (world.registry ?? reply(perpDexs))();
    if (body.type === 'clearinghouseState') {
      if (body.dex === undefined) return (world.main ?? reply(abxClearinghouse))();
      const named = world.dex?.[String(body.dex)];
      if (named) return named();
      return body.dex === 'xyz' ? reply(abxXyz)() : reply(emptyState())();
    }
    // A named dex is asked for its own orders and market data.
    if (body.dex !== undefined && body.type === 'frontendOpenOrders') return reply(world.dexOrders?.[String(body.dex)] ?? [])();
    if (body.dex !== undefined && body.type === 'metaAndAssetCtxs') return reply([{ universe: [] }, []])();
    if (!(String(body.type) in hl)) throw new Error(`unrouted Hyperliquid ${String(body.type)}`);
    return reply(hl[String(body.type)])();
  }) as unknown as typeof fetch;
  return sent;
}

/** A resting limit order, for a quote on both sides of `coin`. */
export const quote = (coin: string, side: 'B' | 'A', px: string, at: number) => ({
  coin, side, limitPx: px, sz: '1', oid: side === 'B' ? 1 : 2, timestamp: at,
  reduceOnly: false, isTrigger: false, orderType: 'Limit',
});

/** The explorer answering the funding links of `wallet` as fully as it can:
 * each chain names one unlabelled funder. */
export function explorerInFull(wallet: string): ExplorerPages {
  return {
    [wallet]: {
      ethereum: funderPage(wallet, '0x' + 'e1'.repeat(20)),
      arbitrum: arbitrumFunderPage(wallet, '0x' + 'a1'.repeat(20)),
    },
  };
}
