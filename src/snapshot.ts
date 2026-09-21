/**
 * A saved reading, addressable by a link.
 *
 * "Copy link" used to hand out `/?address=0x...`, which is a link to an
 * account, not to the thing that was on screen: whoever opened it ran a new
 * check, against a position that may have moved, under rules that may have
 * changed, possibly falling back to a cheaper answer because the budget had
 * run down. Two people discussing "the card" were not discussing one card.
 *
 * So a check keeps what it produced under an id, and the link carries the
 * id. Opening it shows exactly what the first reader saw, with its own
 * timestamp, and checking again is a separate act that makes a new snapshot.
 */

/** Long enough to outlive a conversation about a post, short enough that
 * saved readings do not accumulate forever. */
export const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * A 64-bit FNV-1a over the whole input.
 *
 * The first id was the first eight hex characters of the address plus the
 * millisecond, and two different addresses sharing a prefix at the same
 * millisecond produced one id - confirmed in the 21.09 audit. A low chance
 * of collision is not the same as an identifier, and this is meant to be a
 * handle on an unchangeable piece of evidence.
 *
 * Synchronous on purpose: every caller builds an id while assembling a
 * response, and SubtleCrypto would make all of them async for a property
 * nothing here needs. This is a hash against accidents, not against an
 * adversary, and the reading it points at is not a secret.
 */
function fnv1a64(input: string): bigint {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash ^ BigInt(input.charCodeAt(i))) * PRIME) & MASK;
  }
  return hash;
}

/**
 * Derived, not random: the same reading always has the same id, so a check
 * repeated inside its cache window does not mint a second one. Everything
 * that makes the reading what it is goes into the hash, so a reading under
 * different rules is a different id rather than the same link quietly
 * answering something else.
 */
export function snapshotId(address: string, checkedAt: string, classifierVersion = ''): string {
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) throw new Error('snapshot id needs a real timestamp');
  const digest = fnv1a64(`${address.toLowerCase()}|${at}|${classifierVersion}`);
  return digest.toString(36).padStart(13, '0');
}

/** The current form, and the one already handed out before the audit: links
 * live in other people's posts, so the old shape keeps working. */
const ID_RE = /^(?:[0-9a-z]{10,16}|[0-9a-f]{8}-[0-9a-z]{1,16})$/;

/** Ids arrive from the URL, so they are checked before they are used to
 * build a storage key. */
export function isSnapshotId(value: string): boolean {
  return ID_RE.test(value);
}

export const snapshotKey = (id: string) => `snapshot:${id}`;

/** A short, stable digest of any text. Used to version the page's script URL
 * so a deploy changes it. */
export const shortHash = (text: string): string => fnv1a64(text).toString(36).slice(0, 10);
