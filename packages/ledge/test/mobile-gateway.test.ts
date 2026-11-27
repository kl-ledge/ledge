import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { b64u, generateIdentity, recoveryUserId } from '@ledge/seal';
import { ATTACHMENT_MAX, PREVIEW_MAX, padPlain, PAD_TIERS, PLAIN_MAX, SNAPSHOT_BODY_MAX, TOPIC_MAX, PhoneServerMessageSchema, pendingKey, type ClientMessage, type Pending, type ServerMessage, type Session, type Task } from '@ledge/protocol';
import { hostname } from 'node:os';
import { broadcastFromUser } from '../src/daemon/broadcast.js';
import { createMailbox } from '../src/daemon/mailbox.js';
import { Store } from '../src/daemon/store.js';
import { createPhoneGateway } from '../src/mobile/gateway.js';
import { challengeOf } from '../src/mobile/webauthn.js';
import { softAuthenticator } from './mobile-soft-authenticator.js';
import { T0, T1, PUSH, LS, PICK, seen, SEEN_LS, mk, flush, setup, decide, stopAll } from './helpers/gateway.js';


afterEach(stopAll);

describe('phone gateway: input', () => {
  it('refuses invalid JSON and every message off the whitelist with error invalid, dispatches nothing, logs no text', async () => {
    const g = setup();
    const SECRET = 'top-secret-words';
    g.send('dev1', `{not json ${SECRET}`);
    g.send('dev1', { type: 'session.message', from: 'a', to: 'b', text: SECRET });
    g.send('dev1', { type: 'chat.ask', qid: 'q', text: SECRET });
    g.send('dev1', { type: 'mobile.device.revoke', id: SECRET });
    g.send('dev1', { type: 'update.daemon', version: SECRET });
    g.send('dev1', { type: 'session.launch', tool: 'claude', cwd: '/', prompt: SECRET });
    await flush();
    const errors = g.got('dev1');
    expect(errors).toHaveLength(6);
    for (const e of errors) expect(e).toMatchObject({ type: 'error', code: 'invalid' });
    expect(errors[0]).not.toHaveProperty('request');
    expect(errors.slice(1).map(e => e.type === 'error' && e.request)).toEqual(['session.message', 'chat.ask', 'mobile.device.revoke', 'update.daemon', 'session.launch']);
    expect(g.dispatched).toEqual([]);
    expect(g.logs.some(l => l.includes(SECRET))).toBe(false);
    expect(g.logs).toContain('phone message refused: ?');
    expect(g.logs).toContain('phone message refused: chat.ask');
  });

  it('names no request longer than 40 characters, nor one off the plain shape of a type', async () => {
    const g = setup();
    g.send('dev1', { type: 'x'.repeat(41) });
    g.send('dev1', { type: 'chat.ask\nphone message refused: forged' });
    g.send('dev1', { type: 'Chat.ask' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'error', code: 'invalid' }, { type: 'error', code: 'invalid' }, { type: 'error', code: 'invalid' }]);
    expect(g.logs.filter(l => l.startsWith('phone message refused'))).toEqual(['phone message refused: ?', 'phone message refused: ?', 'phone message refused: ?']);
    expect(g.logs.some(l => l.includes('forged'))).toBe(false);
  });
});

describe('phone gateway: reads and forward', () => {
  it('a device that did not ask for a snapshot gets no session.updated', async () => {
    const g = setup();
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.fm.sent).toEqual([]);
  });

  it('each gateway announces its own boot in the snapshot', async () => {
    const boots = [randomUUID(), randomUUID()];
    const seen: unknown[] = [];
    for (const boot of boots) {
      const g = setup({ boot });
      g.send('dev1', { type: 'snapshot.request' });
      await flush();
      const [snap] = g.got('dev1');
      seen.push(snap?.type === 'snapshot' ? snap.daemon.boot : undefined);
    }
    expect(seen).toEqual(boots);
  });

  it('snapshot.request subscribes: the snapshot, then each session.updated projected, without cwd or tmuxSession', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(PhoneServerMessageSchema.parse(snap)).toMatchObject({ type: 'snapshot', protocol: 1, daemon: { version: '1.2.3', name: hostname().slice(0, 40) } });
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    expect(snap.sessions.map(s => s.id)).toEqual(['a', 'b', 'c', 'q']);
    expect(snap.sessions[0]).toMatchObject({ unread: true, pending: { risk: 'high', riskReason: 'pushes' } });
    g.gw.forward({ type: 'session.updated', session: mk('a', { title: 'renamed' }) });
    await flush();
    const upd = g.got('dev1')[1]!;
    expect(PhoneServerMessageSchema.parse(upd)).toMatchObject({ type: 'session.updated', session: { id: 'a', title: 'renamed' } });
    if (upd.type !== 'session.updated') throw new Error('no update');
    expect(upd.session).not.toHaveProperty('cwd');
    expect(upd.session).not.toHaveProperty('tmuxSession');
    expect(g.got('dev2')).toEqual([]);
    g.gw.forward({ type: 'session.removed', id: 'c' });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'session.removed', id: 'c' });
  });

  it('forward ignores what it does not know: chat.delta, mobile, machines, recents', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'b' });
    await flush();
    const before = g.fm.sent.length;
    g.gw.forward({ type: 'chat.delta', qid: 'q', text: 'x' } as ServerMessage);
    g.gw.forward({ type: 'mobile', state: g.fm.mobile.state() });
    g.gw.forward({ type: 'machines', machines: [] });
    g.gw.forward({ type: 'recents', recents: [] });
    await flush();
    expect(g.fm.sent.length).toBe(before);
  });

  it('session.preview and session.thread.item reach only the device that watches that session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev2', { type: 'session.watch', id: 'b' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'session.preview', id: 'a', lines: ['$ ls', 'src'] }]);
    expect(g.got('dev2')).toEqual([]);
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['new'] });
    g.gw.forward({ type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'x'.repeat(9_000) } });
    await flush();
    expect(g.got('dev1').slice(1)).toEqual([
      { type: 'session.preview', id: 'a', lines: ['new'] },
      { type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'x'.repeat(8_192) }, cut: true }
    ]);
    expect(g.got('dev2')).toEqual([]);
    g.send('dev1', { type: 'session.watch', id: null });
    await flush();
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['later'] });
    await flush();
    expect(g.got('dev1')).toHaveLength(3);
  });

  it('session.thread answers the projected thread, or unknown_session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.thread', id: 'a' });
    g.send('dev1', { type: 'session.thread', id: 'zz' });
    await flush();
    expect(g.got('dev1')).toEqual([
      { type: 'session.thread', id: 'a', items: [{ kind: 'message', id: 'm1', at: T0, turn: 0, text: 'hello' }], cut: [], more: false },
      // An error goes ahead of the updates still queued.
      { type: 'error', code: 'unknown_session', request: 'session.thread' },
      { type: 'session.checklist', id: 'a', checklist: null }
    ]);
  });

  it('session.read: unread turns false for that device only', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T09:00:00Z' });
    await flush();
    const own = g.got('dev1').at(-1);
    expect(own).toMatchObject({ type: 'session.updated', session: { id: 'a', unread: false } });
    expect(g.got('dev2')).toHaveLength(1);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: false } });
    expect(g.got('dev2').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: true } });
    // An older mark never takes the newer one back.
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T07:00:00.000Z' });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'session.updated', session: { unread: false } });
  });

  it('session.read from a device that follows no session moves its mark and sends nothing', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.read', id: 'a', at: '2026-10-20T09:00:00Z' });
    await flush();
    expect(g.fm.sent).toEqual([]);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1')[0];
    expect(snap?.type === 'snapshot' && snap.sessions.find(s => s.id === 'a')?.unread).toBe(false);
  });

  it('an archived session never reaches the phone: off the snapshot, forwarded as removed, unknown to reads and writes', async () => {
    const g = setup();
    g.sessions.set('z', mk('z', { archivedAt: T1, lastReply: { text: 'old', at: T1 } }));
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    const snap = g.got('dev1')[0];
    expect(snap?.type === 'snapshot' && snap.sessions.map(s => s.id)).toEqual(['a', 'b', 'c', 'q']);
    g.send('dev1', { type: 'session.read', id: 'a', at: T1 });
    await flush();
    // Session a is archived now: the phone hears it is gone, and forgets its watch and read mark.
    const archived = { ...g.sessions.get('a')!, archivedAt: T1 };
    g.sessions.set('a', archived);
    g.gw.forward({ type: 'session.updated', session: archived });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['ghost'] });
    await flush();
    expect(g.got('dev1').at(-1)).toEqual({ type: 'session.removed', id: 'a' });
    const before = g.got('dev1').length;
    for (const id of ['a', 'z']) {
      g.send('dev1', { type: 'session.thread', id });
      g.send('dev1', { type: 'session.watch', id });
      g.send('dev1', { type: 'session.read', id, at: T1 });
    }
    const write = { type: 'session.reply', op: randomUUID(), id: 'z', text: 'hi', expect: null };
    g.send('dev1', write);
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after.filter(m => m.type === 'error').map(m => m.type === 'error' && [m.code, m.request])).toEqual([
      ['unknown_session', 'session.thread'], ['unknown_session', 'session.watch'], ['unknown_session', 'session.read'],
      ['unknown_session', 'session.thread'], ['unknown_session', 'session.watch'], ['unknown_session', 'session.read']
    ]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: write.op, status: 'rejected', reason: 'unknown_session' });
    expect(after.some(m => m.type === 'session.preview')).toBe(false);
    expect(g.dispatched).toEqual([]);
  });

  it('watching an unknown session is refused and keeps the session watched before', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev1', { type: 'session.watch', id: 'zz' });
    await flush();
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['still'] });
    await flush();
    expect(g.got('dev1').slice(1)).toEqual([
      { type: 'error', code: 'unknown_session', request: 'session.watch' },
      { type: 'session.preview', id: 'a', lines: ['still'] }
    ]);
  });

  it('a removed session is no longer watched', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    g.gw.forward({ type: 'session.removed', id: 'a' });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['ghost'] });
    await flush();
    expect(g.got('dev1')).toHaveLength(1);
  });

  it('a queue that overflows is cut and the device gets a fresh snapshot', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    // The first send hangs, so everything after it stays queued.
    let release!: (ok: boolean) => void;
    const realSend = g.fm.mobile.send;
    g.fm.mobile.send = (d, t) => { g.fm.mobile.send = realSend; g.fm.sent.push([d, t]); return new Promise<boolean>(res => { release = res; }); };
    for (let i = 0; i < 302; i++) g.gw.forward({ type: 'session.removed', id: `gone-${i}` });
    await flush();
    release(true);
    await flush();
    const after = g.got('dev1').slice(2);
    expect(after.map(m => m.type)).toEqual(['snapshot']);
    expect(g.logs).toContain('phone outbox: queue overflow for device dev1');
  });

  it('after stop, nothing is received nor forwarded', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const n = g.fm.sent.length;
    g.gw.stop();
    g.send('dev1', { type: 'snapshot.request' });
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    expect(g.fm.sent.length).toBe(n);
  });

  it('a revoked device (onChange) gets nothing more', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    await flush();
    const before = g.got('dev1').length;
    g.fm.setDevices(['dev2']);
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    g.gw.forward({ type: 'session.preview', id: 'a', lines: ['x'] });
    g.gw.forward({ type: 'session.removed', id: 'b' });
    await flush();
    expect(g.got('dev1')).toHaveLength(before);
  });

  it('a device whose send fails (onGone) is unsubscribed', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.fm.mobile.send = async (d, t) => { g.fm.sent.push([d, t]); return false; };
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('a')! });
    await flush();
    const n = g.fm.sent.length;
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('b')! });
    await flush();
    expect(g.fm.sent.length).toBe(n);
  });
});

