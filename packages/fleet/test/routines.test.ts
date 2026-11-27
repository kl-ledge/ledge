import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMessage, Routine, ServerMessage } from '@ledge/protocol';
import { createFleetClient } from '../src/fleet';
import type { DaemonClient, DaemonStatus } from '../src/client';
import { LOCAL_MACHINE, type MachineConfig } from '../src/machines';
import { applyRoutineChange } from '../src/routines';
import { fakeSession } from './mockDaemon';

// The routines of each machine through the fleet (spec 2026-11-23, mockup docs/mockups/ledge-routines.html).
const remote: MachineConfig = { id: 'server', label: 'Server', ssh: 'dev-server' };
function peer() {
  let status: DaemonStatus = 'connecting';
  const messages = new Set<(m: ServerMessage) => void>(), statuses = new Set<(s: DaemonStatus) => void>();
  const set = (s: DaemonStatus) => { status = s; statuses.forEach(f => f(s)); };
  const sent: ClientMessage[] = [];
  const client: DaemonClient = { connect: () => set('open'), close: () => set('unreachable'), status: () => status, send: m => { sent.push(m); }, onMessage: f => { messages.add(f); return () => { messages.delete(f); }; }, onStatus: f => { statuses.add(f); return () => { statuses.delete(f); }; } };
  return { client, sent, set, emit: (m: ServerMessage) => messages.forEach(f => f(m)) };
}
function setup(routines = true) {
  const local = peer(), server = peer();
  const client = createFleetClient([LOCAL_MACHINE, remote], o => (o.url === LOCAL_MACHINE.url ? local.client : server.client));
  client.connect();
  const snapshot: ServerMessage = { type: 'snapshot', sessions: [fakeSession('same')], launcher: ['node', '/opt/ledge/cli.js'], daemon: { version: '0.62.0', install: 'npm', systemd: true, ...(routines ? { routines: true } : {}) } };
  local.emit(snapshot); server.emit({ ...snapshot, sshAlias: remote.ssh });
  return { fleet: client.fleet!, local, server };
}
const AT = '2026-11-23T07:00:00.000Z';
const routine = (id: string, name: string, extra: Partial<Routine> = {}): Routine => ({ id, name, target: { name: 'Iris', cwd: '/w/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00'], days: ['mon'] },
  prompt: 'p', catchUp: 'once', state: 'enabled', createdBy: { kind: 'user' }, createdAt: AT, ...extra });
beforeEach(() => localStorage.clear());

