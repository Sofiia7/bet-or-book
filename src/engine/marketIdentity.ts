import type { PerpVenue } from '../marketRegistry';
const SOURCE = 'https://docs.trade.xyz/perpetuals/specifications-and-schedules/specification-index';
const OPERATOR = '0x88806a71d74ad0a510b350545c9ae490912f0888';
export const MARKET_DEFINITION_VERSION = 1;
const REVIEWED_AT = '2026-10-09';
const REVIEW_UNTIL = '2026-10-16';
/** Exact publisher-defined markets, bound to the deployment and operator.
 * This catalogue does not establish crypto aliases or spot equivalence. */
const UNDERLYING: Readonly<Record<string, string>> = {
  SP500: 'S&P 500 equity index', BRENTOIL: 'One barrel of Brent crude oil',
  GOLD: 'One troy ounce of gold in USD', SILVER: 'One troy ounce of silver in USD',
  AAPL: 'One Apple common share in USD', NVDA: 'One NVIDIA common share in USD',
  TSLA: 'One Tesla common share in USD', MSFT: 'One Microsoft common share in USD',
  GOOGL: 'One Alphabet Class A share in USD', AMZN: 'One Amazon common share in USD',
  META: 'One Meta Class A share in USD',
};
export interface MarketDefinition {
  version: number; status: 'documented' | 'unreviewed' | 'registry-missing' | 'operator-mismatch' | 'review-expired';
  underlying: string | null; source: string | null; reviewedAt: string | null; reviewUntil: string | null;
  spotEquivalent: false;
}
export function marketDefinition(coin: string, venue: PerpVenue | null, now: number): MarketDefinition {
  const parts = coin.split(':');
  const [deployment, ticker] = parts;
  const underlying = parts.length === 2 && deployment === 'xyz' && Object.hasOwn(UNDERLYING, ticker) ? UNDERLYING[ticker] : null;
  const result: MarketDefinition = { version: MARKET_DEFINITION_VERSION, status: 'unreviewed', underlying,
    source: underlying ? SOURCE : null, reviewedAt: underlying ? REVIEWED_AT : null, reviewUntil: underlying ? REVIEW_UNTIL : null, spotEquivalent: false };
  if (!underlying || now < Date.parse(REVIEWED_AT)) return result;
  if (now >= Date.parse(REVIEW_UNTIL)) return { ...result, status: 'review-expired' };
  if (!venue) return { ...result, status: 'registry-missing' };
  if (venue.name !== deployment || venue.deployer.toLowerCase() !== OPERATOR || (venue.oracleUpdater !== null && venue.oracleUpdater.toLowerCase() !== OPERATOR)) return { ...result, status: 'operator-mismatch' };
  return { ...result, status: 'documented' };
}