describe('phone gateway: writes', () => {
  it('decide with a wrong expect.key: received, then rejected/stale, nothing dispatched', async () => {
    const g = setup();
    const m = decide('a', 'deny', PUSH, { key: 'not-the-key' });
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1')).toEqual([
      { type: 'operation.result', op: m.op, status: 'received' },
      { type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }
    ]);
    expect(g.dispatched).toEqual([]);
  });

  it('accept on git push needs a confirmation; deny on it is dispatched and applied', async () => {
    const g = setup();
    const accept = decide('a', 'accept', PUSH);
    const always = decide('a', 'always', PUSH);
    g.send('dev1', accept);
    g.send('dev1', always);
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received').map(r => r.type === 'operation.result' && [r.status, r.reason]))
      .toEqual([['rejected', 'confirm_required'], ['rejected', 'confirm_required']]);
    expect(g.dispatched).toEqual([]);
    const deny = decide('a', 'deny', PUSH);
    g.send('dev1', deny);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'deny', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) }, by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
    expect(g.results('dev1').slice(-2)).toEqual([
      { type: 'operation.result', op: deny.op, status: 'received' },
      { type: 'operation.result', op: deny.op, status: 'applied' }
    ]);
  });

  it('accept on a low request is dispatched as the local decide', async () => {
    const g = setup();
    const m = decide('b', 'accept', LS);
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'b', decision: 'accept', expect: { kind: 'permission', text: 'ls src', key: pendingKey(LS) }, by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
  });

  it('a decide names its device by the name the user gave, and a `by` the device sent is not kept', async () => {
    const g = setup();
    g.fm.names.set('dev1', 'iPad de G.');
    const m = { ...decide('b', 'accept', LS), by: { kind: 'pc' } };
    g.send('dev1', m);
    await flush();
    expect(g.dispatched.at(-1)).toMatchObject({ type: 'session.decide', by: { kind: 'device', id: 'dev1', name: 'iPad de G.' } });
  });

  it('device.rename names the sender only, and its next snapshot carries its id, kind and name', async () => {
    const g = setup({ devices: ['dev1', 'dev2'] });
    const op = randomUUID();
    g.send('dev1', { type: 'device.rename', op, name: ' iPad salon ' });
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'applied' });
    expect(g.fm.names.get('dev1')).toBe('iPad salon');
    expect(g.fm.names.has('dev2')).toBe(false);
    const snap = g.got('dev1').filter((m) => m.type === 'snapshot').at(-1) as { device?: { id?: string; kind?: string; name?: string } };
    expect(snap.device).toMatchObject({ id: 'dev1', kind: 'phone', name: 'iPad salon' });
  });

  it('maps the reply of dispatch: not_taken failed, a known code rejected, an unknown one invalid, no code failed, a throw failed', async () => {
    const answers: Array<ServerMessage | Error> = [
      { type: 'error', id: 'b', message: 'the terminal did not take it', request: 'session.decide', code: 'not_taken' },
      { type: 'error', id: 'b', message: 'busy', request: 'session.decide', code: 'busy' },
      { type: 'error', id: 'b', message: 'odd', request: 'session.decide', code: 'from_the_future' } as ServerMessage,
      { type: 'error', id: 'b', message: 'tmux exited 1', request: 'session.decide' },
      new TypeError('tmux broke with SECRET-TEXT')
    ];
    const g = setup({
      dispatch: async (_msg, reply) => {
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        reply(a);
      }
    });
    for (let i = 0; i < 5; i++) { g.send('dev1', decide('b', 'accept', LS)); await flush(); }
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received').map(r => r.type === 'operation.result' && [r.status, r.reason ?? null]);
    expect(finals).toEqual([['failed', 'not_taken'], ['rejected', 'busy'], ['rejected', 'invalid'], ['failed', null], ['failed', null]]);
    expect(g.logs.some(l => l.includes('SECRET-TEXT'))).toBe(false);
    expect(g.logs.some(l => l.includes('session.decide') && l.includes('TypeError'))).toBe(true);
  });

  it('the same op twice is dispatched once, the second answer is the stored one', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hello', expect: SEEN_LS };
    g.send('dev1', m);
    await flush();
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'b', text: 'hello', by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received', 'applied', 'applied']);
  });

  it('the same op with another text is a conflict', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'session.reply', op, id: 'b', text: 'hello', expect: SEEN_LS });
    await flush();
    g.send('dev1', { type: 'session.reply', op, id: 'b', text: 'goodbye', expect: SEEN_LS });
    await flush();
    expect(g.dispatched).toHaveLength(1);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op, status: 'rejected', reason: 'conflict' });
  });

  it('a reply carrying an escape sequence is untypable, and never dispatched', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'clear \x1b[2J', expect: SEEN_LS };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'untypable' });
    expect(g.dispatched).toEqual([]);
  });

  it('a note carrying an escape sequence is untypable, even on a deny; a plain note is dispatched', async () => {
    const g = setup();
    const bad = { ...decide('a', 'deny', PUSH), note: 'x\x1b[2J' };
    g.send('dev1', bad);
    await flush();
    expect(g.results('dev1')).toEqual([
      { type: 'operation.result', op: bad.op, status: 'received' },
      { type: 'operation.result', op: bad.op, status: 'rejected', reason: 'untypable' }
    ]);
    expect(g.dispatched).toEqual([]);
    g.send('dev1', { ...decide('a', 'deny', PUSH), note: 'not this one' });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'deny', note: 'not this one', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) }, by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
  });

  it('a reply names the request it answers: an older one, or a request it never saw, is stale', async () => {
    const g = setup();
    const older = { type: 'session.reply', op: randomUUID(), id: 'q', text: '1', expect: seen({ kind: 'question', text: 'Before?' }) };
    const blind = { type: 'session.reply', op: randomUUID(), id: 'q', text: '1', expect: null };
    g.send('dev1', older);
    g.send('dev1', blind);
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received')).toEqual([
      { type: 'operation.result', op: older.op, status: 'rejected', reason: 'stale' },
      { type: 'operation.result', op: blind.op, status: 'rejected', reason: 'stale' }
    ]);
    // A request seen on a session that has none any more is stale too.
    const gone = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'go on', expect: SEEN_LS };
    g.send('dev1', gone);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: gone.op, status: 'rejected', reason: 'stale' });
    expect(g.dispatched).toEqual([]);
  });

  it('a reply with no request seen goes through while the session has none', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'go on', expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'c', text: 'go on', by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
  });

  it('a digit past the options of the question is invalid; one within them is dispatched', async () => {
    const g = setup();
    const five = { type: 'session.reply', op: randomUUID(), id: 'q', text: '5', expect: seen(PICK) };
    const two = { type: 'session.reply', op: randomUUID(), id: 'q', text: '2', expect: seen(PICK) };
    g.send('dev1', five);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: five.op, status: 'rejected', reason: 'invalid' });
    expect(g.dispatched).toEqual([]);
    g.send('dev1', two);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'q', text: '2', by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
  });

  it('two operations running at once each get their own outcome', async () => {
    const gates = new Map<string, (m?: ServerMessage) => void>();
    const g = setup({
      dispatch: (msg, reply) => new Promise<void>(res => {
        gates.set(msg.type === 'session.reply' ? msg.text : '', m => { if (m) reply(m); res(); });
      })
    });
    const one = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'one', expect: SEEN_LS };
    const two = { type: 'session.reply', op: randomUUID(), id: 'b', text: 'two', expect: SEEN_LS };
    g.send('dev1', one); g.send('dev1', two);
    await flush();
    expect(gates.size).toBe(2);
    gates.get('two')!();
    await flush();
    gates.get('one')!({ type: 'error', id: 'b', message: 'busy', request: 'session.reply', code: 'busy' });
    await flush();
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');
    expect(finals).toEqual([
      { type: 'operation.result', op: two.op, status: 'applied' },
      { type: 'operation.result', op: one.op, status: 'rejected', reason: 'busy' }
    ]);
  });

  it('a device revoked while its operation runs gets no result', async () => {
    let release!: () => void;
    const g = setup({ dispatch: () => new Promise<void>(res => { release = res; }) });
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hi', expect: SEEN_LS });
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received']);
    g.fm.setDevices(['dev2']);
    release();
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received']);
  });

  it('an unknown session is rejected; an interrupt on a session without tmux is read_only', async () => {
    const g = setup();
    const unknown = { type: 'session.interrupt', op: randomUUID(), id: 'zz' };
    const noTmux = { type: 'session.interrupt', op: randomUUID(), id: 'c' };
    const ok = { type: 'session.interrupt', op: randomUUID(), id: 'b' };
    g.send('dev1', unknown); g.send('dev1', noTmux); g.send('dev1', ok);
    await flush();
    const finals = g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');
    expect(finals).toEqual([
      { type: 'operation.result', op: unknown.op, status: 'rejected', reason: 'unknown_session' },
      { type: 'operation.result', op: noTmux.op, status: 'rejected', reason: 'read_only' },
      { type: 'operation.result', op: ok.op, status: 'applied' }
    ]);
    expect(g.dispatched).toEqual([{ type: 'session.interrupt', id: 'b' }]);
  });

  it('an interrupt on an OMP session goes through: OMP stops over its RPC, not a terminal', async () => {
    const g = setup();
    g.sessions.set('o', mk('o', { tool: 'omp', tmuxSession: null, backend: 'omp-rpc' }));
    const op = randomUUID();
    g.send('dev1', { type: 'session.interrupt', op, id: 'o' });
    await flush();
    expect(g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received')).toEqual([{ type: 'operation.result', op, status: 'applied' }]);
    expect(g.dispatched).toEqual([{ type: 'session.interrupt', id: 'o' }]);
  });

  it('a result goes to the requesting device only', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'b', text: 'hi', expect: SEEN_LS });
    await flush();
    expect(g.results('dev1')).toHaveLength(2);
    expect(g.results('dev2')).toHaveLength(0);
  });
});

describe('phone gateway: sizes', () => {
  it('every text sent is padded to one of PAD_TIERS', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    g.send('dev1', { type: 'session.watch', id: 'a' });
    g.send('dev1', { type: 'session.thread', id: 'a' });
    g.send('dev1', 'nope');
    g.send('dev1', decide('a', 'accept', PUSH));
    g.gw.forward({ type: 'session.thread.item', id: 'a', item: { kind: 'message', id: 'm2', at: T1, turn: 1, text: 'y'.repeat(5_000) } });
    await flush();
    expect(g.fm.sent.length).toBeGreaterThan(5);
    for (const [, text] of g.fm.sent) expect(PAD_TIERS).toContain(Buffer.byteLength(text, 'utf8'));
  });

  it('a snapshot of 200 sessions with long replies and topics still fits: previews are clipped', async () => {
    const g = setup();
    g.sessions.clear();
    for (let i = 0; i < 200; i++) {
      g.sessions.set(`s${i}`, mk(`s${i}`, { topic: 't'.repeat(24_000), lastReply: { text: 'r'.repeat(24_000), at: T1 } }));
    }
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(snap?.type).toBe('snapshot');
    expect(PhoneServerMessageSchema.parse(snap)).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(snap), 'utf8')).toBeLessThanOrEqual(PLAIN_MAX);
    if (snap?.type === 'snapshot') {
      expect(snap.sessions).toHaveLength(200);
      expect(snap.sessions[0]!.lastReply!.text).toHaveLength(2_048);
      expect(snap.sessions[0]!.topic).toHaveLength(TOPIC_MAX);
    }
  });
});

