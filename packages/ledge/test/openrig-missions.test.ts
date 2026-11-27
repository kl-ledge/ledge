import { describe, it, expect } from 'vitest';
import { OpenRigMissionsChangedSchema, parseClientMessage, type OpenRigState } from '@ledge/protocol';
import { createMissions, holderNotes, isSystemNote, messagesOf, messageText, rowExchanges } from '../src/daemon/openrigMissions.js';
import type { RigHttp } from '../src/daemon/openrigHuman.js';

const MAX = 'operator-agent@kernel', LEAD = 'pilot-lead@ledge-dev', BACK = 'dev-back@ledge-dev', FRONT = 'dev-front@ledge-dev', QA = 'review-qa@ledge-dev';
const node = (logicalId: string, session: string) => ({ logicalId, session, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 });
const rig = (name: string, nodes: ReturnType<typeof node>[]) => ({ id: name, name, status: 'running', lifecycleState: 'running', seats: nodes.length, running: nodes.length, attention: 0, uptime: null, snapshot: null, nodes });
const RUNNING: OpenRigState = { installed: true, daemon: { state: 'running', port: 7433 }, kernel: { state: 'ready' }, at: '',
  rigs: [rig('kernel', [node('operator.agent', MAX)]), rig('ledge-dev', [node('pilot.lead', LEAD), node('dev.back', BACK), node('dev.front', FRONT), node('review.qa', QA)])] };
const BASE = 'http://127.0.0.1:7433';
const NOW = Date.parse('2026-11-27T20:00:00.000Z');
const t = (hhmm: string) => `2026-11-27T${hhmm}:00.000Z`;

type Row = Record<string, unknown> & { qitemId: string };
const row = (qitemId: string, from: string, to: string, state: string, created: string, extra: Record<string, unknown> = {}): Row =>
  ({ qitemId, sourceSession: from, destinationSession: to, state, summary: `titre ${qitemId}`, body: '', tsCreated: t(created), tsUpdated: t(created), ...extra });
const step = (state: string, at: string, actor: string, note: string, extra: Record<string, unknown> = {}) => ({ state, ts: t(at), actorSession: actor, transitionNote: note, ...extra });
const msg = (id: string, from: string, to: string, at: string, text: string, extra: Record<string, unknown> = {}) => ({
  outboxId: id, senderSession: from, destinationSession: to, tsDispatched: `2026-11-27T${at}.000Z`, deliveryState: 'delivered', urgency: 'routine', auditPointer: null,
  body: `From: ${from}\nTo: ${to}\nSent: 11-27 ${at.slice(0, 5)}Z\n---\n${text}\n---\n↩ Reply: rig send ${from} "..."`, ...extra
});

/** OpenRig's queue routes over rows, journals and an outbox, as the daemon answers them (only the filters Ledge uses). */
function fakeRig(o: { rows: Row[]; steps?: Record<string, unknown[]>; outbox?: Record<string, unknown>[]; fail?: (path: string) => boolean }): { http: RigHttp; calls: string[] } {
  const calls: string[] = [];
  const http: RigHttp = async (_m, url) => {
    const u = new URL(url), path = u.pathname, q = u.searchParams;
    calls.push(`${path}${u.search}`);
    if (o.fail?.(`${path}${u.search}`)) return { status: 503, json: {} };
    const limit = Number(q.get('limit') ?? 100);
    if (path === '/api/queue/outbox/list') {
      const r = q.get('rig');
      const l = (o.outbox ?? []).filter(e => [e.senderSession, e.destinationSession].some(s => String(s).split('@')[1] === r))
        .sort((a, b) => String(b.tsDispatched).localeCompare(String(a.tsDispatched)));
      return { status: 200, json: l.slice(0, limit) };
    }
    if (path === '/api/queue/list') {
      let l = o.rows;
      const states = q.get('state')?.split(',');
      if (states) l = l.filter(r => states.includes(String(r.state)));
      for (const k of ['sourceSession', 'destinationSession', 'handedOffFrom'] as const) { const v = q.get(k); if (v) l = l.filter(r => r[k] === v); }
      const since = q.get('updatedSince');
      if (since) l = l.filter(r => String(r.tsUpdated) >= since);
      return { status: 200, json: l.slice(0, limit) };
    }
    const m = /^\/api\/queue\/([^/]+)(\/transitions)?$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]!);
      if (m[2]) return { status: 200, json: o.steps?.[id] ?? [] };
      const r = o.rows.find(x => x.qitemId === id);
      return r ? { status: 200, json: r } : { status: 404, json: { error: 'not_found' } };
    }
    return { status: 404, json: {} };
  };
  return { http, calls };
}
const missionsOf = (rigOpts: Parameters<typeof fakeRig>[0], state: OpenRigState = RUNNING) => {
  const f = fakeRig(rigOpts);
  return { ...f, m: createMissions({ state: async () => state, http: f.http, now: () => NOW }) };
};

