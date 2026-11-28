import { describe, it, expect } from 'vitest';
import { parseTarget, targetAction } from '../src/open/target';

describe('« Open in Ledge » targets from the island', () => {
  it('reads each kind the island sends and refuses anything else', () => {
    expect(parseTarget('{"kind":"session","id":"local:abc"}')).toEqual({ kind: 'session', id: 'local:abc' });
    expect(parseTarget('{"kind":"terminal","id":"dev:x"}')).toEqual({ kind: 'terminal', id: 'dev:x' });
    expect(parseTarget('{"kind":"document","path":"/w/plan.md"}')).toEqual({ kind: 'document', path: '/w/plan.md' });
    for (const kind of ['settings', 'launch', 'update', 'machines']) expect(parseTarget(JSON.stringify({ kind }))).toEqual({ kind });
    expect(parseTarget('{"kind":"point","qid":"p-1"}')).toBeNull();   // the point left with the chat (#40 PR 4)
    expect(parseTarget('{"kind":"ask","id":"qitem-9"}')).toEqual({ kind: 'ask', id: 'qitem-9' });
    expect(parseTarget('{"kind":"atoi"}')).toBeNull();   // « À toi » is gone (#40 PR 3)
    expect(parseTarget('{"kind":"routine","machine":"local","id":"r1a2b3c"}')).toEqual({ kind: 'routine', machine: 'local', id: 'r1a2b3c' });
    for (const raw of ['{"kind":"routine","machine":"local"}', '{"kind":"routine","machine":"a:b","id":"r1a2b3c"}', '{"kind":"routine","machine":"local","id":"briefing"}']) expect(parseTarget(raw)).toBeNull();
    for (const raw of ['', 'settings', '{"kind":"point"}', '{"kind":"ask","id":""}', '{"kind":"session"}', '{"kind":"session","id":""}', '{"kind":"nope"}', 'null', '[1]']) expect(parseTarget(raw)).toBeNull();
  });
  it('a session or its terminal opens its page; settings land on the island section; machines, updates and New session where they live', () => {
    expect(targetAction({ kind: 'session', id: 'local:a' })).toEqual({ type: 'open', id: 'local:a' });
    expect(targetAction({ kind: 'terminal', id: 'local:a' })).toEqual({ type: 'open', id: 'local:a' });
    expect(targetAction({ kind: 'settings' })).toEqual({ type: 'settings', section: 'island' });
    expect(targetAction({ kind: 'machines' })).toEqual({ type: 'settings', section: 'machines' });
    expect(targetAction({ kind: 'update' })).toEqual({ type: 'settings', section: 'about' });
    expect(targetAction({ kind: 'launch' })).toEqual({ type: 'modal', modal: { kind: 'launch' } });
    expect(targetAction({ kind: 'document', path: '/w/plan.md' })).toEqual({ type: 'home' });
    expect(targetAction({ kind: 'task', id: 't-1' })).toEqual({ type: 'tasks', task: 't-1' });
  });
});
