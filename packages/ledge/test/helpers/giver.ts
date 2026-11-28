import type { ChatTaskProposal, Session } from '@ledge/protocol';
import { sessionKey } from '../../src/auth.js';
import type { Client } from '../../src/client.js';
import type { Store } from '../../src/daemon/store.js';

/** The giver's id and name. */
export const GIVER = { id: 'giver', name: 'Gil' };

/**
 * A live session that gives tasks, in its own name (`task.cmd { by, key, op: give }`). Since the chat left Ledge (#40), Ledge itself
 * gives no task: a test that needs a task given to a session has another session give it. `give` sends it; its `task.result` follows.
 */
export function taskGiver(store: Pick<Store, 'upsert'>, at = '2026-10-26T19:00:00.000Z'): { give(c: Client, rid: string, row: Pick<ChatTaskProposal, 'to' | 'title' | 'text'>): void } {
  const s: Session = { id: GIVER.id, name: GIVER.name, tool: 'claude', cwd: '/w/giver', project: 'giver', title: GIVER.name, tmuxSession: `ledge-${GIVER.id}`,
    state: 'working', helpers: [], startedAt: at, lastActivityAt: at, source: 'launcher' };
  store.upsert(s);
  return { give(c, rid, row) { c.send({ type: 'task.cmd', rid, by: GIVER.id, key: sessionKey(GIVER.id), op: 'give', to: row.to, title: row.title, ...(row.text ? { text: row.text } : {}) }); } };
}