describe('phone gateway: request bodies on demand', () => {
  const BIG = 'x'.repeat(65_536);
  const withPlans = (g: ReturnType<typeof setup>, n = 12) => {
    for (let i = 0; i < n; i++) g.sessions.set(`p${i}`, mk(`p${i}`, { state: 'waiting_permission', pending: { kind: 'plan', text: `plan ${i}`, body: BIG, source: 'hook' } }));
  };

  it('a snapshot of 12 sessions waiting on a 64 KiB body stays under PLAIN_MAX, every body cut', async () => {
    const g = setup();
    withPlans(g);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = g.got('dev1');
    expect(g.got('dev1').filter(m => m.type === 'error')).toEqual([]);
    if (snap?.type !== 'snapshot') throw new Error('no snapshot');
    const plans = snap.sessions.filter(s => s.id.startsWith('p'));
    expect(plans).toHaveLength(12);
    for (const s of plans) expect(s.pending).toMatchObject({ cut: true, body: 'x'.repeat(SNAPSHOT_BODY_MAX) });
    expect(Buffer.byteLength(g.fm.sent[0]![1], 'utf8')).toBeLessThanOrEqual(PLAIN_MAX);
  });

  it('session.updated cuts the body too', async () => {
    const g = setup();
    withPlans(g, 1);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    g.gw.forward({ type: 'session.updated', session: g.sessions.get('p0')! });
    await flush();
    const upd = g.got('dev1').find(m => m.type === 'session.updated');
    expect(upd?.type === 'session.updated' && upd.session.pending).toMatchObject({ cut: true, body: 'x'.repeat(SNAPSHOT_BODY_MAX) });
  });

  it('session.pending gives the whole body, with its key and risk', async () => {
    const g = setup();
    withPlans(g, 1);
    g.send('dev1', { type: 'session.pending', id: 'p0' });
    await flush();
    const [m] = g.got('dev1');
    expect(PhoneServerMessageSchema.parse(m)).toMatchObject({ type: 'session.pending', id: 'p0', pending: { kind: 'plan', body: BIG, risk: 'high', riskReason: 'plan' } });
    if (m?.type === 'session.pending') expect(m.pending.cut).toBeUndefined();
  });

  it('session.pending on a session without a request, or an unknown one, is error unknown_session', async () => {
    const g = setup();
    g.send('dev1', { type: 'session.pending', id: 'c' });
    g.send('dev1', { type: 'session.pending', id: 'nope' });
    await flush();
    expect(g.got('dev1')).toEqual([
      { type: 'error', code: 'unknown_session', request: 'session.pending' },
      { type: 'error', code: 'unknown_session', request: 'session.pending' }
    ]);
  });
});


describe('phone gateway: device key', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const prepare = async (g: ReturnType<typeof setup>, deviceId = 'dev1') => {
    const before = g.got(deviceId).length;
    g.send(deviceId, { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const m = g.got(deviceId).slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const register = (g: ReturnType<typeof setup>, cred: unknown, op: string = randomUUID(), deviceId = 'dev1') => g.send(deviceId, { type: 'credential.register', op, credential: cred });

  it('answers confirm.prepare register with a challenge for the relay host', async () => {
    const g = setup();
    const c = await prepare(g);
    expect(c).toMatchObject({ purpose: 'register', rpId: 'relay.test', expiresInMs: 60_000 });
    expect(c.challenge.length).toBeGreaterThan(20);
  });

  it('registers a passkey: applied, then a snapshot that says device.confirm', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1').find(m => m.type === 'snapshot')).toMatchObject({ device: { confirm: false } });
    const c = await prepare(g);
    const op = randomUUID();
    register(g, softAuthenticator().create(rp, c.challenge), op);
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied']);
    expect(g.stored).toEqual(['dev1']);
    expect(g.creds.get('dev1')).toMatchObject({ rpId: 'relay.test', counter: 0 });
    const snaps = g.got('dev1').filter(m => m.type === 'snapshot');
    expect(snaps.at(-1)).toMatchObject({ device: { confirm: true } });
    expect(g.got('dev1').at(-1)?.type).toBe('snapshot');
  });

  it('replays the same op with the same result and stores the key once', async () => {
    const g = setup();
    const c = await prepare(g);
    const op = randomUUID();
    const cred = softAuthenticator().create(rp, c.challenge);
    register(g, cred, op);
    await flush();
    register(g, cred, op);
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied', 'applied']);
    expect(g.stored).toEqual(['dev1']);
  });

  it('refuses a challenge issued to another device', async () => {
    const g = setup();
    const c = await prepare(g, 'dev2');
    register(g, softAuthenticator().create(rp, c.challenge));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(g.stored).toEqual([]);
  });

  it('refuses an unknown or unreadable challenge, and a challenge used twice', async () => {
    const g = setup();
    register(g, softAuthenticator().create(rp, 'never-issued'));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    const c = await prepare(g);
    const cred = softAuthenticator().create(rp, c.challenge);
    expect(challengeOf(cred.clientDataJSON)).toBe(c.challenge);
    register(g, cred);
    await flush();
    register(g, cred);
    await flush();
    expect(g.results('dev1').slice(-4).map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied', 'received', 'rejected']);
    expect(g.stored).toEqual(['dev1']);
  });

  it('refuses an expired challenge with assertion_expired', async () => {
    const g = setup();
    const c = await prepare(g);
    g.clock.t += 60_001;
    register(g, softAuthenticator().create(rp, c.challenge));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_expired' });
    expect(g.stored).toEqual([]);
  });

  it('refuses a registration that does not verify', async () => {
    const g = setup();
    const c = await prepare(g);
    register(g, softAuthenticator().create(rp, c.challenge, { origin: 'https://evil.test' }));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(g.stored).toEqual([]);
  });

  it('a passkey registered with a userId made for this PC key can bring the device back: stored `recover`, said in the snapshot', async () => {
    const pc = await generateIdentity();
    const g = setup();
    g.fm.setPcKey(pc.publicKey);
    const c = await prepare(g);
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: softAuthenticator().create(rp, c.challenge), userId: b64u(await recoveryUserId(pc.publicKey)) });
    // The digest is WebCrypto's, a few ticks away.
    await vi.waitFor(() => expect(g.results('dev1').at(-1)).toMatchObject({ status: 'applied' }));
    expect(g.creds.get('dev1')).toMatchObject({ recover: true });
    expect(g.got('dev1').filter(m => m.type === 'snapshot').at(-1)).toMatchObject({ device: { confirm: true, recover: true } });
  });

  it('a userId made for another PC, an old random one, or none: registered as before, without `recover`', async () => {
    const pc = await generateIdentity();
    const other = await generateIdentity();
    for (const userId of [b64u(await recoveryUserId(other.publicKey)), b64u(randomBytes(16)), undefined]) {
      const g = setup();
      g.fm.setPcKey(pc.publicKey);
      const c = await prepare(g);
      g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: softAuthenticator().create(rp, c.challenge), ...(userId ? { userId } : {}) });
      await vi.waitFor(() => expect(g.results('dev1').at(-1)).toMatchObject({ status: 'applied' }));
      expect(g.creds.get('dev1')).not.toHaveProperty('recover');
      const snap = g.got('dev1').filter(m => m.type === 'snapshot').at(-1);
      expect(snap).toMatchObject({ device: { confirm: true } });
      expect(snap?.type === 'snapshot' && snap.device).not.toHaveProperty('recover');
    }
  });

  it('without a secure relay URL there is no challenge and no device check', async () => {
    const g = setup({ relayUrl: 'http://192.168.1.10' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1')[0]).toEqual({ type: 'error', code: 'invalid', request: 'confirm.prepare' });
    expect(g.got('dev1').find(m => m.type === 'snapshot')).toMatchObject({ device: { confirm: false } });
  });
});

