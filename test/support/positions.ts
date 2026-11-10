// Tests written while Nansen supplied the positions describe an account the
// way Nansen answered for it. The positions now come from Hyperliquid's own
// dexes (src/sources/positions.ts); this turns such an answer into the
// reading that read produces, so those tests can keep their accounts.
import { dexOf, type HlClearinghouseState } from '../../src/sources/hyperliquid';
import type { AllDexPositions } from '../../src/sources/positions';
import type { Position } from '../../src/types';
import type { NansenPerpPositions } from './nansenFixtures';

/** A number Nansen sent as a string, or a test's mistake. */
function finite(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) {
    throw new Error(`test positions: ${field} is not a finite number`);
  }
  return n;
}

/** The rows of a Nansen perp-positions answer, as positions. */
export function positionsFromNansen(data: NansenPerpPositions): Position[] {
  return data.asset_positions.map(({ position: p }) => {
    const size = finite(p.size, 'size');
    return {
      coin: p.token_symbol,
      side: size >= 0 ? 'long' : 'short',
      sizeUsd: Math.abs(finite(p.position_value_usd, 'position_value_usd')),
      entryPx: finite(p.entry_price_usd, 'entry_price_usd'),
      leverage: finite(p.leverage_value, 'leverage_value'),
      leverageType: p.leverage_type === 'isolated' ? 'isolated' : 'cross',
      liquidationPx: p.liquidation_price_usd === null ? null : finite(p.liquidation_price_usd, 'liquidation_price_usd'),
      unrealizedPnlUsd: finite(p.unrealized_pnl_usd, 'unrealized_pnl_usd'),
      cumFundingUsd: finite(p.cumulative_funding_since_open_usd, 'cumulative_funding_since_open_usd'),
    };
  });
}

/**
 * A complete all-dex reading holding exactly `positions`. Nansen names a HIP-3
 * market the way Hyperliquid does ("xyz:GOLD"), so the rows carry over as
 * they are, and the main dex holds the ones without a dex prefix. A timestamp
 * that is not a usable time is no time, as `readAllDexPositions` treats it.
 */
export function allDexFrom(
  positions: NansenPerpPositions,
  mainState: HlClearinghouseState,
  over: Partial<AllDexPositions> = {},
): AllDexPositions {
  const rows = positionsFromNansen(positions);
  const time = positions.timestamp;
  return {
    positions: rows,
    coverage: 'complete',
    measuredAt: typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : null,
    venues: { asked: 1, answered: 1, registryRead: true },
    failed: [],
    mainDexCount: rows.filter((p) => dexOf(p.coin) === null).length,
    mainState,
    registry: null,
    ...over,
  };
}
