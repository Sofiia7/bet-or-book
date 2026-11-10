// What the explorer reader uses from a Blockscout page, and nothing else. A
// committed fixture is trimmed to this: the raw pages carry a great deal the
// reader never looks at, and third-party labels from a source whose terms are
// not known. The reader reads a sender's `name` and the names in
// `metadata.tags`, so of the metadata only those names are kept. Shared by the
// capture script and by any local re-trim of files already on disk, so both
// produce the same shape.

export interface TrimmedItem {
  from: { hash: unknown; name: unknown; metadata: { tags: Array<{ name: string }> } | null };
  to: { hash: unknown };
  value: unknown;
  timestamp: unknown;
  status: unknown;
  block_number: unknown;
}

export interface TrimmedAnswer {
  items: TrimmedItem[];
  next_page_params: unknown;
}

function recordOf(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`);
  return value as Record<string, unknown>;
}

/** `{ tags: [{ name }, ...] }` for a metadata block that has tags with names, else null (the reader would find no label in it either). */
function trimMetadata(metadata: unknown): { tags: Array<{ name: string }> } | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const tags = (metadata as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) return null;
  const named = tags.flatMap((tag) => {
    const name = typeof tag === 'object' && tag !== null ? (tag as Record<string, unknown>).name : undefined;
    return typeof name === 'string' ? [{ name }] : [];
  });
  return named.length > 0 ? { tags: named } : null;
}

function trimItem(raw: unknown): TrimmedItem {
  const tx = recordOf(raw, 'transaction');
  const from = recordOf(tx.from, 'sender');
  const to = recordOf(tx.to, 'recipient');
  return {
    from: { hash: from.hash, name: from.name, metadata: trimMetadata(from.metadata) },
    to: { hash: to.hash },
    value: tx.value,
    timestamp: tx.timestamp,
    status: tx.status,
    block_number: tx.block_number,
  };
}

export function trimAnswer(answer: { items?: unknown; next_page_params?: unknown }): TrimmedAnswer {
  if (!Array.isArray(answer.items)) throw new Error('answer has no items list');
  return { items: answer.items.map(trimItem), next_page_params: answer.next_page_params };
}

/** `capturedAt` is an ISO timestamp; the note names the day. */
export function trimmedNote(capturedAt: string): string {
  return `trimmed to the fields the reader uses (sender metadata cut to its tag names) from a keyless capture of ${capturedAt.slice(0, 10)}`;
}

/** The fields of one Etherscan-style `txlist` row the reader looks at. */
const TXLIST_FIELDS = ['blockNumber', 'timeStamp', 'from', 'to', 'value', 'isError', 'txreceipt_status'] as const;

export interface TrimmedTxlist {
  status: unknown;
  message: unknown;
  result: unknown;
}

/** An Etherscan-style `txlist` answer cut to its envelope and, per row, the
 * fields the reader uses (`txreceipt_status` only where the row has one). An
 * answer with no `result` list or string is not a capture worth keeping. */
export function trimTxlist(answer: unknown): TrimmedTxlist {
  const body = recordOf(answer, 'txlist answer');
  const { status, message, result } = body;
  if (Array.isArray(result)) {
    const rows = result.map((raw) => {
      const row = recordOf(raw, 'txlist row');
      return Object.fromEntries(TXLIST_FIELDS.filter((field) => field in row).map((field) => [field, row[field]]));
    });
    return { status, message, result: rows };
  }
  if (typeof result === 'string') return { status, message, result };
  throw new Error('txlist answer has no result list');
}

export function trimmedTxlistNote(capturedAt: string): string {
  return `trimmed to the fields the reader uses (rows cut to blockNumber, timeStamp, from, to, value, isError, txreceipt_status) from a keyed capture of ${capturedAt.slice(0, 10)}`;
}

/** One party of a transaction (sender or recipient) cut to what the label
 * lookup reads: the hash, the name and the metadata tag names. */
function trimParty(raw: unknown, what: string): { hash: unknown; name: unknown; metadata: { tags: Array<{ name: string }> } | null } {
  const party = recordOf(raw, what);
  return { hash: party.hash, name: party.name, metadata: trimMetadata(party.metadata) };
}

/** What the label lookup uses from an address's transaction list: for the
 * first `limit` items, both parties cut to hash, name and tag names. Blockscout
 * puts an address's metadata tags on the parties of its transactions, not on
 * its address-info answer (which carries `metadata: null` for an address the
 * lists tag as a Binance hot wallet, seen live 2026-11-10). */
export function trimLabelPage(answer: unknown, limit = 3): { items: Array<{ from: ReturnType<typeof trimParty>; to: ReturnType<typeof trimParty> }> } {
  const page = recordOf(answer, 'transaction list');
  if (!Array.isArray(page.items)) throw new Error('answer has no items list');
  return {
    items: page.items.slice(0, limit).map((raw) => {
      const tx = recordOf(raw, 'transaction');
      return { from: trimParty(tx.from, 'sender'), to: trimParty(tx.to, 'recipient') };
    }),
  };
}

export function trimmedLabelNote(capturedAt: string): string {
  return `trimmed to the parties of the first three transactions, each cut to hash, name and tag names, from a keyed capture of ${capturedAt.slice(0, 10)}`;
}
