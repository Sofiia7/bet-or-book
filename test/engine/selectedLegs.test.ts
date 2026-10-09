import { expect, it } from 'vitest';
import { computePositionFeatures, EMPTY_HEDGE, EMPTY_ORDERS } from '../../src/engine/features';
import { computeVerdict, hedgeCanChangeVerdict } from '../../src/engine/verdict';
import type { Position } from '../../src/types';
const p = (coin: string, side: 'long'|'short', sizeUsd: number): Position => ({ coin, side, sizeUsd, entryPx: 1, leverage: 1, leverageType:'cross', liquidationPx: null, unrealizedPnlUsd: 0, cumFundingUsd: 0 });
it('unrelated matched BTC legs do not block a fully read ETH covered short', () => {
  const positions = computePositionFeatures([p('BTC','long',100),p('BTC','short',100),p('ETH','short',1000)],undefined,{coin:'ETH',side:'short'});
  expect(positions.selectedPerpLegs?.opposingUsd).toBe(0);
  expect(hedgeCanChangeVerdict({ positions, orders: EMPTY_ORDERS, hedge: EMPTY_HEDGE })).toBe(true);
  expect(computeVerdict({ positions, orders: EMPTY_ORDERS, hedge: {...EMPTY_HEDGE,hedgeUsd:1000,hedgeRatio:1} }).verdict).toBe('hedged');
});
it('matching opposing legs and additional same-side shorts still leave combined exposure unresolved', () => {
  for (const other of [p('ETH','long',200),p('ETH','short',200)]) {
    const positions = computePositionFeatures([p('ETH','short',1000), other],undefined,{coin:'ETH',side:'short'});
    expect(computeVerdict({ positions, orders: EMPTY_ORDERS, hedge:{...EMPTY_HEDGE,hedgeUsd:1000,hedgeRatio:1} }).reasons).toContain('perp_offset_unresolved');
  }
});
it('old snapshots without selected legs retain the conservative portfolio guard', () => {
  const positions = computePositionFeatures([p('ETH','short',1000)]);
  delete positions.selectedPerpLegs; positions.sameAssetOffsetShare=0.2;
  expect(computeVerdict({ positions, orders: EMPTY_ORDERS, hedge:EMPTY_HEDGE }).verdict).toBe('unknown');
});
