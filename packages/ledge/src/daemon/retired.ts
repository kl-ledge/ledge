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

/** What the removed chat kept under `~/.ledge` (#40): the PC's conversation of the day, its context and OMP folders, and each paired
 *  device's conversations. */
export const CHAT_DATA = ['chat.json', 'chat', join('mobile', 'chat')] as const;

/**
 * Sets the removed chat's data aside (#40, the owner's condition, as the operator's journal): each of `CHAT_DATA` that exists in `dir` is
 * renamed `<name>.bak-<date>` beside it, a file or a whole folder, never deleted; a name already taken gets a number. Returns the new
 * names. One that fails is left for the next start, and said; the others go on.
 */
export function setAsideChatData(dir: string, now: Date, log: (line: string) => void = () => {}): string[] {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const out: string[] = [];
  for (const rel of CHAT_DATA) {
    const from = join(dir, rel);
    if (!existsSync(from)) continue;
    let to = `${rel}.bak-${stamp}`;
    for (let n = 2; existsSync(join(dir, to)); n++) to = `${rel}.bak-${stamp}-${n}`;
    try { renameSync(from, join(dir, to)); out.push(to); log(`chat data set aside: ${to}`); }
    catch (e) { log(`chat data not set aside (${rel}): ${(e as Error).message}`); }
  }
  return out;
}
