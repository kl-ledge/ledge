import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RoutineCmdSchema, type ClientMessage, type OpenRigAnswered, type OperatorNotice, type ServerMessage, type Task } from '@ledge/protocol';
import type { FleetRoutine, RoutineAsk } from '@ledge/fleet/routines';
import type { DaemonClient } from '../src/daemon/client';
import { daemonStore } from '../src/daemon/store';
import { Surface } from '../src/surface/Surface';
import { subscribeOpenInLedge, type LedgeTarget } from '../src/desktop/openInLedge';
import { fakeSession } from './mockDaemon';
import { pointHebdo, veille, group, task, decision } from './routineFixtures';

/** A fleet of two machines whose notices, tasks and routines the test sets; every send and routine command is recorded. */
function fleetClient(o: { tasks?: Task[]; routines?: FleetRoutine[]; groups?: boolean } = {}) {
  const sent: Array<{ machine: string; msg: ClientMessage }> = [];
  const cmds: Array<{ machine: string; ask: RoutineAsk }> = [];
  const rereads: string[] = [];
  let notices: ReadonlyMap<string, OperatorNotice[]> = new Map();
  const listeners = new Set<() => void>();
  const daemon = { version: '0.64.0', install: 'npm', systemd: true, routines: true, ...(o.groups === false ? {} : { routineGroups: true }) };
  let machines = [{ id: 'local', label: 'Local', status: 'open', ready: true, daemon }, { id: 'dev', label: 'Devbox', status: 'open', ready: true, daemon }];
  let fail: { code: string; message: string } | null = null;
  // Stable lists: the hooks read them as external-store snapshots.
  const tasks = o.tasks ?? [], routines = o.routines ?? [];
  const fleet = {
    selected: () => 'local', select() {}, terminal: () => null, turnMachine: () => machines[0], configure() {}, probe: async () => ({}), retry() {},
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    machines: () => machines, operator: () => notices, tasks: () => tasks, routines: () => routines, onRoutines: () => () => {},
    sendTo: (machine: string, msg: ClientMessage) => { sent.push({ machine, msg }); return true; },
    rereadRoutines: (machine: string) => { rereads.push(machine); },
    routineCmd: async (machine: string, ask: RoutineAsk) => { cmds.push({ machine, ask }); if (fail) throw fail; return { type: 'routine.result', rid: 'x' }; }
  };
  // What the island sends through the client itself (`openrig.answer`, routed by the fleet on its machineId), and what it hears back.
  const direct: ClientMessage[] = [];
  const heard = new Set<(m: ServerMessage) => void>();
  const client = { connect() {}, close() {}, send: (m: ClientMessage) => { direct.push(m); }, status: () => 'open',
    onMessage: (fn: (m: ServerMessage) => void) => { heard.add(fn); return () => heard.delete(fn); }, onStatus: () => () => {}, fleet } as unknown as DaemonClient;
  const hear = (m: ServerMessage) => act(() => { heard.forEach(fn => fn(m)); });
  const set = (next: Record<string, OperatorNotice[]>) => act(() => { notices = new Map(Object.entries(next)); listeners.forEach(fn => fn()); });
  const ready = (id: string, on: boolean) => act(() => { machines = machines.map(m => (m.id === id ? { ...m, ready: on, status: on ? 'open' : 'closed' } : m)); listeners.forEach(fn => fn()); });
  return { client, sent, direct, hear, cmds, rereads, set, ready, failWith: (message: string, code = 'not_pending') => { fail = { code, message }; } };
}

