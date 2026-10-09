import { createNansenClient, meansOutOfCredits, type NansenClient, type NansenCallMeta } from './nansen';
import type { SpendGuard } from '../coordinator';
/** Hold each paid stage before its first request, including retries/pages.
 * A crash leaves a conservative orphan hold in the existing atomic ledger.
 * Recording the overall call report remains the caller's responsibility. */
export function stagedNansen(key: string, budget: SpendGuard, day: string, record: (call: NansenCallMeta) => void, signal: AbortSignal): NansenClient {
  async function stage<T>(worst: number, run: (client: NansenClient) => Promise<T>): Promise<T> {
    const reservation = await budget.reserve(day, worst);
    if (!reservation.ok) throw new Error('Nansen credit budget unavailable for this stage');
    const calls: NansenCallMeta[] = [];
    const client = createNansenClient(key, call => { calls.push(call); record(call); }, signal);
    try { return await run(client); }
    finally {
      const last = [...calls].reverse().find(c => c.creditsRemaining !== null);
      await budget.settle(reservation.id!, calls.reduce((sum, c) => sum + (c.creditsCost ?? 1), 0), last?.creditsRemaining ?? null,
        calls.some(c => meansOutOfCredits(c.status, c.creditsRemaining)), last?.at);
    }
  }
  return {
    perpPositions: address => stage(2, c => c.perpPositions(address)),
    perpPnlSummary: (address, from, to) => stage(2, c => c.perpPnlSummary(address, from, to)),
    currentBalance: (address, pages = 1) => stage(2 * Math.min(3, Math.max(1, pages)), c => c.currentBalance(address, pages)),
    relatedWallets: (address, chain) => stage(2, c => c.relatedWallets(address, chain)),
  };
}
