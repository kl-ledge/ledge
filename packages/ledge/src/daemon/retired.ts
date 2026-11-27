import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/** The retired operator's journal (#40, D11): SQLite, with its write-ahead log and shared memory beside it when they were left. */
const JOURNAL = 'ledge.sqlite';
const SIDECARS = ['', '-wal', '-shm'] as const;

/**
 * Sets the retired operator's journal aside (#40, D11, the owner's condition): `ledge.sqlite` in `dir` is renamed
 * `ledge.sqlite.bak-<date>` (its `-wal` and `-shm` with it), never deleted. Nothing to set aside, nothing done; a name already taken
 * gets a number. Returns the new name of the journal, or null. A rename that fails is left for the next start, and said.
 */
export function setAsideOperatorJournal(dir: string, now: Date, log: (line: string) => void = () => {}): string | null {
  const from = join(dir, JOURNAL);
  // A sidecar left by a rename that failed half way counts too: the next start sets it aside.
  if (!SIDECARS.some(x => existsSync(`${from}${x}`))) return null;
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  let base = `${JOURNAL}.bak-${stamp}`;
  for (let n = 2; SIDECARS.some(x => existsSync(join(dir, `${base}${x}`))); n++) base = `${JOURNAL}.bak-${stamp}-${n}`;
  try {
    // The sidecars first, the journal last: a failure leaves the journal in place, set aside again at the next start.
    for (const x of [...SIDECARS].reverse()) if (existsSync(`${from}${x}`)) renameSync(`${from}${x}`, join(dir, `${base}${x}`));
  } catch (e) {
    log(`operator journal not set aside: ${(e as Error).message}`);
    return null;
  }
  log(`operator journal set aside: ${base}`);
  return base;
}
