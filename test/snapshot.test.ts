import { describe, expect, it } from 'vitest';
import { snapshotId, isSnapshotId, snapshotKey } from '../src/snapshot';

const ADDRESS = '0xb83de012dba672c76a7dbbbf3e459cb59d7d6e36';

describe('snapshotId', () => {
  it('is the same id for the same reading', () => {
    const at = '2026-09-21T09:00:00.000Z';
    expect(snapshotId(ADDRESS, at)).toBe(snapshotId(ADDRESS, at));
    expect(snapshotId(ADDRESS.toUpperCase(), at)).toBe(snapshotId(ADDRESS, at));
  });

  it('is a different id for a different reading of the same account', () => {
    expect(snapshotId(ADDRESS, '2026-09-21T09:00:00.000Z')).not.toBe(
      snapshotId(ADDRESS, '2026-09-21T09:00:01.000Z'),
    );
  });

  it('is a different id for the same moment on another account', () => {
    const at = '2026-09-21T09:00:00.000Z';
    expect(snapshotId('0x' + 'ab'.repeat(20), at)).not.toBe(snapshotId(ADDRESS, at));
  });

  it('hashes the whole address, so a shared prefix is not a shared id', () => {
    // The id used to be the first eight hex characters of the address plus
    // the millisecond, and two addresses with the same prefix checked in the
    // same millisecond got one id (audit R02).
    const at = '2026-09-21T09:00:00.000Z';
    const twin = '0xb83de012' + 'f'.repeat(32);
    expect(snapshotId(ADDRESS, at)).not.toBe(snapshotId(twin, at));
    expect(snapshotId(ADDRESS, at)).toBe(snapshotId(ADDRESS, at));
  });

  it('gives a reading under different rules a different id', () => {
    const at = '2026-09-21T09:00:00.000Z';
    expect(snapshotId(ADDRESS, at, 'v2')).not.toBe(snapshotId(ADDRESS, at, 'v3'));
  });

  it('refuses to make an id without a real time', () => {
    expect(() => snapshotId(ADDRESS, 'sometime')).toThrow();
  });
});

describe('isSnapshotId', () => {
  it('accepts what snapshotId makes', () => {
    expect(isSnapshotId(snapshotId(ADDRESS, '2026-09-21T09:00:00.000Z'))).toBe(true);
  });

  it('refuses anything else, because the id becomes a storage key', () => {
    for (const bad of ['', '../other', 'snapshot:x', 'b83de012-', 'B83DE012-abc', 'b83de012-' + 'z'.repeat(17)]) {
      expect(isSnapshotId(bad)).toBe(false);
    }
  });
});

describe('snapshotKey', () => {
  it('namespaces the id', () => {
    expect(snapshotKey('b83de012-abc')).toBe('snapshot:b83de012-abc');
  });
});