const AT = '2026-11-13T14:32:00.000Z';
const rigAsk = (qitem: string, extra: Partial<OperatorNotice> = {}): OperatorNotice => ({ id: `rig.ask:${qitem}`, kind: 'rig.ask', qid: 'p1', text: 'Merge #309 now?', who: 'pilot-lead', rig: 'ledge-dev', qitem, options: [{ id: 'merge', label: 'Merge' }, { id: 'wait', label: 'Wait for qa' }], priority: 'urgent', at: AT, ...extra });
/** A rig's question as a daemon with #40 says it: the question its options answer, and no point (the operator may be off). */
const rigAsk40 = (qitem: string, extra: Partial<OperatorNotice> = {}): OperatorNotice => { const { qid: _q, ...n } = rigAsk(qitem, { questionId: 'q', ...extra }); return n; };
const answered = (requestId: string, extra: Partial<OpenRigAnswered> = {}): OpenRigAnswered => ({ type: 'openrig.answered', requestId, machineId: 'dev', qitemId: 'q1', ok: true, outcome: 'answered', ...extra });
const point = (qid: string): OperatorNotice => ({ id: `point:${qid}`, kind: 'point', qid, text: 'Two things for you.', priority: 'routine', at: AT });
const island = () => document.querySelector('.di-island') as HTMLElement | null;
const card = () => document.querySelector('.di-card') as HTMLElement;
const surface = () => document.querySelector('[data-surface]') as HTMLElement;
const tick = (n: number) => act(() => { vi.advanceTimersByTime(n); });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

let opened: LedgeTarget[]; let off: () => void;
beforeEach(() => {
  vi.useFakeTimers(); daemonStore.reset(); opened = [];
  off = subscribeOpenInLedge((target, outcome) => { if (outcome === 'opening') opened.push(target); });
});
afterEach(() => { off(); vi.useRealTimers(); });
const mount = (f: ReturnType<typeof fleetClient>) => {
  act(() => { daemonStore.setStatus('open'); daemonStore.apply({ type: 'snapshot', sessions: [fakeSession('otto', { name: 'Otto', project: 'ledge', branch: 'feat/routines-ui', state: 'idle' })] }); });
  render(<Surface screenH={1080} screenW={1920} client={f.client} dnd={false} />);
};