describe('phone gateway: a high-impact accept carries a device assertion', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  const RPC: Pending = { kind: 'question', text: 'Allow the edit?', tool: 'omp', options: ['Allow', 'Reject'], source: 'rpc' };
  type G = ReturnType<typeof setup>;
  const challengeFor = async (g: G, id: string, pending: Pending, purpose: 'decide' | 'register' = 'decide'): Promise<string> => {
    const before = g.got('dev1').length;
    g.send('dev1', purpose === 'register'
      ? { type: 'confirm.prepare', purpose }
      : { type: 'confirm.prepare', purpose, id, expect: { kind: pending.kind, text: pending.text, key: pendingKey(pending) } });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m.challenge;
  };
  /** A device with a registered passkey. */
  const enrolled = async () => {
    const g = setup();
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...RPC } }));
    const auth = softAuthenticator();
    const c = await challengeFor(g, '', RPC, 'register');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, c) });
    await flush();
    g.stored.length = 0;
    return { g, auth };
  };
  const last = (g: G) => g.results('dev1').at(-1);
  const withAssertion = (m: object, assertion: unknown) => ({ ...m, assertion });

  it('confirm.prepare decide without id or expect is invalid; for an unknown session unknown_session; without a credential invalid', async () => {
    const { g } = await enrolled();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'a' });
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'nope', expect: seen(PUSH) });
    g.send('dev2', { type: 'confirm.prepare', purpose: 'decide', id: 'a', expect: seen(PUSH) });
    await flush();
    expect(g.got('dev1').slice(-3)).toEqual([
      { type: 'error', code: 'invalid', request: 'confirm.prepare' },
      { type: 'error', code: 'invalid', request: 'confirm.prepare' },
      { type: 'error', code: 'unknown_session', request: 'confirm.prepare' }
    ]);
    expect(g.got('dev2')).toEqual([{ type: 'error', code: 'invalid', request: 'confirm.prepare' }]);
  });

  it('answers confirm.prepare decide with a challenge, the credential id and the relay host', async () => {
    const { g, auth } = await enrolled();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'decide', id: 'a', expect: seen(PUSH) });
    await flush();
    expect(g.got('dev1').at(-1)).toMatchObject({ type: 'confirm.challenge', purpose: 'decide', rpId: 'relay.test', credentialId: auth.id, expiresInMs: 60_000 });
  });

  it('accepts a high request with a valid assertion: applied, the local front gets no assertion, the counter is stored', async () => {
    const { g, auth } = await enrolled();
    const m = decide('a', 'accept', PUSH);
    const challenge = await challengeFor(g, 'a', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(g.dispatched).toEqual([{ type: 'session.decide', id: 'a', decision: 'accept', expect: { kind: 'permission', text: 'git push', key: pendingKey(PUSH) }, by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
    expect(g.dispatched[0]).not.toHaveProperty('assertion');
    expect(g.stored).toEqual(['dev1']);
    expect(g.creds.get('dev1')?.counter).toBe(1);
  });

  it('refuses always on a high request without an assertion, or without a credential; deny and a low accept need none', async () => {
    const { g } = await enrolled();
    const always = decide('a', 'always', PUSH);
    g.send('dev1', always);
    const bare = setup();
    const m = decide('a', 'accept', PUSH);
    bare.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: always.op, status: 'rejected', reason: 'confirm_required' });
    expect(last(bare)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'confirm_required' });
    expect(g.dispatched).toEqual([]);
    const deny = decide('a', 'deny', PUSH);
    const low = decide('b', 'accept', LS);
    g.send('dev1', deny);
    g.send('dev1', low);
    await flush();
    const results = g.results('dev1');
    expect(results).toContainEqual({ type: 'operation.result', op: deny.op, status: 'applied' });
    expect(results).toContainEqual({ type: 'operation.result', op: low.op, status: 'applied' });
    expect(g.dispatched.map(d => d.type === 'session.decide' && [d.id, d.decision])).toEqual([['a', 'deny'], ['b', 'accept']]);
  });

  it('a stale expect.key is stale even with a valid assertion, and the challenge stays usable', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const old = decide('a', 'accept', PUSH, { key: 'old-key' });
    g.send('dev1', withAssertion(old, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: old.op, status: 'rejected', reason: 'stale' });
    const fresh = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(fresh, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: fresh.op, status: 'applied' });
  });

  it('an assertion bound to another request is assertion_invalid', async () => {
    const { g, auth } = await enrolled();
    g.sessions.set('p2', mk('p2', { state: 'waiting_permission', pending: { ...PUSH, text: 'git push -f' } }));
    const challenge = await challengeFor(g, 'p2', { ...PUSH, text: 'git push -f' });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toEqual([]);
  });

  it('the same assertion under a new op is assertion_invalid (challenge spent); the same op again replays applied', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    // The replay answers from the registry: a re-run would find the challenge spent and answer assertion_invalid.
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    expect(g.results('dev1').slice(-2).map(r => r.type === 'operation.result' && r.status)).toEqual(['applied', 'applied']);
    expect(g.dispatched).toHaveLength(1);
    expect(g.stored).toEqual(['dev1']);
    const again = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(again, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: again.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toHaveLength(1);
  });

  it('an expired challenge is assertion_expired', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    g.clock.t += 61_000;
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_expired' });
  });

  it('a replayed counter is assertion_invalid and the stored counter does not move', async () => {
    const { g, auth } = await enrolled();
    const first = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(first, auth.get(rp, await challengeFor(g, 'a', PUSH), { counter: 5 })));
    await flush();
    g.sessions.get('a')!.pending = { ...PUSH };
    const second = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(second, auth.get(rp, await challengeFor(g, 'a', PUSH), { counter: 5 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: second.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.creds.get('dev1')?.counter).toBe(5);
    expect(g.stored).toEqual(['dev1']);
  });

  it('a reply to an OMP rpc request needs an assertion; with one it goes through', async () => {
    const { g, auth } = await enrolled();
    const expect_ = seen(RPC);
    const bare = { type: 'session.reply', op: randomUUID(), id: 'r', text: 'yes', expect: { ...expect_, key: pendingKey(RPC) } };
    g.send('dev1', bare);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: bare.op, status: 'rejected', reason: 'confirm_required' });
    expect(g.dispatched).toEqual([]);
    const m = { ...bare, op: randomUUID() };
    g.send('dev1', withAssertion(m, auth.get(rp, await challengeFor(g, 'r', RPC), { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied' });
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'r', text: 'yes', by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
  });

  it('an assertion no check binds is stale and spends no challenge: a reply with a null expect while idle, a decide on a low request', async () => {
    const { g, auth } = await enrolled();
    g.sessions.set('idle', mk('idle'));
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 1 });
    const reply = { type: 'session.reply', op: randomUUID(), id: 'idle', text: '2', expect: null };
    g.send('dev1', withAssertion(reply, assertion));
    const low = decide('b', 'accept', LS);
    g.send('dev1', withAssertion(low, assertion));
    await flush();
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op: reply.op, status: 'rejected', reason: 'stale' });
    expect(g.results('dev1')).toContainEqual({ type: 'operation.result', op: low.op, status: 'rejected', reason: 'stale' });
    expect(g.dispatched).toEqual([]);
    const ok = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(ok, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: ok.op, status: 'applied' });
  });

  it('a challenge prepared for one OMP dialog does not verify for another dialog with the same content', async () => {
    const { g, auth } = await enrolled();
    const A: Pending = { ...RPC, requestId: 'dlg-1' };
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...A } }));
    const challenge = await challengeFor(g, 'r', A);
    g.sessions.set('r', mk('r', { state: 'waiting_permission', pending: { ...RPC, requestId: 'dlg-2' } }));
    const m = { type: 'session.reply', op: randomUUID(), id: 'r', text: '1', expect: seen(A) };
    g.send('dev1', withAssertion(m, auth.get(rp, challenge, { counter: 1 })));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.dispatched).toEqual([]);
  });

  it('logs carry neither the challenge nor the signature, even when verification fails', async () => {
    const { g, auth } = await enrolled();
    const challenge = await challengeFor(g, 'a', PUSH);
    const assertion = auth.get(rp, challenge, { counter: 0, type: 'webauthn.create' });
    const m = decide('a', 'accept', PUSH);
    g.send('dev1', withAssertion(m, assertion));
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'assertion_invalid' });
    expect(g.logs).toContain('phone: assertion refused for device dev1');
    for (const secret of [challenge, assertion.signature, assertion.clientDataJSON, assertion.authenticatorData]) expect(g.logs.some(l => l.includes(secret))).toBe(false);
  });
});

describe('phone gateway: OMP requests answered with their own questions', () => {
  const ASK: Pending = {
    kind: 'question', text: 'Two questions', source: 'rpc', tool: 'omp', requestId: 'ask-2',
    questions: [
      { id: 'q1', question: 'Which colour?', options: [{ label: 'red' }, { label: 'green' }] },
      { id: 'q2', question: 'Which size?', multi: true, options: [{ label: 'S' }, { label: 'M' }] }
    ]
  };
  const omp = () => {
    const g = setup();
    g.sessions.set('o', mk('o', { tool: 'omp', tmuxSession: null, backend: 'omp-rpc', state: 'waiting_input', pending: { ...ASK } }));
    return g;
  };
  const answer = (extra: Record<string, unknown> = {}) => ({
    type: 'session.answer', op: randomUUID(), id: 'o', requestId: 'ask-2',
    answers: [{ id: 'q1', selected: ['red'] }, { id: 'q2', selected: ['S', 'M'], text: 'and XL' }],
    expect: { kind: ASK.kind, text: ASK.text, key: pendingKey(ASK) }, ...extra
  });
  const final = (g: ReturnType<typeof setup>) => g.results('dev1').filter(r => r.type === 'operation.result' && r.status !== 'received');

  it('the snapshot announces what each tool can do', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.capabilities.omp).toEqual({ freeTextAnswer: false, decide: false, questions: true });
    expect(snap?.type === 'snapshot' && snap.capabilities.claude).toMatchObject({ decide: true, questions: false });
  });

  it('an answer to the ask of 2 questions reaches the local front, with no field of the phone added', async () => {
    const g = omp();
    const m = answer({ cancel: true });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'applied' }]);
    expect(g.dispatched).toEqual([{ type: 'session.answer', id: 'o', requestId: 'ask-2', answers: m.answers, cancel: true }]);
    const plain = answer();
    g.send('dev1', plain);
    await flush();
    expect(g.dispatched[1]).toEqual({ type: 'session.answer', id: 'o', requestId: 'ask-2', answers: plain.answers });
    expect(Object.keys(g.dispatched[1]!).sort()).toEqual(['answers', 'id', 'requestId', 'type']);
  });

  it('the requestId of an earlier ask is stale', async () => {
    const g = omp();
    const m = answer({ requestId: 'ask-1' });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to a request that changed is stale', async () => {
    const g = omp();
    const m = answer({ expect: { kind: ASK.kind, text: ASK.text, key: 'k-old' } });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'stale' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to a session that is not OMP is not offered', async () => {
    const g = setup();
    const m = answer({ id: 'q', expect: seen(PICK) });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'not_offered' }]);
    expect(g.dispatched).toEqual([]);
  });

  it('an answer to an unknown session is refused as such', async () => {
    const g = omp();
    const m = answer({ id: 'nope' });
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'unknown_session' }]);
  });

  it('an accept on an OMP session is not offered, never confirm_required, and spends no challenge', async () => {
    const g = omp();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const m = { type: 'session.decide', op: randomUUID(), id: 'o', decision: 'accept', expect: { kind: ASK.kind, text: ASK.text, key: pendingKey(ASK) } };
    g.send('dev1', m);
    await flush();
    expect(final(g)).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'not_offered' }]);
    expect(g.dispatched).toEqual([]);
  });
});

describe('phone gateway: device.forget', () => {
  it('answers applied first, then revokes the device', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    expect(g.results('dev1').map(m => m.type === 'operation.result' && m.status)).toEqual(['received', 'applied']);
    expect(g.fm.revoked).toEqual([{ id: 'dev1', sentBefore: 2 }]);
    expect(g.fm.mobile.state().devices.map(d => d.id)).toEqual(['dev2']);
    expect(g.dispatched).toEqual([]);
  });

  it('a resend of the same op raises nothing and revokes once', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    g.send('dev1', { type: 'device.forget', op });
    await flush();
    expect(g.fm.revoked).toHaveLength(1);
    expect(g.got('dev1').some(m => m.type === 'error')).toBe(false);
  });
});

describe('phone gateway: push', () => {
  const KEYS = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
  const sub = (op: string, endpoint = ENDPOINT, key = 'K1') => ({ type: 'push.subscribe', op, subscription: { endpoint, keys: KEYS }, key: key.padEnd(87, 'k') });
  const pushOf = (g: ReturnType<typeof setup>, d: string) => {
    const snaps = g.got(d).filter(m => m.type === 'snapshot');
    return snaps.length ? (snaps[snaps.length - 1] as { device?: { push?: string } }).device?.push : undefined;
  };

  it('push.subscribe is applied and the next snapshot says on; push.unsubscribe says off', async () => {
    const g = setup();
    g.fm.setRelayKey('K1'.padEnd(87, 'k'));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('off');
    const op = randomUUID();
    g.send('dev1', sub(op));
    await flush();
    expect(g.results('dev1').map(r => r.type === 'operation.result' && r.status)).toEqual(['received', 'applied']);
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('on');
    expect(g.fm.pushes.get('dev1')).toMatchObject({ endpoint: ENDPOINT, p256dh: KEYS.p256dh, auth: KEYS.auth });
    g.send('dev1', { type: 'push.unsubscribe', op: randomUUID() });
    await flush();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('off');
  });

  it('an endpoint off the list is rejected invalid and nothing is stored', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', sub(op, 'https://evil.example.com/x'));
    await flush();
    expect(g.results('dev1')).toEqual([{ type: 'operation.result', op, status: 'rejected', reason: 'invalid' }]);
    expect(g.fm.pushes.size).toBe(0);
  });

  it('the status is unavailable without push on the relay and stale when the relay key changed', async () => {
    const g = setup();
    g.send('dev1', sub(randomUUID(), ENDPOINT, 'K1'));
    await flush();
    g.fm.setRelayKey('K1'.padEnd(87, 'k'));
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(pushOf(g, 'dev1')).toBe('on');
    g.fm.setRelayKey('K2');
    await flush();
    expect(pushOf(g, 'dev1')).toBe('stale');
    g.fm.setRelayKey(null);
    await flush();
    expect(pushOf(g, 'dev1')).toBe('unavailable');
  });

  it('a second subscription under the same op is a conflict', async () => {
    const g = setup();
    const op = randomUUID();
    g.send('dev1', sub(op, ENDPOINT));
    await flush();
    g.send('dev1', sub(op, 'https://fcm.googleapis.com/fcm/send/other'));
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'rejected', reason: 'conflict' });
  });

  it('presence visible is kept until the channel falls', async () => {
    const g = setup();
    expect(g.gw.visible('dev1')).toBe(false);
    g.send('dev1', { type: 'presence', visible: true });
    expect(g.gw.visible('dev1')).toBe(true);
    expect(g.gw.visible('dev2')).toBe(false);
    g.fm.setOnline('dev1', false);
    expect(g.gw.visible('dev1')).toBe(false);
    g.fm.setOnline('dev1', true);
    expect(g.gw.visible('dev1')).toBe(false);
    g.send('dev1', { type: 'presence', visible: true });
    g.send('dev1', { type: 'presence', visible: false });
    expect(g.gw.visible('dev1')).toBe(false);
  });
});