describe('#54: a message without its envelope', () => {
  it('takes off the envelope OpenRig writes today, urgent or not; keeps a body that does not read so whole', () => {
    expect(messageText('From: a@r\nTo: b@r\nSent: 11-27 19:39Z\n---\nMerci.\nDeux lignes.\n---\n↩ Reply: rig send a@r "..."'))
      .toEqual({ text: 'Merci.\nDeux lignes.', urgent: false, enveloped: true });
    expect(messageText('Urgent (marked by a@r):\nFrom: a@r\nTo: b@r\nSent: 11-27 19:24Z · gen 0ab80ff1\n---\nQueue handoff: qitem-1 - check your queue.\n---\n↩ Reply: rig send a@r "..."'))
      .toEqual({ text: 'Queue handoff: qitem-1 - check your queue.', urgent: true, enveloped: true });
    // Without a foot, or a raw send (`rig send --raw`): nothing is cut on a guess.
    expect(messageText('From: a@r\nTo: b@r\nSent: x\n---\nsans pied')).toMatchObject({ text: 'sans pied', enveloped: true });
    expect(messageText('texte brut\n---\nautre')).toEqual({ text: 'texte brut\n---\nautre', urgent: false, enveloped: false });
  });

  it('the queue\'s own notes are not a holder\'s', () => {
    for (const n of ['created', 'claimed', 'auto-unparked: blocker qitem-1 reached terminal state \'done\'', 'blocker qitem-1 wake attempted; delivery=delivered', 'blocker custody moved from a to b'])
      expect(isSystemNote(n)).toBe(true);
    expect(isSystemNote('2a acceptée, attend la 2b')).toBe(false);
    const r = row('q', MAX, LEAD, 'blocked', '16:00');
    expect(holderNotes(r, [step('pending', '16:00', MAX, 'created'), step('blocked', '16:05', LEAD, 'Attend la PR 1'), step('pending', '16:10', BACK, 'auto-unparked: blocker x'), step('blocked', '16:11', MAX, 'note de Max')]))
      .toEqual([{ at: t('16:05'), by: LEAD, text: 'Attend la PR 1' }]);
  });
});

describe('#54: messages and the queue\'s wakes', () => {
  it('a send to several seats is one entry, delivered only when every one is; a wake is not a message, its delivery goes to its row', () => {
    const { messages, wakes } = messagesOf([
      msg('o1', LEAD, BACK, '17:00:00', 'Rebase, tout le monde.'),
      msg('o2', LEAD, FRONT, '17:00:01', 'Rebase, tout le monde.', { deliveryState: 'indeterminate' }),
      msg('o3', LEAD, BACK, '17:05:00', 'Rebase, tout le monde.'),
      msg('o4', BACK, LEAD, '17:01:00', 'Fait.', { urgency: 'urgent' }),
      { ...msg('wake-intent-qitem-9', LEAD, QA, '17:02:00', 'Queue handoff: qitem-9 - check your queue.', { deliveryState: 'failed' }), auditPointer: 'qitem-9' }
    ]);
    expect(messages.map(m => [m.id, m.from, m.to, m.delivery, m.text, m.urgent ?? false])).toEqual([
      ['m:o1', LEAD, [BACK, FRONT], 'indeterminate', 'Rebase, tout le monde.', false],
      ['m:o4', BACK, [LEAD], 'delivered', 'Fait.', true],
      // The same words five minutes later: another send.
      ['m:o3', LEAD, [BACK], 'delivered', 'Rebase, tout le monde.', false]
    ]);
    expect(messages[0]!.rigs).toEqual(['ledge-dev']);
    expect([...wakes]).toEqual([['qitem-9', 'failed']]);
  });

  it('an unknown delivery state is not a delivery', () => {
    expect(messagesOf([msg('o1', LEAD, BACK, '17:00:00', 'x', { deliveryState: 'weird' })]).messages[0]!.delivery).toBe('indeterminate');
  });
});

