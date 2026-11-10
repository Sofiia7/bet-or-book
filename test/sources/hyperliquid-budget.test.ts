import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenOrders, getPortfolio, getSpotBalances } from '../../src/sources/hyperliquid';
import { attachRequestBudget, createRequestBudget, RequestBudgetExceeded } from '../../src/requestBudget';

function stubFetch(...responses: Response[]) {
  const queue = [...responses];
  const fn = vi.fn(async (_url: string | URL, _init?: RequestInit) => queue.shift() ?? new Response('[]', { status: 200 }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function budgetedSignal(limit: number) {
  const signal = new AbortController().signal;
  const budget = createRequestBudget(limit);
  attachRequestBudget(signal, budget);
  return { signal, budget };
}

describe('hyperliquid reads and the request budget', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends nothing past the limit', async () => {
    const fn = stubFetch(new Response('{"balances":[]}'), new Response('[]'), new Response('[]'));
    const { signal } = budgetedSignal(2);
    await getSpotBalances('0xabc', signal);
    await getOpenOrders('0xabc', undefined, signal);
    await expect(getOpenOrders('0xabc', undefined, signal)).rejects.toBeInstanceOf(RequestBudgetExceeded);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('charges the retry too', async () => {
    const fn = stubFetch(new Response('', { status: 429, headers: { 'retry-after': '0' } }), new Response('[]'));
    const { signal, budget } = budgetedSignal(2);
    await getOpenOrders('0xabc', undefined, signal);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(budget.used()).toBe(2);
  });

  it('keeps the ordinary failure when the retry is not affordable', async () => {
    const fn = stubFetch(new Response('', { status: 429, headers: { 'retry-after': '0' } }), new Response('[]'));
    const { signal, budget } = budgetedSignal(1);
    await expect(getOpenOrders('0xabc', undefined, signal)).rejects.toThrow('hyperliquid frontendOpenOrders failed: 429');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(budget.used()).toBe(1);
  });

  it('charges the portfolio read as one request, and refuses it past the limit', async () => {
    const fn = stubFetch(new Response('[]'));
    const { signal, budget } = budgetedSignal(1);
    await getPortfolio('0xabc', signal);
    expect(budget.used()).toBe(1);
    await expect(getPortfolio('0xabc', signal)).rejects.toBeInstanceOf(RequestBudgetExceeded);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
