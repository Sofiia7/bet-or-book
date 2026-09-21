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

  it('carries enough of the address to be recognisable', () => {
    expect(snapshotId(ADDRESS, '2026-09-21T09:00:00.000Z')).toMatch(/^b83de012-/);
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