describe('Ledge’s own notices on the island (complement, cards #ledge)', () => {
  it('« le point » never reaches the island', () => {
    const f = fleetClient(); mount(f);
    f.set({ local: [point('p1')] });
    expect(island()).toBeNull();
  });

  it('a rig’s question: Ledge’s mark, « Rig question », who and the question, its rig and time; the suggested answer first in coral; a click answers on its machine, « Received », and the island closes', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk40('q1')] });
    expect(island()).toHaveAttribute('data-kind', 'rig');
    expect(island()).toHaveAttribute('data-ledge', 'ask');
    expect(card().querySelector('[data-ledge-mark]')).not.toBeNull();
    expect(card().querySelector('.di-badge')).toHaveTextContent('Rig question');
    expect(card().querySelector('.di-sentence')).toHaveTextContent('pilot-lead: “Merge #309 now?”');
    expect(card().querySelector('.di-sentence b')).toHaveTextContent('pilot-lead');
    expect(card().querySelector('.di-meta')).toHaveTextContent(/^ledge-dev · \d\d:\d\d$/);
    const buttons = [...card().querySelectorAll('.di-actions .ledge-btn')];
    expect(buttons.map(b => [b.textContent, b.getAttribute('data-variant')])).toEqual([['Merge', 'primary'], ['Wait for qa', 'outline']]);
    expect(screen.getByRole('button', { name: 'Answer in Ledge O' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later Esc' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(f.direct).toEqual([expect.objectContaining({ type: 'openrig.answer', machineId: 'dev', qitemId: 'q1' })]);
    f.hear(answered((f.direct[0] as { requestId: string }).requestId));
    expect(card()).toHaveTextContent('Received');
    tick(900);
    expect(surface()).toHaveAttribute('data-closing', 'true');
  });

  it('#40: a rig’s question from a daemon before #40 (no questionId): no buttons, nothing sent through the point; « Answer in Ledge » opens it there', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk('q1')] });
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answer in Ledge O' }));
    expect(f.sent).toEqual([]); expect(f.direct).toEqual([]);
    expect(opened).toEqual([{ kind: 'ask', id: 'q1' }]);
  });

  it('#40: with the point there too (qid and questionId), the answer still goes through OpenRig, never point.act', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk('q1', { questionId: 'q' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Wait for qa' }));
    expect(f.sent).toEqual([]);
    expect(f.direct).toEqual([expect.objectContaining({ type: 'openrig.answer', answer: { kind: 'choice', questionId: 'q', optionId: 'wait' } })]);
  });

  it('#40: an answer OpenRig refuses brings the question back with its reason, at the head of the line; one already closed does not', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk40('q1'), rigAsk40('q2', { at: '2026-11-13T14:33:00.000Z' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    f.hear(answered((f.direct[0] as { requestId: string }).requestId, { ok: false, error: 'refused', message: 'The row changed' }));
    tick(900 + 240);
    expect(card().querySelector('.di-sentence')).toHaveTextContent('Merge #309 now?');
    expect(card().querySelector('.di-note[data-tone="bad"]')).toHaveTextContent('The row changed');
    expect(card()).toHaveTextContent('+1 more');
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    f.hear(answered((f.direct[1] as { requestId: string }).requestId, { ok: false, error: 'closed' }));
    tick(900 + 240);
    expect(card().querySelector('.di-note[data-tone="bad"]')).toBeNull();
    expect(card()).not.toHaveTextContent('+1 more');
  });

  it('#40: an answer whose end never comes stays aside, as through the point (no new words); the machine offline says the island’s own', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk40('q1')] });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    tick(45_000 + 900 + 240);
    expect(island()).toBeNull();
    f.set({ dev: [rigAsk40('q2')] });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    f.hear(answered((f.direct[1] as { requestId: string }).requestId, { ok: false, error: 'offline' }));
    tick(900 + 240);
    expect(card().querySelector('.di-note[data-tone="bad"]')).toHaveTextContent('Offline: reconnecting to the daemon');
  });

  it('a rig’s answer refused brings the question back with its reason, at the head of the line (review 575f5fb8, 3)', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk40('q1')] });
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    // A session's request arrives meanwhile: it waits behind the question that comes back.
    act(() => { daemonStore.apply({ type: 'session.updated', session: fakeSession('otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }) }); });
    f.hear(answered((f.direct[0] as { requestId: string }).requestId, { ok: false, error: 'refused', message: 'This question was already answered' }));
    tick(900 + 240);
    expect(island()).toHaveAttribute('data-kind', 'rig');
    expect(card().querySelector('.di-note[data-tone="bad"]')).toHaveTextContent('This question was already answered');
    expect(card()).toHaveTextContent('+1 more');
  });

  it('a rig’s question without proposed answers: one « Answer in Ledge » (O), which opens it there', () => {
    const f = fleetClient(); mount(f);
    f.set({ local: [rigAsk('q2', { options: undefined })] });
    expect(card().querySelectorAll('.di-actions .ledge-btn')).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'o' });
    expect(opened).toEqual([{ kind: 'ask', id: 'q2' }]);
  });

  it('a decision: « Decision », who asks, the session’s project and branch; View (O) opens that decision in Desktop’s Tasks view (#40 D3)', () => {
    const f = fleetClient({ tasks: [task('t7', undefined, { giver: 'otto', giverName: 'Otto' })] }); mount(f);
    f.set({ local: [{ id: 'decision:t7', kind: 'decision', text: 'Which port?', who: 'Otto', priority: 'routine', at: AT }] });
    expect(card().querySelector('.di-badge')).toHaveTextContent('Decision');
    expect(card().querySelector('.di-sentence')).toHaveTextContent('Otto asks you for a decision');
    expect(card().querySelector('.di-meta')).toHaveTextContent('ledge · feat/routines-ui');
    fireEvent.click(screen.getByRole('button', { name: 'View O' }));
    expect(opened).toEqual([{ kind: 'task', id: 't7' }]);
  });

  it('a routine to activate: « Routine », its words, Activate sends its key; « Received »', async () => {
    const f = fleetClient({ tasks: [task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })], routines: [pointHebdo] }); mount(f);
    f.set({ local: [decision('t1')] });
    expect(island()).toHaveAttribute('data-kind', 'routine');
    expect(card().querySelector('.di-badge')).toHaveTextContent('Routine');
    expect(card().querySelector('.di-sentence')).toHaveTextContent('Iris wants to schedule “point-hebdo”: 17:00 (Fri), in ~/assistant');
    expect(card()).not.toHaveTextContent('Point de la semaine');
    expect(screen.getByRole('button', { name: 'View O' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate' })); });
    await settle();
    expect(f.cmds).toEqual([{ machine: 'local', ask: { op: 'approve', routine: 'r3f9a12', expect: 'k-point' } }]);
    expect(RoutineCmdSchema.safeParse({ type: 'routine.cmd', rid: 'x', ...f.cmds[0]!.ask }).success).toBe(true);
    expect(card()).toHaveTextContent('Received');
  });

  it('several one-shots together: « Activate all 3 », one command; a daemon too old for a group sends nothing and says so', async () => {
    const t2 = task('t2', { kind: 'approve', id: 'r000001', name: 'prepa-121', ids: ['r000001', 'r000002', 'r000003'] });
    const f = fleetClient({ tasks: [t2], routines: group, groups: false }); mount(f);
    f.set({ local: [decision('t2')] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate all 3' })); });
    expect(f.cmds).toEqual([]);
    expect(card().querySelector('.di-note[data-tone="bad"]')).toHaveTextContent('This machine’s Ledge is too old to activate or refuse a group: update it. Nothing changed.');
  });

  it('a routine changed since it was shown: nothing activated, the routines read again, the change said in amber', async () => {
    const f = fleetClient({ tasks: [task('t1', { kind: 'approve', id: 'r3f9a12', name: 'point-hebdo' })], routines: [pointHebdo] }); mount(f);
    f.set({ local: [decision('t1')] });
    f.failWith('changed', 'stale');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate' })); });
    await settle();
    expect(f.rereads).toEqual(['local']);
    expect(card().querySelector('.di-note[data-tone="warn"]')).toHaveTextContent('“point-hebdo” changed since you opened it: read it again before activating.');
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled();
  });

  it('a routine that could not run: red, its name in bold, Retry runs it, View (O) opens its page', async () => {
    const f = fleetClient({ tasks: [task('t3', { kind: 'failed', id: 'r81c0d4', name: 'veille', reason: 'dossier introuvable : ~/veille' })], routines: [veille] }); mount(f);
    f.set({ local: [decision('t3')] });
    expect(island()).toHaveAttribute('data-ledge', 'bad');
    expect(card().querySelector('.di-sentence')).toHaveTextContent('The routine veille (Nova) could not run: folder not found: ~/veille');
    expect(card().querySelector('.di-sentence b')).toHaveTextContent('veille');
    fireEvent.keyDown(window, { key: 'o' });
    expect(opened).toEqual([{ kind: 'routine', machine: 'local', id: 'r81c0d4' }]);
    tick(240);
    // Set aside by View; Ctrl+Alt+L brings it back, and Retry runs it.
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await settle();
    expect(f.cmds).toEqual([{ machine: 'local', ask: { op: 'run', routine: 'r81c0d4' } }]);
  });

  it('Ledge’s requests and the sessions’ wait in one line, in their order: « +1 more », « Later, next »', () => {
    const f = fleetClient(); mount(f);
    f.set({ dev: [rigAsk('q1')] });
    act(() => { daemonStore.apply({ type: 'session.updated', session: fakeSession('otto', { name: 'Otto', state: 'waiting_permission', pending: { kind: 'permission', text: 'npm test', source: 'hook' } }) }); });
    expect(card()).toHaveTextContent('+1 more');
    fireEvent.click(screen.getByRole('button', { name: 'Later, next Esc' }));
    tick(240);
    expect(island()).toHaveAttribute('data-kind', 'permission');
  });

  it('a machine that drops: a 6 s notice, grey, its name and « Reconnecting on its own »; a click opens the machines', () => {
    const f = fleetClient(); mount(f);
    f.ready('dev', false);
    expect(island()).toHaveAttribute('data-kind', 'offline');
    expect(card().querySelector('.di-badge')).toHaveTextContent('Offline');
    expect(card().querySelector('.di-sentence b')).toHaveTextContent('Devbox');
    expect(card().querySelector('.di-meta')).toHaveTextContent('Reconnecting on its own');
    expect(card().querySelector('[data-ring]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the machines in Ledge' }));
    expect(opened).toEqual([{ kind: 'machines' }]);
  });

  it('a machine back before its notice opened is forgotten', () => {
    const f = fleetClient(); mount(f);
    f.set({ local: [rigAsk('q1')] });
    f.ready('dev', false); f.ready('dev', true);
    expect(card()).not.toHaveTextContent('+1 more');
  });
});