/** Chat threads stand-in: one fake chat per device, a record of drops and emitters. */
function fakeChats() {
  const drops: string[] = [];
  const emitters = new Map<string, unknown>();
  const asked: Array<{ id: string; qid: string; tool: unknown }> = [];
  const images: unknown[] = [];
  const cancelled: Array<{ id: string; qid: string }> = [];
  const resets: string[] = [];
  const turns = new Map<string, Array<{ qid: string; question: string; askedAt: string; steps: never[]; answer?: string }>>();
  const dropping = new Set<string>();
  /** Every `device(id)`: it creates the thread when absent. */
  const touched: string[] = [];
  const gone = new Set<string>();
  const chatOf = (id: string) => ({
    async ask(qid: string, text: string, emit: (m: ServerMessage) => void, tool?: unknown, refs?: unknown) {
      asked.push({ id, qid, tool });
      images.push(refs);
      const t = { qid, question: text, askedAt: T0, steps: [] as never[], answer: `answer of ${id}` };
      turns.set(id, [...(turns.get(id) ?? []), t]);
      emit({ type: 'chat.delta', qid, text: 'ans' } as never);
      emit({ type: 'chat.done', qid, text: t.answer, at: T0 } as never);
    },
    cancel(qid: string) { cancelled.push({ id, qid }); },
    async reset(emit: (m: ServerMessage) => void) { resets.push(id); turns.set(id, []); emit({ type: 'chat.history', turns: [] } as never); },
    history: () => turns.get(id) ?? [],
    ignore(qid: string, undo: boolean) {
      const t = (turns.get(id) ?? []).find(x => x.qid === qid) as { ignoredAt?: string; actions?: unknown } | undefined;
      if (!t?.actions) return 'no card to ignore';
      if (undo) delete t.ignoredAt; else t.ignoredAt = T0;
      return null;
    }
  });
  const chats = {
    device(id: string) { touched.push(id); gone.delete(id); if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('invalid device id'); if (dropping.has(id)) throw new Error('device thread is being dropped'); return chatOf(id) as never; },
    async deviceTool() { return 'codex' as const; },
    owner(qid: string) { for (const [id, ts] of turns) if (ts.some(t => t.qid === qid)) return `device:${id}` as const; return undefined; },
    peek(id: string) { return gone.has(id) ? undefined : chatOf(id) as never; },
    async drop(id: string) { drops.push(id); gone.add(id); turns.delete(id); },
    setEmitter(thread: string, e: unknown) { emitters.set(thread, e); }
  };
  return { chats, images, drops, emitters, asked, cancelled, resets, turns, dropping, touched };
}

describe('phone gateway: the chat, removed (#40)', () => {
  it('an older phone gets a clean refusal: a question ends at once, its reads are refused, its card and point operations are not offered', async () => {
    const g = setup({ relayUrl: 'https://relay.test' });
    const qid = randomUUID();
    g.send('dev1', { type: 'chat.ask', qid, text: 'hello' });
    g.send('dev1', { type: 'chat.history' });
    await flush();
    expect(g.got('dev1')).toContainEqual({ type: 'chat.error', qid, code: 'failed' });
    expect(g.got('dev1')).toContainEqual({ type: 'error', code: 'invalid', request: 'chat.history' });
    const ops = [
      { type: 'chat.relay', op: randomUUID(), qid }, { type: 'chat.launch', op: randomUUID(), qid }, { type: 'chat.close', op: randomUUID(), qid },
      { type: 'chat.act', op: randomUUID(), qid }, { type: 'chat.ignore', op: randomUUID(), qid }, { type: 'chat.task', op: randomUUID(), qid, row: 0 },
      { type: 'point.later', op: randomUUID(), qid }, { type: 'operator.read', op: randomUUID(), eventId: 1 }
    ];
    for (const m of ops) g.send('dev1', m as never);
    await flush();
    for (const m of ops) expect(g.results('dev1').filter(r => r.op === m.op && r.status !== 'received').at(-1)).toMatchObject({ status: 'rejected', reason: 'not_offered' });
    // Nor does the snapshot say the device has a chat.
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    const snap = g.got('dev1').find(m => m.type === 'snapshot');
    expect(snap?.type === 'snapshot' && snap.device).not.toHaveProperty('chat');
  });
});

describe('phone gateway: Ledge\'s tasks (ledge home spec §2.4)', () => {
  const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'a', ownerName: 'a', state: 'taken', at: T0, updatedAt: new Date().toISOString(), log: [], ...extra });

  it('after a snapshot, Ledge\'s tasks only', async () => {
    const tasks = [task('t000001', { state: 'done', result: 'fait' }), task('t000002'), task('t000003', { giver: 'b', giverName: 'b' })];
    const g = setup({ tasks: () => tasks });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const got = g.got('dev1');
    for (const m of got) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    const listed = got.find(m => m.type === 'tasks');
    expect(listed?.type === 'tasks' && listed.tasks.map(x => [x.id, x.ownerName, x.result])).toEqual([['t000001', 'a', 'fait'], ['t000002', 'a', undefined]]);
  });

  it('a daemon without tasks sends none', async () => {
    const g = setup();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1').some(m => m.type === 'tasks')).toBe(false);
  });

  it('task.seen is dispatched; its answer makes the outcome', async () => {
    const g = setup({ tasks: () => [], dispatch: async (msg, reply) => {
      if (msg.type === 'task.cmd') reply(msg.task === 't000001' ? { type: 'task.result', rid: msg.rid, task: task('t000001', { seen: true }) } as ServerMessage : { type: 'task.result', rid: msg.rid, reason: 'unknown' } as ServerMessage);
    } });
    g.send('dev1', { type: 'task.seen', op: randomUUID(), task: 't000001' });
    g.send('dev1', { type: 'task.seen', op: randomUUID(), task: 't0000ff' });
    await flush();
    expect(g.dispatched).toEqual([expect.objectContaining({ type: 'task.cmd', by: 'ledge', op: 'seen', task: 't000001' }), expect.objectContaining({ type: 'task.cmd', task: 't0000ff' })]);
    expect(g.results('dev1').filter(r => r.status !== 'received').map(r => r.status)).toEqual(['applied', 'failed']);
  });

  it('task.updated reaches the following devices; another giver\'s task does not', async () => {
    const tasks: Task[] = [];
    const g = setup({ tasks: () => tasks });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').length;
    g.gw.forward({ type: 'task.updated', task: task('t000004', { giver: 'b', giverName: 'b' }) });
    tasks.push(task('t000005'));
    g.gw.forward({ type: 'task.updated', task: task('t000005') });
    await flush();
    expect(g.got('dev1').slice(before).map(m => m.type)).toEqual(['task.updated']);
  });
});

const u32 = (n: number) => Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const png = (w: number, h: number, size = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0]), Buffer.alloc(Math.max(0, size - 29), 7)]);
const ATTACH_FULL = ATTACHMENT_MAX;
/** Waits for the store's file writes: `flush` only spins the event loop. */
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 5)); };
const put = (requestId: string, image: Buffer, preview?: Buffer) => ({
  type: 'attachment.put', requestId,
  image: { mime: 'image/png', data: image.toString('base64'), ...(preview ? { preview: { mime: 'image/png', data: preview.toString('base64') } } : {}) }
});

describe('phone gateway: images', () => {
  it('refuses a 400 001-byte put with too_large', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(100, 100, ATTACHMENT_MAX + 1)));
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'attachment.error', requestId: 'r1', reason: 'too_large' }]);
  });

  it('stores a 400 000-byte image with a 40 000-byte preview, and the answer fits the transport', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(1600, 1200, ATTACH_FULL), png(480, 360, PREVIEW_MAX)));
    await until(() => g.got('dev1').length > 0);
    const [m] = g.got('dev1');
    expect(m).toMatchObject({ type: 'attachment.stored', requestId: 'r1', ref: { mime: 'image/png', width: 1600, height: 1200, bytes: ATTACHMENT_MAX, preview: true } });
    expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    // Sent as a stored answer, not the outbox's too_large error: the frame passed `padPlain`.
    expect(padPlain(g.fm.sent[0]![1].trimEnd())).not.toBeNull();
  });

  it('the largest attachment.data frame (a 400 000-byte image) passes the transport frame cap', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(1600, 1200, ATTACHMENT_MAX)));
    await until(() => g.got('dev1').length > 0);
    const id = (g.got('dev1')[0] as { ref: { id: string } }).ref.id;
    g.send('dev1', { type: 'attachment.get', requestId: 'r2', attachment: id });
    await until(() => g.got('dev1').length > 1);
    const frame = g.fm.sent[1]![1].trimEnd();
    expect(JSON.parse(frame)).toMatchObject({ type: 'attachment.data', requestId: 'r2' });
    expect(padPlain(frame)).not.toBeNull();
    expect(Buffer.byteLength(frame)).toBeLessThan(PLAIN_MAX);
  });

  it('answers a get with the bytes, the preview on request, and not_found for an unknown id', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(10, 10, 100), png(5, 5, 60)));
    await until(() => g.got('dev1').length > 0);
    const ref = (g.got('dev1')[0] as { ref: { id: string } }).ref;
    g.send('dev1', { type: 'attachment.get', requestId: 'r2', attachment: ref.id });
    g.send('dev1', { type: 'attachment.get', requestId: 'r3', attachment: ref.id, preview: true });
    g.send('dev1', { type: 'attachment.get', requestId: 'r4', attachment: 'a'.repeat(64) });
    await until(() => g.got('dev1').length >= 4);
    const byId = (r: string) => (g.got('dev1') as Array<Record<string, unknown>>).find(m => m.requestId === r);
    const full = byId('r2'), small = byId('r3'), missing = byId('r4');
    expect(full).toMatchObject({ type: 'attachment.data', requestId: 'r2', attachment: ref.id, mime: 'image/png' });
    expect(Buffer.from(full!.data as string, 'base64')).toHaveLength(100);
    expect(Buffer.from(small!.data as string, 'base64')).toHaveLength(60);
    expect(missing).toEqual({ type: 'attachment.error', requestId: 'r4', reason: 'not_found' });
  });

  it('a device that is not approved gets nothing', async () => {
    const g = setup({ devices: ['dev1'] });
    g.send('stranger', put('r1', png(10, 10, 100)));
    await flush();
    expect(g.got('stranger')).toEqual([]);
  });

  it('dispatches a reply with images and no text', async () => {
    const g = setup();
    g.send('dev1', put('r1', png(10, 10, 100)));
    await until(() => g.got('dev1').length > 0);
    const id = (g.got('dev1')[0] as { ref: { id: string } }).ref.id;
    g.send('dev1', { type: 'session.reply', op: randomUUID(), id: 'c', text: '', attachments: [id], expect: null });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.reply', id: 'c', text: '', attachments: [id], by: { kind: 'device', id: 'dev1', name: 'dev1' } }]);
  });

  it('refuses an empty reply with no images as invalid, dispatching nothing', async () => {
    const g = setup();
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: '', expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'invalid' });
    expect(g.dispatched).toEqual([]);
  });

  it('reports a daemon refusal of the images as that reason', async () => {
    const g = setup({ dispatch: async (msg, reply) => { reply({ type: 'error', message: 'no', request: msg.type, code: 'attachments_not_accepted' }); } });
    const m = { type: 'session.reply', op: randomUUID(), id: 'c', text: 'hi', attachments: ['a'.repeat(64)], expect: null };
    g.send('dev1', m);
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'attachments_not_accepted' });
  });

});