describe('#54: a row\'s entries', () => {
  it('given, each block (who it waits on for the block in force only), its end; a successor is « handed », with its wake', () => {
    const blocker = row('qb', LEAD, QA, 'in-progress', '17:00');
    const r = row('q1', LEAD, BACK, 'blocked', '16:00', { blockedOn: 'qb' });
    const steps = [step('pending', '16:00', LEAD, 'created'), step('in-progress', '16:01', BACK, 'claimed'), step('blocked', '16:10', BACK, 'attend', { transitionId: 1 }),
      step('in-progress', '16:20', BACK, 'reprend'), step('blocked', '17:05', BACK, 'attend la revue', { transitionId: 2 })];
    const out = rowExchanges(r, steps, new Map([['qb', blocker]]), new Map([['q1', 'delivered']]));
    expect(out.map(e => [e.kind, e.from, e.to, e.at, e.delivery])).toEqual([
      ['given', LEAD, [BACK], t('16:00'), 'delivered'],
      ['blocked', BACK, [], t('16:10'), undefined],
      ['blocked', BACK, [QA], t('17:05'), undefined]
    ]);
    const h = rowExchanges(row('q2', BACK, QA, 'done', '17:00', { handedOffFrom: 'q1' }), [step('pending', '17:00', BACK, 'created'), step('done', '17:30', QA, 'ok')], new Map(), new Map());
    expect(h.map(e => [e.kind, e.from, e.to, e.outcome])).toEqual([['handed', BACK, [QA], undefined], ['done', QA, [], 'done']]);
  });

  it('a close « handed_off_to » a seat with no new row is an end; one handed on to a new row is not', () => {
    const back = rowExchanges(row('q', LEAD, BACK, 'done', '16:00', { closureReason: 'handed_off_to', closureTarget: LEAD }),
      [step('pending', '16:00', LEAD, 'created'), step('done', '16:30', BACK, 'rendu', { closureReason: 'handed_off_to' })], new Map(), new Map());
    expect(back.map(e => e.kind)).toEqual(['given', 'done']);
    const on = rowExchanges(row('q', LEAD, BACK, 'handed-off', '16:00', { handedOffTo: QA }),
      [step('pending', '16:00', LEAD, 'created'), step('handed-off', '16:30', BACK, 'handoff')], new Map(), new Map());
    expect(on.map(e => e.kind)).toEqual(['given']);
  });
});

describe('#54: what OpenRig says when there is nothing to read', () => {
  it('no OpenRig, OpenRig stopped or unreachable: nothing, and why', async () => {
    const f = fakeRig({ rows: [] });
    for (const [state, openrig] of [[{ ...RUNNING, installed: false }, 'absent'], [{ ...RUNNING, daemon: { state: 'stopped' } }, 'stopped'], [{ ...RUNNING, daemon: { state: 'unknown' } }, 'unreachable']] as const) {
      expect(await createMissions({ state: async () => state as OpenRigState, http: f.http }).list())
        .toEqual({ openrig, operator: null, missions: [], exchanges: [], exchangesMore: false });
    }
    expect(f.calls).toEqual([]);
  });

  it('OpenRig with nothing in it: empty, whole', async () => {
    const r = await missionsOf({ rows: [] }).m.list();
    expect(r).toMatchObject({ openrig: 'ok', operator: MAX, missions: [], exchanges: [] });
    expect(r.partial).toBeUndefined();
    expect(() => OpenRigMissionsChangedSchema.parse({ type: 'openrig.missionsChanged', ...r })).not.toThrow();
  });

  it('no operator seat: no missions, the exchanges still', async () => {
    const r = await missionsOf({ rows: [row('q1', LEAD, BACK, 'pending', '19:00')], steps: { q1: [step('pending', '19:00', LEAD, 'created')] } },
      { ...RUNNING, rigs: RUNNING.rigs.filter(x => x.name !== 'kernel') }).m.list();
    expect(r.operator).toBeNull();
    expect(r.missions).toEqual([]);
    expect(r.exchanges.map(e => e.kind)).toEqual(['given']);
  });
});

