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

/** Derived, not random: the same reading always has the same id, so a check
 * repeated inside its cache window does not mint a second one. */
export function snapshotId(address: string, checkedAt: string): string {
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) throw new Error('snapshot id needs a real timestamp');
  return `${address.toLowerCase().replace(/^0x/, '').slice(0, 8)}-${at.toString(36)}`;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-z]{1,16}$/;

/** Ids arrive from the URL, so they are checked before they are used to
 * build a storage key. */
export function isSnapshotId(value: string): boolean {
  return ID_RE.test(value);
}

export const snapshotKey = (id: string) => `snapshot:${id}`;