describe('phone gateway: a session\'s slash commands', () => {
  it('relays session.commands to the local daemon, pushes the listing cut to the phone\'s bounds, and says so in the snapshot', async () => {
    const g = setup({ dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
      if (msg.type !== 'session.commands') return;
      reply({ type: 'session.commands.listing', requestId: 'someone-else', id: msg.id, commands: [] });
      reply({ type: 'session.commands.listing', requestId: msg.requestId, id: msg.id, tool: 'claude', commands: [
        { name: 'compact', source: 'builtin', description: 'D'.repeat(300), argumentHint: '<instructions>' },
        { name: 'usage', source: 'builtin', blocked: 'panel' }
      ] });
    } });
    g.sessions.set('a', mk('a'));
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    expect(g.got('dev1')[0]).toMatchObject({ type: 'snapshot', daemon: { commands: true } });
    g.send('dev1', { type: 'session.commands', id: 'a' }); await flush();
    expect(g.dispatched.filter(m => m.type === 'session.commands')).toEqual([{ type: 'session.commands', requestId: expect.any(String), id: 'a' }]);
    const listing = g.got('dev1').find(m => m.type === 'session.commands.listing');
    expect(PhoneServerMessageSchema.safeParse(listing).success).toBe(true);
    expect(listing).toEqual({ type: 'session.commands.listing', id: 'a', commands: [
      { name: 'compact', source: 'builtin', description: 'D'.repeat(200), argumentHint: '<instructions>' },
      { name: 'usage', source: 'builtin', blocked: 'panel' }
    ] });
  });
  it('an unknown session, a daemon error and no answer in time push none, in error, never the daemon\'s text', async () => {
    const g = setup({ dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
      if (msg.type === 'session.commands') reply({ type: 'session.commands.listing', requestId: msg.requestId, id: msg.id, commands: [], error: 'not installed at /home/me' });
    } });
    g.sessions.set('a', mk('a'));
    g.send('dev1', { type: 'session.commands', id: 'nope' }); await flush();
    g.send('dev1', { type: 'session.commands', id: 'a' }); await flush();
    expect(g.got('dev1')).toEqual([{ type: 'session.commands.listing', id: 'nope', commands: [], error: true }, { type: 'session.commands.listing', id: 'a', commands: [], error: true }]);
    expect(g.dispatched.filter(m => m.type === 'session.commands')).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slow = setup({ dispatch: () => new Promise<void>(() => {}) });
      slow.sessions.set('a', mk('a'));
      slow.send('dev1', { type: 'session.commands', id: 'a' }); await flush();
      expect(slow.got('dev1')).toEqual([]);
      vi.advanceTimersByTime(25_000); await flush();
      expect(slow.got('dev1')).toEqual([{ type: 'session.commands.listing', id: 'a', commands: [], error: true }]);
    } finally { vi.useRealTimers(); }
  });
});

describe('phone gateway: a queue row\'s state (docs/mockups/ledge-openrig-messages.html, decision 2)', () => {
  const ID = 'qitem-20261102211216-d6159d44d566f343';
  const row = (state: string, summary = 'Back messages OpenRig') => ({ id: ID, state, summary, from: 'pilot-lead@ledge-dev-2', to: 'dev-back@ledge-dev-2', createdAt: T0, updatedAt: T1, at: T1 });
  it('relays openrig.row to the local daemon and pushes its state, a change on the next ask; the snapshot says so', async () => {
    const states = ['in-progress', 'handed-off'];
    const g = setup({ dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
      if (msg.type !== 'openrig.row') return;
      reply({ type: 'openrig.rowState', requestId: 'someone-else', qitem: msg.qitem, row: row('done') });
      reply({ type: 'openrig.rowState', requestId: msg.requestId, qitem: msg.qitem, row: { ...row(states.shift()!, 'S'.repeat(300)), handedOffTo: 'review-qa@ledge-dev-2' } });
    } });
    g.send('dev1', { type: 'snapshot.request' }); await flush();
    expect(g.got('dev1')[0]).toMatchObject({ type: 'snapshot', daemon: { rigRows: true } });
    g.send('dev1', { type: 'openrig.row', qitem: ID }); await flush();
    g.send('dev1', { type: 'openrig.row', qitem: ID }); await flush();
    expect(g.dispatched.filter(m => m.type === 'openrig.row')).toEqual([{ type: 'openrig.row', requestId: expect.any(String), qitem: ID }, { type: 'openrig.row', requestId: expect.any(String), qitem: ID }]);
    const got = g.got('dev1').filter(m => m.type === 'openrig.rowState');
    for (const m of got) expect(PhoneServerMessageSchema.safeParse(m).success).toBe(true);
    expect(got.map(m => m.type === 'openrig.rowState' && m.row?.state)).toEqual(['in-progress', 'handed-off']);
    expect(got[0]).toMatchObject({ qitem: ID, row: { handedOffTo: 'review-qa@ledge-dev-2', summary: expect.stringMatching(/^S+…?$/) } });
    expect(got[0]!.type === 'openrig.rowState' && got[0]!.row!.summary!.length).toBeLessThanOrEqual(200);
  });
  it('no row, a daemon error and no answer in time push the row as not followed, never the daemon\'s text', async () => {
    const g = setup({ dispatch: async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
      if (msg.type !== 'openrig.row') return;
      reply({ type: 'openrig.rowState', requestId: msg.requestId, qitem: msg.qitem, error: msg.qitem === 'qitem-gone' ? 'not_found' : 'Error: rig failed in /home/me' });
    } });
    g.send('dev1', { type: 'openrig.row', qitem: 'qitem-gone' }); await flush();
    g.send('dev1', { type: 'openrig.row', qitem: 'qitem-broken' }); await flush();
    expect(g.got('dev1')).toEqual([{ type: 'openrig.rowState', qitem: 'qitem-gone', error: 'not_found' }, { type: 'openrig.rowState', qitem: 'qitem-broken', error: 'unavailable' }]);
    // not a queue id: refused by the whitelist, never asked
    g.send('dev1', { type: 'openrig.row', qitem: '--json' }); await flush();
    expect(g.dispatched.filter(m => m.type === 'openrig.row')).toHaveLength(2);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slow = setup({ dispatch: () => new Promise<void>(() => {}) });
      for (let k = 0; k < 9; k++) slow.send('dev1', { type: 'openrig.row', qitem: `qitem-${k}` });
      await flush();
      // the ninth at once: a device holds at most eight reads
      expect(slow.got('dev1')).toEqual([{ type: 'openrig.rowState', qitem: 'qitem-8', error: 'unavailable' }]);
      vi.advanceTimersByTime(15_000); await flush();
      expect(slow.got('dev1').filter(m => m.type === 'openrig.rowState')).toHaveLength(9);
      expect(slow.got('dev1').every(m => m.type === 'openrig.rowState' && m.error === 'unavailable')).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('phone gateway: a session\'s model (#58)', () => {
  /** A daemon that answers each `session.model` with what `answer` gives, and `models.list` with `listing`. */
  const daemon = (o: { answer?: (m: Extract<ClientMessage, { type: 'session.model' }>) => ServerMessage[]; listing?: (m: Extract<ClientMessage, { type: 'models.list' }>) => ServerMessage[] } = {}) => async (msg: ClientMessage, reply: (m: ServerMessage) => void) => {
    if (msg.type === 'session.model') for (const m of o.answer?.(msg) ?? []) reply(m);
    if (msg.type === 'models.list') for (const m of o.listing?.(msg) ?? []) reply(m);
  };
  const change = (id: string, extra: object = {}) => ({ type: 'session.model', op: randomUUID(), id, model: 'opus', effort: 'high', ...extra });
  const finals = (g: ReturnType<typeof setup>) => g.results('dev1').filter(r => r.status !== 'received').map(r => r.type === 'operation.result' && [r.status, r.reason ?? null]);

  it('snapshot says models when the daemon can', async () => {
    const on = setup({ deps: { models: true } });
    const off = setup();
    for (const g of [on, off]) g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const [snap] = on.got('dev1');
    expect(PhoneServerMessageSchema.parse(snap)).toMatchObject({ type: 'snapshot', daemon: { models: true } });
    // Each launcher session not ended can switch, whatever the flag: the flag only says the daemon takes it.
    expect(snap?.type === 'snapshot' && snap.sessions.map(s => s.canSwitch)).toEqual([true, true, true, true]);
    const [old] = off.got('dev1');
    expect(old?.type === 'snapshot' && old.daemon).not.toHaveProperty('models');
  });

  it('models.list relays to the local daemon and pushes the listing', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }));
    const g = setup({ deps: { models: true }, dispatch: daemon({ listing: m => [
      // Another request's listing is not this one's.
      { type: 'models.listing', requestId: 'someone-else', tool: 'claude', models: [{ id: 'stray', label: 'Stray' }] },
      { type: 'models.listing', requestId: m.requestId, tool: 'claude', models: [
        { id: 'opus', label: 'L'.repeat(100), description: 'D'.repeat(300), efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'a', 'b', 'c', 'd', 'e'], defaultEffort: 'high', isDefault: true, secret: '/home/me' } as never,
        { id: 'x'.repeat(121), label: 'too long an id' },
        ...many
      ] }
    ] }) });
    g.send('dev1', { type: 'models.list', tool: 'claude' });
    await flush();
    expect(g.dispatched).toEqual([{ type: 'models.list', requestId: expect.any(String), tool: 'claude' }]);
    const [listing] = g.got('dev1');
    expect(PhoneServerMessageSchema.safeParse(listing).success).toBe(true);
    if (listing?.type !== 'models.listing') throw new Error('no listing');
    expect(listing).not.toHaveProperty('error');
    expect(listing.tool).toBe('claude');
    expect(listing.models).toHaveLength(40);
    // Its strings cut to the phone's bounds, no key it does not know; an id too long to be sent back whole is left out.
    expect(listing.models[0]).toEqual({ id: 'opus', label: 'L'.repeat(80), description: 'D'.repeat(200), efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'a', 'b', 'c'], defaultEffort: 'high', isDefault: true });
    expect(listing.models.slice(1).map(x => x.id)).toEqual(many.slice(0, 39).map(x => x.id));
    // Without the flag, the read is ignored: nothing reaches the daemon, nothing comes back.
    const off = setup({ dispatch: daemon() });
    off.send('dev1', { type: 'models.list', tool: 'claude' });
    await flush();
    expect(off.dispatched).toEqual([]);
    expect(off.got('dev1')).toEqual([]);
  });

  it('models.list failure pushes error true', async () => {
    // The agent could not be asked: what Ledge knows, said in error. A daemon error, or no answer at all: none, in error.
    let n = 0;
    const g = setup({ deps: { models: true }, dispatch: daemon({ listing: m => [
      [{ type: 'models.listing', requestId: m.requestId, tool: m.tool, models: [{ id: 'opus', label: 'Opus' }], error: 'not signed in at /home/me' }] as ServerMessage[],
      [{ type: 'error', message: 'boom', request: 'models.list' }] as ServerMessage[],
      [] as ServerMessage[]
    ][n++]! }) });
    for (const tool of ['claude', 'codex', 'cursor']) { g.send('dev1', { type: 'models.list', tool }); await flush(); }
    expect(g.got('dev1')).toEqual([
      { type: 'models.listing', tool: 'claude', models: [{ id: 'opus', label: 'Opus' }], error: true },
      { type: 'models.listing', tool: 'codex', models: [], error: true },
      { type: 'models.listing', tool: 'cursor', models: [], error: true }
    ]);
    // A daemon that never answers: the phone is told once the wait is over.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slow = setup({ deps: { models: true }, dispatch: () => new Promise<void>(() => {}) });
      slow.send('dev1', { type: 'models.list', tool: 'claude' });
      await flush();
      expect(slow.got('dev1')).toEqual([]);
      vi.advanceTimersByTime(20_000);
      await flush();
      expect(slow.got('dev1')).toEqual([{ type: 'models.listing', tool: 'claude', models: [], error: true }]);
    } finally { vi.useRealTimers(); }
  });

  it('session.model on an exited session is rejected ended without reaching the daemon', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon() });
    g.sessions.set('x', mk('x', { state: 'exited' }));
    g.sessions.set('y', mk('y', { state: 'exited', source: 'hook_only' }));
    g.send('dev1', change('x'));
    g.send('dev1', change('y'));
    g.send('dev1', change('nope'));
    await flush();
    expect(finals(g)).toEqual([['rejected', 'ended'], ['rejected', 'ended'], ['rejected', 'unknown_session']]);
    expect(g.dispatched).toEqual([]);
  });

  it('session.model on a hook_only session is rejected not_launched', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon() });
    g.sessions.set('h', mk('h', { source: 'hook_only', state: 'idle' }));
    g.send('dev1', change('h'));
    await flush();
    expect(finals(g)).toEqual([['rejected', 'not_launched']]);
    expect(g.dispatched).toEqual([]);
  });

  it('session.model accepted turn → applied scheduled', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon({ answer: m => [{ type: 'session.model.accepted', id: m.id, when: 'turn' }] }) });
    const m = change('b', { model: null, effort: 'low' });
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toEqual([{ type: 'session.model', id: 'b', model: null, effort: 'low' }]);
    expect(g.results('dev1')).toEqual([
      { type: 'operation.result', op: m.op, status: 'received' },
      { type: 'operation.result', op: m.op, status: 'applied', reason: 'scheduled' }
    ]);
    for (const r of g.results('dev1')) expect(PhoneServerMessageSchema.safeParse(r).success).toBe(true);
  });

  it('accepted now → applied', async () => {
    const answers: ServerMessage[][] = [
      [{ type: 'session.model.accepted', id: 'b', when: 'now' }],
      [{ type: 'session.model.accepted', id: 'b', when: 'none' }],
      // A late failure that beat the answer to the socket: the change was accepted, the failure is the phone's session.model.failed.
      [{ type: 'error', id: 'b', message: 'could not restart', request: 'session.model', code: 'restart_failed' }, { type: 'session.model.accepted', id: 'b', when: 'now' }],
      // Another session's answer is not this one's.
      [{ type: 'session.model.accepted', id: 'a', when: 'now' }]
    ];
    const g = setup({ deps: { models: true }, dispatch: daemon({ answer: () => answers.shift()! }) });
    for (let i = 0; i < 4; i++) { g.send('dev1', change('b')); await flush(); }
    expect(finals(g)).toEqual([['applied', null], ['applied', null], ['applied', null], ['failed', null]]);
  });

  it('daemon refusal effort_in_model → rejected effort_in_model', async () => {
    const refusal = (code?: string): ServerMessage => ({ type: 'error', id: 'b', message: 'no', request: 'session.model', ...(code ? { code } : {}) });
    const answers: ServerMessage[][] = [[refusal('effort_in_model')], [refusal('no_conversation')], [refusal('busy')], [refusal('from_the_future')], [refusal()], [{ type: 'error', message: 'other', request: 'session.reply', code: 'busy' }], []];
    const g = setup({ deps: { models: true }, dispatch: daemon({ answer: () => answers.shift()! }) });
    for (let i = 0; i < 7; i++) { g.send('dev1', change('b')); await flush(); }
    expect(finals(g)).toEqual([['rejected', 'effort_in_model'], ['rejected', 'no_conversation'], ['rejected', 'busy'], ['failed', null], ['failed', null], ['failed', null], ['failed', null]]);
  });

  it('a late restart_failed reaches the phone as session.model.failed', async () => {
    const g = setup({ deps: { models: true } });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const before = g.got('dev1').length;
    g.gw.forward({ type: 'error', id: 'b', message: 'could not restart: SECRET', request: 'session.model', code: 'restart_failed' });
    // Not a model change's, or not a model refusal: nothing.
    g.gw.forward({ type: 'error', id: 'b', message: 'x', request: 'session.reply', code: 'restart_failed' });
    g.gw.forward({ type: 'error', id: 'b', message: 'x', request: 'session.model', code: 'busy' });
    g.gw.forward({ type: 'error', message: 'x', request: 'session.model', code: 'ended' });
    // A session the phone cannot see (unknown, or archived): nothing.
    g.gw.forward({ type: 'error', id: 'nope', message: 'x', request: 'session.model', code: 'restart_failed' });
    await flush();
    const after = g.got('dev1').slice(before);
    expect(after).toEqual([{ type: 'session.model.failed', id: 'b', reason: 'restart_failed' }]);
    expect(PhoneServerMessageSchema.safeParse(after[0]).success).toBe(true);
    expect(JSON.stringify(g.fm.sent)).not.toContain('SECRET');
    // A device that follows no session hears nothing.
    expect(g.got('dev2')).toEqual([]);
  });

  it('a late failure while no phone follows is replayed after the snapshot of the next subscribe', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon({ answer: m => [{ type: 'session.model.accepted', id: m.id, when: 'turn' }] }) });
    const fail = (id: string): ServerMessage => ({ type: 'error', id, message: 'could not restart', request: 'session.model', code: 'restart_failed' });
    // The phone locked: nobody follows the sessions when the change fails at the end of the turn.
    g.gw.forward(fail('b'));
    g.gw.forward(fail('c'));
    // A failure for a session the phone cannot see is neither pushed nor kept.
    g.gw.forward(fail('nope'));
    // The update that drops `modelNext` (model and effort unchanged) keeps it; `c` is removed and its failure goes with it.
    g.gw.forward({ type: 'session.updated', session: mk('b', { state: 'idle' }) });
    g.gw.forward({ type: 'session.removed', id: 'c' });
    g.sessions.delete('c');
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const got = g.got('dev1');
    expect(got[0]?.type).toBe('snapshot');
    expect(got.filter(m => m.type === 'session.model.failed')).toEqual([{ type: 'session.model.failed', id: 'b', reason: 'restart_failed' }]);
    expect(got.findIndex(m => m.type === 'session.model.failed')).toBeGreaterThan(0);
    // A new change accepted for the session: a later subscribe does not hear the old failure again.
    g.send('dev1', change('b'));
    await flush();
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev2').filter(m => m.type === 'session.model.failed')).toEqual([]);
  });

  it('a kept failure goes when the session\'s model or effort changes', async () => {
    const g = setup({ deps: { models: true } });
    const fail = (id: string): ServerMessage => ({ type: 'error', id, message: 'x', request: 'session.model', code: 'refused' });
    g.gw.forward(fail('b'));
    g.gw.forward(fail('c'));
    g.gw.forward({ type: 'session.updated', session: mk('b', { model: 'sonnet' }) });
    g.gw.forward({ type: 'session.updated', session: mk('c', { effort: 'low' }) });
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev1').filter(m => m.type === 'session.model.failed')).toEqual([]);
    // Archived: gone for the phone, and so is its failure.
    g.gw.forward(fail('a'));
    g.gw.forward({ type: 'session.updated', session: mk('a', { archivedAt: T1 }) });
    g.sessions.set('a', mk('a', { archivedAt: T1 }));
    g.send('dev2', { type: 'snapshot.request' });
    await flush();
    expect(g.got('dev2').filter(m => m.type === 'session.model.failed')).toEqual([]);
  });

  it('a replayed session.model op is not dispatched twice', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon({ answer: m => [{ type: 'session.model.accepted', id: m.id, when: 'turn' }] }) });
    const m = change('b');
    g.send('dev1', m);
    await flush();
    g.send('dev1', m);
    await flush();
    expect(g.dispatched).toHaveLength(1);
    expect(g.results('dev1').map(r => r.type === 'operation.result' && [r.status, r.reason ?? null])).toEqual([['received', null], ['applied', 'scheduled'], ['applied', 'scheduled']]);
    // The same op id for another model is a conflict, never a second restart.
    g.send('dev1', { ...m, model: 'sonnet' });
    await flush();
    expect(g.results('dev1').at(-1)).toEqual({ type: 'operation.result', op: m.op, status: 'rejected', reason: 'conflict' });
    expect(g.dispatched).toHaveLength(1);
  });

  it('an unparsable session.model gets operation.result rejected', async () => {
    const g = setup({ deps: { models: true }, dispatch: daemon() });
    const m = change('b', { model: '-rf' });
    g.send('dev1', m);
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'operation.result', op: m.op, status: 'rejected', reason: 'invalid' }]);
    expect(g.dispatched).toEqual([]);
  });
});