describe('#54: missions', () => {
  // Max gives #40 to the lead at 16:00 (blocked on q-2b); #44 at 18:00. The lead creates q-a (16:30, only #40 held), q-b (18:30, both held),
  // q-2b (18:40, both held, but #40 waits on it), q-c (18:50, both held, cited in a #40 note), q-old (15:00, before), and q-done (16:40, ended).
  const m40 = row('m40', MAX, LEAD, 'blocked', '16:00', { blockedOn: 'q-2b', summary: 'Commencer #40', tsUpdated: t('19:00') });
  const m44 = row('m44', MAX, LEAD, 'in-progress', '18:00', { summary: '#44', tsUpdated: t('18:01') });
  const rows: Row[] = [
    m40, m44,
    row('q-a', LEAD, BACK, 'in-progress', '16:30', { summary: 'PR 4, back', tsUpdated: t('16:31') }),
    row('q-b', LEAD, FRONT, 'pending', '18:30'),
    row('q-2b', LEAD, FRONT, 'handed-off', '18:40', { summary: 'PR 2b, téléphone', handedOffTo: QA, tsUpdated: t('18:45') }),
    row('q-2b-qa', FRONT, QA, 'in-progress', '18:45', { handedOffFrom: 'q-2b', summary: 'Revue 2b', tsUpdated: t('18:46') }),
    row('q-c', LEAD, BACK, 'pending', '18:50', { summary: 'PR 3, TUI' }),
    row('q-old', LEAD, BACK, 'done', '15:00', { tsUpdated: t('16:20') }),
    row('q-done', LEAD, QA, 'done', '16:40', { summary: 'Inventaire', tsUpdated: t('17:00') }),
    row('q-ask', LEAD, 'ledge@external', 'pending', '16:50', { humanIntent: 'ask' })
  ];
  const steps = {
    m40: [step('pending', '16:00', MAX, 'created'), step('in-progress', '16:01', LEAD, 'claimed'), step('blocked', '16:35', LEAD, 'PR 4 chez dev-back.'),
      step('pending', '17:00', QA, 'auto-unparked: blocker q-done reached terminal state \'done\''), step('blocked', '19:00', LEAD, 'Attend la 2b ; la TUI est qitem-20261127185000-0000c0de.')],
    m44: [step('pending', '18:00', MAX, 'created'), step('in-progress', '18:01', LEAD, 'claimed')],
    'q-2b-qa': [step('pending', '18:45', FRONT, 'created'), step('in-progress', '18:46', QA, 'claimed')]
  };
  // The cited id, as OpenRig writes ids.
  const cited = row('qitem-20261127185000-0000c0de', LEAD, BACK, 'pending', '18:50', { summary: 'PR 3, TUI' });

  it('each open mission: state and since, title, who to whom, what it waits on, the holder\'s last note, the rows attached only when sure', async () => {
    const { m } = missionsOf({ rows: [...rows.filter(r => r.qitemId !== 'q-c'), cited], steps });
    const r = await m.list();
    expect(r.partial).toBeUndefined();
    expect(r.missions.map(x => x.qitemId)).toEqual(['m40', 'm44']);
    const x = r.missions[0]!;
    expect(x).toMatchObject({
      qitemId: 'm40', rootQitemId: 'm40', rig: 'ledge-dev', state: 'blocked', since: t('19:00'), title: 'Commencer #40', from: MAX, to: LEAD,
      waitsOn: { kind: 'row', qitemId: 'q-2b', title: 'PR 2b, téléphone', holder: FRONT, state: 'handed-off' },
      lastNote: { at: t('19:00'), by: LEAD, text: 'Attend la 2b ; la TUI est qitem-20261127185000-0000c0de.' }
    });
    // q-a (only #40 held), q-2b (waited on: shown where it is now, at QA), the cited row; q-b (two missions held) is not shown.
    expect(x.children.map(c => [c.qitemId, c.holder, c.by, c.title])).toEqual([
      ['q-a', BACK, 'created', 'PR 4, back'],
      ['q-2b-qa', QA, 'blocked_on', 'PR 2b, téléphone'],
      ['qitem-20261127185000-0000c0de', BACK, 'cited', 'PR 3, TUI']
    ]);
    expect(x.closed).toEqual({ count: 1, titles: ['Inventaire'] });
    // #44: no note, nothing attached by time (the lead holds #40 too), nothing waited on.
    expect(r.missions[1]).toMatchObject({ qitemId: 'm44', state: 'in-progress', since: t('18:01'), waitsOn: null, lastNote: null, children: [], closed: { count: 0, titles: [] } });
  });

  it('a mission handed on: the open row at the end, its root the operator\'s row; a block outside OpenRig says what it waits on', async () => {
    const root = row('r1', MAX, LEAD, 'handed-off', '17:00', { handedOffTo: BACK, tsUpdated: t('17:10') });
    const now = row('r2', LEAD, BACK, 'blocked', '17:10', { handedOffFrom: 'r1', blockedOn: 'external:réponse de l\'utilisateur', tsUpdated: t('17:20') });
    const r = await missionsOf({ rows: [root, now], steps: { r2: [step('pending', '17:10', LEAD, 'created'), step('blocked', '17:20', BACK, 'claimed')] } }).m.list();
    expect(r.missions).toHaveLength(1);
    expect(r.missions[0]).toMatchObject({ qitemId: 'r2', rootQitemId: 'r1', from: LEAD, to: BACK, state: 'blocked', since: t('17:20'),
      waitsOn: { kind: 'external', text: 'réponse de l\'utilisateur' }, lastNote: null });
  });

  it('neither a row to a person, nor one inside the kernel, nor a seat\'s own row is a mission', async () => {
    const r = await missionsOf({ rows: [
      row('p', MAX, 'ledge@external', 'pending', '17:00'), row('k', MAX, 'advisor-agent@kernel', 'pending', '17:00'), row('s', LEAD, BACK, 'pending', '17:00')
    ] }).m.list();
    expect(r.missions).toEqual([]);
  });

  it('a read that fails is said: a journal, a row waited on', async () => {
    // m40 waits on a row OpenRig does not give back, and its journal does not read.
    const gone = rows.map(r => (r.qitemId === 'm40' ? { ...r, blockedOn: 'q-gone' } : r));
    const r = await missionsOf({ rows: gone, steps, fail: p => p === '/api/queue/m40/transitions' }).m.list();
    expect(r.partial).toBe(true);
    const x = r.missions.find(m => m.qitemId === 'm40')!;
    expect(x.partial).toBe(true);
    expect(x.waitsOn).toEqual({ kind: 'row', qitemId: 'q-gone', title: null, holder: null, state: null });
    expect(x.lastNote).toBeNull();
  });
});

