// The retired operator's journal is set aside at start, never deleted (#40, D11, the owner's condition).
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setAsideOperatorJournal } from '../src/daemon/retired.js';

const AT = new Date('2026-11-27T18:30:05.123Z');

describe('setAsideOperatorJournal', () => {
  it('renames ledge.sqlite and its sidecars to .bak-<date>, keeps their bytes, and says so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-retired-'));
    writeFileSync(join(dir, 'ledge.sqlite'), 'db'); writeFileSync(join(dir, 'ledge.sqlite-shm'), 'shm');
    const said: string[] = [];
    expect(setAsideOperatorJournal(dir, AT, l => said.push(l))).toBe('ledge.sqlite.bak-20261127T183005Z');
    expect(readdirSync(dir).sort()).toEqual(['ledge.sqlite.bak-20261127T183005Z', 'ledge.sqlite.bak-20261127T183005Z-shm']);
    expect(readFileSync(join(dir, 'ledge.sqlite.bak-20261127T183005Z'), 'utf8')).toBe('db');
    expect(said).toEqual(['operator journal set aside: ledge.sqlite.bak-20261127T183005Z']);
  });

  it('a sidecar left by a rename that failed half way is set aside at the next start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-retired-'));
    writeFileSync(join(dir, 'ledge.sqlite-wal'), 'wal');
    expect(setAsideOperatorJournal(dir, AT)).toBe('ledge.sqlite.bak-20261127T183005Z');
    expect(readdirSync(dir)).toEqual(['ledge.sqlite.bak-20261127T183005Z-wal']);
  });

  it('nothing to set aside does nothing; a name already taken gets a number, never overwritten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-retired-'));
    expect(setAsideOperatorJournal(dir, AT)).toBeNull();
    writeFileSync(join(dir, 'ledge.sqlite.bak-20261127T183005Z'), 'older');
    writeFileSync(join(dir, 'ledge.sqlite'), 'db');
    expect(setAsideOperatorJournal(dir, AT)).toBe('ledge.sqlite.bak-20261127T183005Z-2');
    expect(readFileSync(join(dir, 'ledge.sqlite.bak-20261127T183005Z'), 'utf8')).toBe('older');
    expect(existsSync(join(dir, 'ledge.sqlite'))).toBe(false);
  });
});