describe('routines through the fleet', () => {
  it('asks each machine for its routines at its snapshot, and lists them with their machine', () => {
    const { fleet, local, server } = setup();
    expect(local.sent.filter(m => m.type === 'routine.list')).toHaveLength(1);
    expect(server.sent.filter(m => m.type === 'routine.list')).toHaveLength(1);
    // A daemon that does not announce routines is not asked.
    const old = setup(false);
    expect(old.local.sent.filter(m => m.type === 'routine.list')).toHaveLength(0);
    let changes = 0; fleet.onRoutines(() => changes++);
    local.emit({ type: 'routine.listed', rid: 'x', routines: [routine('r000001', 'briefing')] });
    server.emit({ type: 'routine.listed', rid: 'y', routines: [routine('r000002', 'veille')] });
    expect(fleet.routines().map(r => [r.name, r.machineId])).toEqual([['briefing', 'local'], ['veille', 'server']]);
    expect(changes).toBe(2);
  });

  it('follows routine.changed: a change in place, a new one first, a removal', () => {
    const { fleet, local } = setup();
    local.emit({ type: 'routine.listed', rid: 'x', routines: [routine('r000001', 'briefing'), routine('r000002', 'veille')] });
    local.emit({ type: 'routine.changed', routine: routine('r000002', 'veille', { state: 'paused' }) });
    local.emit({ type: 'routine.changed', routine: routine('r000003', 'hebdo') });
    local.emit({ type: 'routine.changed', removed: 'r000001' });
    expect(fleet.routines().map(r => [r.name, r.state])).toEqual([['hebdo', 'enabled'], ['veille', 'paused']]);
  });

  it('sends a command to the machine that holds the routine and settles on its answer, from it only; a refusal rejects with its code', async () => {
    const { fleet, local, server } = setup();
    server.emit({ type: 'routine.listed', rid: 'y', routines: [routine('r000002', 'veille')] });
    const run = fleet.routineCmd('server', { op: 'pause', routine: 'r000002' });
    const sent = server.sent.at(-1) as Extract<ClientMessage, { type: 'routine.cmd' }>;
    expect(sent).toMatchObject({ type: 'routine.cmd', op: 'pause', routine: 'r000002' });
    expect(local.sent.some(m => m.type === 'routine.cmd')).toBe(false);
    local.emit({ type: 'routine.result', rid: sent.rid, code: 'not_found' });
    server.emit({ type: 'routine.result', rid: sent.rid, routine: routine('r000002', 'veille', { state: 'paused' }) });
    await expect(run).resolves.toMatchObject({ routine: { state: 'paused' } });
    expect(fleet.routines()[0]!.state).toBe('paused');
    const rm = fleet.routineCmd('server', { op: 'rm', routine: 'r000009' });
    server.emit({ type: 'routine.result', rid: (server.sent.at(-1) as { rid: string }).rid, code: 'not_found', reason: 'aucune routine r000009' });
    await expect(rm).rejects.toEqual({ code: 'not_found', message: 'aucune routine r000009' });
    // The field the daemon names reaches the front (ff7a19c2): it marks that field without reading the French reason.
    const add = fleet.routineCmd('server', { op: 'add', spec: { name: 'x', target: { name: 'Iris', cwd: '/nope', tool: 'claude' }, schedule: { kind: 'once', at: ['2030-01-01T10:00'] }, prompt: 'p' } });
    server.emit({ type: 'routine.result', rid: (server.sent.at(-1) as { rid: string }).rid, code: 'invalid', reason: 'dossier introuvable : /nope', field: 'cwd' });
    await expect(add).rejects.toEqual({ code: 'invalid', message: 'dossier introuvable : /nope', field: 'cwd' });
  });

  it('a machine that falls keeps its last list, rejects its command in flight « hors ligne », and refuses new ones; an old daemon is « outdated »', async () => {
    const { fleet, server } = setup();
    server.emit({ type: 'routine.listed', rid: 'y', routines: [routine('r000002', 'veille')] });
    const asked = fleet.routineCmd('server', { op: 'run', routine: 'r000002' });
    server.set('unreachable');
    await expect(asked).rejects.toEqual({ code: 'offline', message: 'hors ligne' });
    expect(fleet.routines().map(r => r.machineId)).toEqual(['server']);
    await expect(fleet.routineCmd('server', { op: 'run', routine: 'r000002' })).rejects.toMatchObject({ code: 'offline' });
    // A daemon that does not announce routines does not know the message: too old.
    const before = setup(false);
    const old = before.fleet.routineCmd('local', { op: 'run', routine: 'briefing' });
    before.local.emit({ type: 'error', message: 'invalid message', request: 'routine.cmd', code: 'invalid' });
    await expect(old).rejects.toEqual({ code: 'outdated', message: 'version trop ancienne' });
  });

  it('a daemon that announces routines and refuses a message\'s content is not « too old » (issue #22): an invalid refusal', async () => {
    const { fleet, local } = setup();
    // An empty session name fails the schema; a daemon of 0.63.0 answers a generic error, not a routine.result.
    const add = fleet.routineCmd('local', { op: 'add', spec: { name: 'veille', target: { name: '', cwd: '/w/assistant', tool: 'claude' }, schedule: { kind: 'recurring', times: ['08:00'], days: ['mon'] }, prompt: 'p' } });
    local.emit({ type: 'error', message: 'invalid message', request: 'routine.cmd', code: 'invalid' });
    await expect(add).rejects.toEqual({ code: 'invalid', message: 'invalid message' });
    const preview = fleet.routinePreview('local', { kind: 'recurring', times: ['08:00'], days: ['mon'] });
    local.emit({ type: 'error', message: 'invalid message', request: 'routine.preview', code: 'invalid' });
    await expect(preview).rejects.toMatchObject({ code: 'invalid' });
    // The same refusals from a daemon that does not announce routines stay « outdated ».
    const old = setup(false);
    const p2 = old.fleet.routinePreview('local', { kind: 'recurring', times: ['08:00'], days: ['mon'] });
    old.local.emit({ type: 'error', message: 'invalid message', request: 'routine.preview', code: 'invalid' });
    await expect(p2).rejects.toMatchObject({ code: 'outdated' });
  });

  it('previews a schedule on the machine asked, settled by its routine.previewed', async () => {
    const { fleet, server } = setup();
    const asked = fleet.routinePreview('server', { kind: 'recurring', times: ['16:00'], days: ['thu'], every: { weeks: 2, anchor: '2026-11-27' } });
    const sent = server.sent.at(-1) as Extract<ClientMessage, { type: 'routine.preview' }>;
    expect(sent).toMatchObject({ type: 'routine.preview', schedule: { kind: 'recurring', every: { weeks: 2 } } });
    server.emit({ type: 'routine.previewed', rid: sent.rid, nextRuns: ['2026-11-26T15:00:00.000Z'] });
    await expect(asked).resolves.toMatchObject({ nextRuns: ['2026-11-26T15:00:00.000Z'] });
  });

  it('applyRoutineChange is pure', () => {
    const list = [routine('r000001', 'a')];
    expect(applyRoutineChange(list, {})).toEqual(list);
    expect(applyRoutineChange(list, { removed: 'r000001' })).toEqual([]);
    expect(list).toHaveLength(1);
  });
});