describe('#54: exchanges', () => {
  it('messages and rows together, the most recent first, cut at what is asked; rows to or from a person are « Demandes », not here', async () => {
    const r = await missionsOf({
      rows: [row('q1', LEAD, BACK, 'done', '19:00', { tsUpdated: t('19:30') }), row('q-ask', LEAD, 'ledge@external', 'pending', '19:10', { humanIntent: 'ask' })],
      steps: { q1: [step('pending', '19:00', LEAD, 'created'), step('done', '19:30', BACK, 'fini')] },
      outbox: [msg('o1', BACK, LEAD, '19:20:00', 'Tests verts.'), msg('o2', LEAD, BACK, '19:40:00', 'Merci.')]
    }).m.list(3);
    expect(r.exchanges.map(e => [e.kind, e.at.slice(11, 16), e.text])).toEqual([['message', '19:40', 'Merci.'], ['done', '19:30', 'titre q1'], ['message', '19:20', 'Tests verts.']]);
    expect(r.exchangesMore).toBe(true);
    expect(r.partial).toBeUndefined();
  });

  it('a message list cut by its limit means older ones exist, not a failed read; nothing older than its oldest entry is shown', async () => {
    const outbox = Array.from({ length: 120 }, (_, i) => msg(`o${i}`, LEAD, BACK, `19:${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, `m${i}`));
    const r = await missionsOf({ rows: [row('q-early', LEAD, BACK, 'pending', '18:00')], steps: { 'q-early': [step('pending', '18:00', LEAD, 'created')] }, outbox }).m.list(50);
    expect(r.partial).toBeUndefined();
    expect(r.exchangesMore).toBe(true);
    expect(r.exchanges).toHaveLength(50);
    expect(r.exchanges.every(e => e.kind === 'message')).toBe(true);
  });

  it('a row\'s journal is read again only when the row changed', async () => {
    const q1 = row('q1', LEAD, BACK, 'pending', '19:00');
    const { m, calls } = missionsOf({ rows: [q1], steps: { q1: [step('pending', '19:00', LEAD, 'created')] } });
    await m.list(); await m.list();
    expect(calls.filter(c => c.startsWith('/api/queue/q1/transitions'))).toHaveLength(1);
    q1.tsUpdated = t('19:05');
    await m.list();
    expect(calls.filter(c => c.startsWith('/api/queue/q1/transitions'))).toHaveLength(2);
  });

  it('a failed message read is partial', async () => {
    const r = await missionsOf({ rows: [], fail: p => p.startsWith('/api/queue/outbox/list') }).m.list();
    expect(r.partial).toBe(true);
  });
});

describe('#54: the protocol', () => {
  it('openrig.missions takes how many exchanges, within bounds', () => {
    expect(parseClientMessage({ type: 'openrig.missions', requestId: 'r1' })).toMatchObject({ type: 'openrig.missions' });
    expect(parseClientMessage({ type: 'openrig.missions', requestId: 'r1', exchanges: 100 })).toMatchObject({ exchanges: 100 });
    expect(() => parseClientMessage({ type: 'openrig.missions', requestId: 'r1', exchanges: 501 })).toThrow();
  });
});
