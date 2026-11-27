// The daemon's own work once the operator is gone (#40, D11, `startServer({ followRigs: true })`): OpenRig followed from the start for
// the island's notices and the urgent asks' push, and the retired operator's journal set aside, never deleted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { DEFAULT_DEVICE_PREFS, pendingKey, type HumanAsk, type MobileState, type PushSend, type ServerMessage, type Session } from '@ledge/protocol';
import { startServer } from '../src/daemon/server.js';
import { Store } from '../src/daemon/store.js';
import type { MobileService } from '../src/mobile/service.js';
import type { HumanChannelService } from '../src/daemon/openrigHuman.js';
import type { Tmux } from '../src/tmux.js';
import { paths } from '../src/paths.js';
import { authHeaders, until } from './helpers.js';

const T0 = '2026-11-13T10:00:00.000Z';
/** The bottom of a Claude Code 2.x permission dialog, then the turn going on once it is answered. */
const PROMPT = ['x', '─'.repeat(80), ' Bash command', '╌'.repeat(80), ' ls', '╌'.repeat(80), ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n');
function fakeTmux(panes: Record<string, string[]> = {}): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession(o) { panes[o.name] = ['']; }, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture(n) { const q = panes[n] ?? ['']; return q.length > 1 ? q.shift()! : q[0]!; },
    async hasSession(n) { return n in panes; }, async listSessions() { return Object.keys(panes); },
    async setOption() {}, async killSession(n) { delete panes[n]; }, attachArgs: n => ['attach', n]
  };
}

/** A mobile service with one paired phone, `dev1`, subscribed to pushes: every push the daemon sends is recorded. */
function fakeMobile() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const sub = { endpoint: 'https://push.test/x', p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'), key: 'K1' };
  const pushes: PushSend[] = [];
  const state = { enabled: true, relayUrl: 'https://relay.test', account: null, signin: null, signinError: null, link: { state: 'online' }, devices: [{ id: 'dev1', label: 'Pixel', approvedAt: T0, online: false }], pairings: [] } as unknown as MobileState;
  const mobile = {
    state: () => state, onChange: () => () => {}, onMessage: () => () => {}, onRecovery: () => () => {}, handle: async () => {}, send: async () => true,
    revoke: async () => {}, rename() {}, deviceInfo: () => ({ label: 'Pixel', kind: 'phone' }), credential: () => null, setCredential() {},
    pushOf: (id: string) => (id === 'dev1' ? sub : null), setPush() {}, prefsOf: () => DEFAULT_DEVICE_PREFS, setPrefs() {},
    relayPushKey: () => 'K1', sendPush: async (m: PushSend) => { pushes.push(m); return { result: 'sent' as const }; }, pcKey: () => 'pc', stop: async () => {}
  } as unknown as MobileService;
  return { mobile, pushes };
}

/** OpenRig installed, its human channel ready: the test pushes new lists of asks. */
function fakeOpenRig() {
  let push: ((l: { channel: { state: 'ready' }; asks: HumanAsk[] }) => void) | null = null;
  const channel = { state: 'ready' as const };
  const human = { async list() { return { channel, asks: [] }; }, async answer(qitemId: string) { return { qitemId, ok: true, outcome: 'answered' as const }; }, start(fn: typeof push) { push = fn; }, stop() {} } as unknown as HumanChannelService;
  const openrig = { async state() { return { installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: T0 }; }, peek: () => undefined } as never;
  const goals = { async list() { return { goals: [] }; } } as never;
  return { human, openrig, goals, asks: (asks: HumanAsk[]) => push?.({ channel, asks }), followed: () => push !== null };
}

function open(port: number): Promise<{ ws: WebSocket; got: ServerMessage[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: authHeaders() });
    const got: ServerMessage[] = [];
    ws.on('message', d => got.push(JSON.parse(String(d)) as ServerMessage));
    ws.once('open', () => res({ ws, got })); ws.once('error', rej);
  });
}

const session: Session = { id: 's1', name: 'Nova', tool: 'claude', cwd: '/w', project: 'w', title: 't', tmuxSession: 'ledge-s1', state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher' };

let close: Array<() => Promise<void>> = [];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-opsrv-')); });
afterEach(async () => { for (const c of close.splice(0).reverse()) await c(); });

describe('startServer({ followRigs: true }) (#40, D11)', () => {
  it('the island\'s notices come after the snapshot; the retired operator\'s journal is set aside, never deleted (#40, D11)', async () => {
    writeFileSync(join(paths().dir, 'ledge.sqlite'), 'journal');
    writeFileSync(join(paths().dir, 'ledge.sqlite-wal'), 'wal');
    const srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, followRigs: true });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'operator.state'));
    expect(a.got.find(m => m.type === 'operator.state')).toEqual({ type: 'operator.state', notices: [] });
    expect(existsSync(join(paths().dir, 'ledge.sqlite'))).toBe(false);
    const kept = readdirSync(paths().dir).filter(f => f.startsWith('ledge.sqlite.bak-')).sort();
    expect(kept).toHaveLength(2);
    expect(readFileSync(join(paths().dir, kept.find(f => !f.endsWith('-wal'))!), 'utf8')).toBe('journal');
    expect(readFileSync(join(paths().dir, kept.find(f => f.endsWith('-wal'))!), 'utf8')).toBe('wal');
  });

  it('a new urgent rig ask reaches the island (with its qitem) and the phone\'s push, once (#40, D11)', async () => {
    const { mobile, pushes } = fakeMobile();
    const rig = fakeOpenRig();
    const srv = await startServer({ store: new Store(), tmux: fakeTmux(), port: 0, mobile, human: rig.human, openrig: rig.openrig, goals: rig.goals, followRigs: true });
    close.push(() => srv.close());
    const a = await open(srv.port); close.push(async () => { a.ws.close(); });
    await until(() => a.got.some(m => m.type === 'snapshot'));
    // OpenRig is followed from the start, with no front asking for it.
    await until(() => rig.followed());
    rig.asks([]);
    const ask: HumanAsk = { id: 'qitem-9', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: null }, summary: 'Fusionner ?',
      body: '', bodyTruncated: false, detail: null, evidenceRef: null, createdAt: T0, updatedAt: T0, questions: [] };
    rig.asks([ask, { ...ask, id: 'qitem-10', priority: 'routine' }]);
    await until(() => pushes.some(p => p.topic === 'ask-qitem-9'));
    expect(pushes.some(p => p.topic === 'ask-qitem-10')).toBe(false);
    const states = () => a.got.filter((m): m is Extract<ServerMessage, { type: 'operator.state' }> => m.type === 'operator.state');
    await until(() => states().some(m => m.notices.length > 0));
    expect(states().at(-1)!.notices).toEqual([{ id: 'rig.ask:qitem-9', kind: 'rig.ask', text: 'Fusionner ?', who: 'pilot-lead@ledge-dev', rig: 'ledge-dev', qitem: 'qitem-9', priority: 'urgent', at: T0 }]);
    // Read again, the ask is not news: no second push.
    rig.asks([ask]);
    await new Promise(r => setTimeout(r, 50));
    expect(pushes.filter(p => p.topic === 'ask-qitem-9')).toHaveLength(1);
    // Answered elsewhere, it leaves the island.
    rig.asks([]);
    await until(() => states().at(-1)!.notices.length === 0);
  });
});