describe('phone gateway: a session closed or resumed from its page', () => {
  const rp = { rpId: 'relay.test', origin: 'https://relay.test' };
  /** A gateway whose daemon closes as `close` says (by default: the session ends by its exit command) and resumes as `resume` answers. */
  function make(o: { close?: (id: string) => Promise<{ how: 'exit' | 'killed' }>; resume?: (reply: (m: ServerMessage) => void) => void; closeSession?: false } = {}) {
    const closed: string[] = [];
    let g!: ReturnType<typeof setup>;
    const close = o.close ?? (async (id: string) => { g.sessions.set(id, { ...g.sessions.get(id)!, state: 'exited', exitedAt: T1 }); return { how: 'exit' as const }; });
    g = setup({
      relayUrl: 'https://relay.test',
      dispatch: async (msg, reply) => { if (msg.type === 'session.resume') o.resume?.(reply); },
      deps: o.closeSession === false ? {} : { closeSession: async id => { closed.push(id); return close(id); } }
    });
    return { g, closed };
  }
  type G = ReturnType<typeof setup>;
  const enroll = async (g: G) => {
    const auth = softAuthenticator();
    g.send('dev1', { type: 'confirm.prepare', purpose: 'register' });
    await flush();
    const reg = g.got('dev1').find(m => m.type === 'confirm.challenge');
    if (reg?.type !== 'confirm.challenge') throw new Error('no challenge');
    g.send('dev1', { type: 'credential.register', op: randomUUID(), credential: auth.create(rp, reg.challenge) });
    await flush();
    return auth;
  };
  const prepare = async (g: G, req: object) => {
    const before = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', ...req });
    await flush();
    const m = g.got('dev1').slice(before).find(x => x.type === 'confirm.challenge');
    if (m?.type !== 'confirm.challenge') throw new Error('no challenge');
    return m;
  };
  const last = (g: G) => g.results('dev1').at(-1);
  let counter = 0;
  /** The device's check of `id`'s close (or resume), and the operation it signs. */
  const signed = async (g: G, auth: ReturnType<typeof softAuthenticator>, type: 'session.close' | 'session.resume', id: string) => {
    const ch = await prepare(g, { purpose: type === 'session.close' ? 'close' : 'act', id });
    return { type, op: randomUUID(), id, assertion: auth.get(rp, ch.challenge, { counter: ++counter }) };
  };

  it('says it takes them in the snapshot, with each session read-only or not and when it ended', async () => {
    const on = make();
    on.g.sessions.set('h', mk('h', { source: 'hook_only', tmuxSession: null }));
    on.g.sessions.set('x', mk('x', { state: 'exited', exitedAt: T1 }));
    const off = make({ closeSession: false });
    for (const { g } of [on, off]) g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = PhoneServerMessageSchema.parse(on.g.got('dev1')[0]);
    if (snap.type !== 'snapshot') throw new Error('no snapshot');
    expect(snap.daemon.sessionClose).toBe(true);
    expect(snap.sessions.find(s => s.id === 'h')).toMatchObject({ readOnly: true });
    expect(snap.sessions.find(s => s.id === 'x')).toMatchObject({ state: 'exited', exitedAt: T1 });
    expect(snap.sessions.find(s => s.id === 'a')).not.toHaveProperty('readOnly');
    const old = off.g.got('dev1')[0];
    expect(old?.type === 'snapshot' && old.daemon).not.toHaveProperty('sessionClose');
  });

  it('closes the session after the passkey check and says how; a retry of the same op gets the same answer', async () => {
    counter = 0;
    const { g, closed } = make({ close: async () => ({ how: 'killed' }) });
    const auth = await enroll(g);
    const m = await signed(g, auth, 'session.close', 'c');
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied', how: 'killed' });
    expect(closed).toEqual(['c']);
    g.send('dev1', m);
    await flush();
    expect(last(g)).toEqual({ type: 'operation.result', op: m.op, status: 'applied', how: 'killed' });
    expect(closed).toEqual(['c']);
    // The challenge is spent: the same assertion under a new op is refused.
    g.send('dev1', { ...m, op: randomUUID() });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(closed).toEqual(['c']);
  });

  it('refuses before the challenge is spent: an unknown, a read-only or an ended session, and a phone without a passkey or an assertion', async () => {
    counter = 0;
    const { g, closed } = make();
    g.send('dev1', { type: 'session.close', op: randomUUID(), id: 'a' });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const auth = await enroll(g);
    g.send('dev1', { type: 'session.close', op: randomUUID(), id: 'a' });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'confirm_required' });
    const ch = await prepare(g, { purpose: 'close', id: 'a' });
    g.sessions.set('h', mk('h', { source: 'hook_only', tmuxSession: null }));
    g.sessions.set('x', mk('x', { state: 'exited' }));
    for (const id of ['nope', 'h', 'x']) g.send('dev1', { type: 'session.close', op: randomUUID(), id, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').slice(-3).map(r => r.reason)).toEqual(['unknown_session', 'read_only', 'ended']);
    // The challenge still stands for the session it was asked for.
    g.send('dev1', { type: 'session.close', op: randomUUID(), id: 'a', assertion: auth.get(rp, ch.challenge, { counter: 2 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'applied', how: 'exit' });
    expect(closed).toEqual(['a']);
  });

  it("a challenge stands for its own session and purpose only: not another session's close, a resume, nor a card's close", async () => {
    counter = 0;
    const { g, closed } = make();
    const auth = await enroll(g);
    const forA = await prepare(g, { purpose: 'close', id: 'a' });
    g.send('dev1', { type: 'session.close', op: randomUUID(), id: 'b', assertion: auth.get(rp, forA.challenge, { counter: 1 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    g.sessions.set('x', mk('x', { state: 'exited' }));
    const closeX = await prepare(g, { purpose: 'close', id: 'x' });
    g.send('dev1', { type: 'session.resume', op: randomUUID(), id: 'x', assertion: auth.get(rp, closeX.challenge, { counter: 2 }) });
    await flush();
    expect(last(g)).toMatchObject({ status: 'rejected', reason: 'assertion_invalid' });
    expect(closed).toEqual([]);
    expect(g.dispatched).toEqual([]);
  });

  it('reads a refusal of the daemon by its code, a close that ended meanwhile as ended, and anything else as failed', async () => {
    counter = 0;
    const cases: Array<[(g: G) => (id: string) => Promise<{ how: 'exit' | 'killed' }>, string, string | undefined]> = [
      [() => async () => { throw Object.assign(new Error('a close is already in progress'), { code: 'busy' }); }, 'rejected', 'busy'],
      [g => async id => { g.sessions.set(id, { ...g.sessions.get(id)!, state: 'exited' }); throw Object.assign(new Error('the session has already exited'), { code: 'busy' }); }, 'rejected', 'ended'],
      [() => async () => { throw new Error('tmux is gone'); }, 'failed', undefined]
    ];
    for (const [close, status, reason] of cases) {
      let g!: G;
      ({ g } = make({ close: id => close(g)(id) }));
      const auth = await enroll(g);
      g.send('dev1', await signed(g, auth, 'session.close', 'c'));
      await flush();
      expect(last(g)).toEqual({ type: 'operation.result', op: expect.any(String), status, ...(reason ? { reason } : {}) });
    }
  });

  it('resumes an ended session after the passkey check, through the local session.resume', async () => {
    counter = 0;
    const answers: Array<[((reply: (m: ServerMessage) => void) => void) | undefined, object]> = [
      [undefined, { status: 'applied' }],
      [reply => reply({ type: 'error', id: 'x', message: 'no conversation to resume', request: 'session.resume', code: 'no_conversation' }), { status: 'rejected', reason: 'no_conversation' }],
      [reply => reply({ type: 'error', id: 'x', message: 'spawn failed', request: 'session.resume' }), { status: 'failed' }]
    ];
    for (const [resume, outcome] of answers) {
      const { g } = make(resume ? { resume } : {});
      g.sessions.set('x', mk('x', { state: 'exited', exitedAt: T1 }));
      const auth = await enroll(g);
      g.send('dev1', await signed(g, auth, 'session.resume', 'x'));
      await flush();
      expect(last(g)).toMatchObject(outcome);
      expect(g.dispatched).toEqual([{ type: 'session.resume', id: 'x' }]);
    }
  });

  it('refuses to resume a session still running or read-only, before the challenge is spent', async () => {
    counter = 0;
    const { g } = make();
    g.sessions.set('h', mk('h', { source: 'hook_only', tmuxSession: null, state: 'exited' }));
    const auth = await enroll(g);
    const ch = await prepare(g, { purpose: 'act', id: 'a' });
    for (const id of ['a', 'h']) g.send('dev1', { type: 'session.resume', op: randomUUID(), id, assertion: auth.get(rp, ch.challenge, { counter: 1 }) });
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['busy', 'read_only']);
    expect(g.dispatched).toEqual([]);
  });

  it('prepares a challenge over a session only for a daemon that closes from the phone, and for a session it knows', async () => {
    const off = make({ closeSession: false }).g;
    await enroll(off);
    const before = off.got('dev1').length;
    off.send('dev1', { type: 'confirm.prepare', purpose: 'close', id: 'a' });
    await flush();
    expect(off.got('dev1').slice(before)).toEqual([{ type: 'error', code: 'invalid', request: 'confirm.prepare' }]);
    const { g } = make();
    await enroll(g);
    const at = g.got('dev1').length;
    g.send('dev1', { type: 'confirm.prepare', purpose: 'act', id: 'nope' });
    await flush();
    expect(g.got('dev1').slice(at)).toEqual([{ type: 'error', code: 'unknown_session', request: 'confirm.prepare' }]);
    expect(await prepare(g, { purpose: 'act', id: 'a' })).toMatchObject({ purpose: 'act', rpId: 'relay.test' });
  });

  it('answers a session.close the schema refuses with rejected', async () => {
    const { g, closed } = make();
    const op = randomUUID();
    g.send('dev1', { type: 'session.close', op, id: '' });
    await flush();
    expect(g.got('dev1')).toEqual([{ type: 'operation.result', op, status: 'rejected', reason: 'invalid' }]);
    expect(closed).toEqual([]);
  });
});

describe('phone gateway: a message to a group of sessions', () => {
  /** The daemon's side for real: `broadcastFromUser` over a real Store and the real mailbox, which types into a fake tmux. */
  function make() {
    const typed: Array<[string, string]> = [];
    const seen = new Map<string, Extract<ServerMessage, { type: 'session.broadcast.result' }>>();
    const store = new Store();
    const mailbox = createMailbox({ store, typing: new Set(), sent: { record() {}, mark() {} },
      replyTo: async (id, text) => { const s = store.get(id); if (!s?.tmuxSession) return 'no terminal'; typed.push([id, text]); return null; } });
    let g!: ReturnType<typeof setup>;
    g = setup({
      dispatch: async (msg, reply) => {
        if (msg.type !== 'session.broadcast') return;
        reply(broadcastFromUser({ store, projects: { projects: [], rules: [] }, seen, mailbox }, msg));
      }
    });
    // The daemon's sessions are the gateway's: idle ones are typed into at once.
    const put = (s: Session) => { g.sessions.set(s.id, s); store.upsert(s); };
    for (const s of [...g.sessions.values()]) put({ ...s, state: 'idle', pending: undefined });
    return { g, typed, put, store };
  }

  it('announces it in the snapshot', async () => {
    const { g } = make();
    g.send('dev1', { type: 'snapshot.request' });
    await flush();
    const snap = PhoneServerMessageSchema.parse(g.got('dev1')[0]);
    expect(snap.type === 'snapshot' && snap.daemon.broadcast).toBe(true);
  });

  it('a busy recipient gets it at its next free moment, through the real mailbox', async () => {
    const { g, typed, put, store } = make();
    put({ ...store.get('b')!, state: 'working' });
    const op = randomUUID();
    g.send('dev1', { type: 'session.broadcast', op, sessions: ['a', 'b'], text: 'Salut' });
    await until(() => typed.length === 1);
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'applied', sent: ['a', 'b'] });
    expect(typed).toEqual([['a', "Message de l'utilisateur (à a, b) : Salut"]]);
    put({ ...store.get('b')!, state: 'idle' });
    await until(() => typed.length === 2);
    expect(typed[1]).toEqual(['b', "Message de l'utilisateur (à a, b) : Salut"]);
  });

  it('a name longer than the phone takes is clipped, so the answer is not dropped', async () => {
    const { g, put, store } = make();
    put({ ...store.get('a')!, name: 'n'.repeat(140) });
    const op = randomUUID();
    g.send('dev1', { type: 'session.broadcast', op, sessions: ['a'], text: 'Salut' });
    await flush();
    const out = g.results('dev1').at(-1);
    expect(out).toMatchObject({ op, status: 'applied', sent: ['n'.repeat(100)] });
    expect(PhoneServerMessageSchema.safeParse(out).success).toBe(true);
  });

  it('hands the ids to the daemon as a broadcast to sessions and answers with who got it and who did not', async () => {
    const { g, typed, put } = make();
    put(mk('x', { state: 'exited' }));
    const op = randomUUID();
    g.send('dev1', { type: 'session.broadcast', op, sessions: ['a', 'b', 'x', 'nope'], text: 'Pause café' });
    await flush();
    expect(g.dispatched[0]).toMatchObject({ type: 'session.broadcast', rid: op, to: { sessions: ['a', 'b', 'x', 'nope'] }, text: 'Pause café' });
    await until(() => typed.length === 2);
    expect(typed.map(([id]) => id)).toEqual(['a', 'b']);
    const out = g.results('dev1').at(-1);
    expect(out).toMatchObject({ type: 'operation.result', op, status: 'applied', sent: ['a', 'b'] });
    expect(out).toMatchObject({ refused: [{ name: 'x' }, { name: 'nope' }] });
  });

  it('a retry of the same operation gets the same report and types nothing again', async () => {
    const { g, typed } = make();
    const m = { type: 'session.broadcast' as const, op: randomUUID(), sessions: ['a'], text: 'Salut' };
    g.send('dev1', m); await until(() => typed.length === 1);
    g.send('dev1', m); await flush(); await new Promise(r => setTimeout(r, 50));
    expect(typed).toHaveLength(1);
    expect(g.results('dev1').at(-1)).toMatchObject({ status: 'applied', sent: ['a'] });
  });

  it('nobody reached: the operation is failed with the refusals still reported', async () => {
    const { g, put, store } = make();
    put({ ...store.get('a')!, state: 'exited' });
    const op = randomUUID();
    g.send('dev1', { type: 'session.broadcast', op, sessions: ['a'], text: 'Salut' });
    await flush();
    expect(g.results('dev1').at(-1)).toMatchObject({ op, status: 'failed', sent: [], refused: [{ name: 'a' }] });
  });

  it('refuses a broadcast with an extra field, an empty list, an empty text or more than 32 sessions', async () => {
    const { g } = make();
    for (const bad of [{ extra: 1 }, { sessions: [] }, { text: '  ' }, { sessions: Array.from({ length: 33 }, (_, i) => `s${i}`) }]) {
      g.send('dev1', { type: 'session.broadcast', op: randomUUID(), sessions: ['a'], text: 'x', ...bad } as never);
    }
    await flush();
    expect(g.results('dev1').filter(r => r.status === 'rejected').map(r => r.reason)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    expect(g.dispatched).toEqual([]);
  });
});
