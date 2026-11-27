import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { ClientMessage, Exchange, Mission, OpenRigMissionsChanged, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { OperatorCards, isOperatorThread } from '../src/session/OperatorCards';

// #54: the operator's thread, « Missions » (version C) and « Échanges » (docs/mockups/ledge-operator-rigs-panel.html).

afterEach(() => cleanup());

const NOW = Date.parse('2026-11-27T18:40:00');
const at = (hhmm: string) => new Date(`2026-11-27T${hhmm}:00`).toISOString();
const operator = { id: 'local:max', name: 'Max', rig: { seat: 'operator-agent@kernel', name: 'kernel', role: 'operator.agent' } } as unknown as Session;

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), status = new Set<(s: string) => void>(), sent: ClientMessage[] = [];
  const client = {
    send: (m: ClientMessage) => { sent.push(m); },
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    onStatus: (f: (s: string) => void) => { status.add(f); return () => { status.delete(f); }; }
  } as unknown as DaemonClient;
  const asks = () => sent.filter((m): m is Extract<ClientMessage, { type: 'openrig.missions' }> => m.type === 'openrig.missions');
  const answer = (read: Partial<OpenRigMissionsChanged>) => act(() => listeners.forEach(f => f({
    type: 'openrig.missionsChanged', requestId: asks().at(-1)!.requestId, machineId: 'local',
    openrig: 'ok', operator: 'operator-agent@kernel', missions: [], exchanges: [], exchangesMore: false, ...read
  } as ServerMessage)));
  return { client, sent, asks, answer };
}
const show = (client: DaemonClient) => render(<LangProvider lang="fr"><OperatorCards client={client} session={operator} now={NOW} /></LangProvider>);
const card = (title: string) => screen.getByText(title, { selector: 'summary > span' }).closest('details') as HTMLElement;

const m40: Mission = {
  qitemId: 'm40', rootQitemId: 'm40', rig: 'ledge-dev', state: 'blocked', since: at('16:33'), title: 'Commencer #40 : supprimer le chat Ledge et « À toi »',
  from: 'operator-agent@kernel', to: 'pilot-lead@ledge-dev',
  waitsOn: { kind: 'row', qitemId: 'q2b', title: 'la PR 2b', holder: 'dev-front2@ledge-dev', state: 'in-progress' },
  lastNote: { at: at('18:37'), by: 'pilot-lead@ledge-dev', text: '2a acceptée ; attend la 2b.' },
  children: [{ qitemId: 'q2b', title: 'PR 2b, téléphone', holder: 'dev-front2@ledge-dev', state: 'in-progress', since: at('17:09'), by: 'blocked_on' }],
  closed: { count: 9, titles: ['inventaires', 'PR 1'] }
};
const ev = (id: string, kind: Exchange['kind'], from: string, to: string[], text: string, hhmm: string, o: Partial<Exchange> = {}): Exchange =>
  ({ id, at: at(hhmm), kind, from, to, rigs: [...new Set([...to, from].map(s => s.split('@')[1]!))], text, ...o });

describe('#54: the operator thread\'s cards', () => {
  it('only the kernel operator\'s thread has them', () => {
    expect(isOperatorThread(operator)).toBe(true);
    expect(isOperatorThread({ ...operator, rig: { seat: 'pilot-lead@ledge-dev', name: 'ledge-dev', role: 'pilot.lead' } } as Session)).toBe(false);
    expect(isOperatorThread({ id: 'local:x', name: 'x' } as Session)).toBe(false);
  });

  it('asks its machine once shown; nothing before the answer', () => {
    const f = fake();
    show(f.client);
    expect(f.asks()).toEqual([{ type: 'openrig.missions', requestId: expect.any(String), machineId: 'local', exchanges: 50 }]);
    expect(screen.queryByText('Missions')).toBeNull();
  });

  it('a mission as the mockup draws it: state and since, rig, title, who to whom, what it waits on, the last note, its rows, the closed ones', () => {
    const f = fake();
    show(f.client);
    f.answer({ missions: [m40] });
    const c = within(card('Missions'));
    expect(c.getByText('1')).toBeTruthy();
    expect(c.getByText('bloquée')).toBeTruthy();
    expect(c.getByText('depuis 16:33')).toBeTruthy();
    expect(c.getByText('ledge-dev')).toBeTruthy();
    expect(c.getByText(/Commencer #40/)).toBeTruthy();
    expect(c.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'operator-agent → pilot-lead · attend la PR 2b de dev-front2')).toBeTruthy();
    expect(c.getByText('18:37 · « 2a acceptée ; attend la 2b. »')).toBeTruthy();
    expect(c.getByText('PR 2b, téléphone')).toBeTruthy();
    expect(c.getByText('1 h 31')).toBeTruthy();
    expect(c.getByText('9 lignes fermées')).toBeTruthy();
    expect(c.getByText(/inventaires, PR 1/)).toBeTruthy();
  });

  it('says why it is empty: OpenRig stopped, no operator, no mission; a partial read and a partial mission are said', () => {
    const f = fake();
    show(f.client);
    f.answer({ openrig: 'stopped', operator: null });
    expect(within(card('Missions')).getByText('OpenRig est arrêté.')).toBeTruthy();
    expect(within(card('Échanges')).getByText('OpenRig est arrêté.')).toBeTruthy();
    f.answer({ operator: null });
    expect(within(card('Missions')).getByText('L’opérateur du kernel ne tourne pas : les missions ne sont pas connues.')).toBeTruthy();
    expect(within(card('Échanges')).getByText('Aucun échange.')).toBeTruthy();
    f.answer({});
    expect(within(card('Missions')).getByText('Aucune mission en cours.')).toBeTruthy();
    f.answer({ partial: true, missions: [{ ...m40, partial: true, waitsOn: { kind: 'row', qitemId: 'x', title: null, holder: null, state: null } }] });
    expect(within(card('Missions')).getByText(/Liste peut-être incomplète/)).toBeTruthy();
    expect(within(card('Missions')).getByLabelText('Lecture incomplète : des lignes manquent peut-être.')).toBeTruthy();
    expect(within(card('Missions')).getByText(/attend une ligne illisible/)).toBeTruthy();
  });

  it('exchanges: who, to whom, when, one line; delivery never reads as delivered unless it is; filters; « Voir plus ancien » asks for more', async () => {
    const user = userEvent.setup();
    const f = fake();
    show(f.client);
    f.answer({ exchangesMore: true, exchanges: [
      ev('e1', 'message', 'dev-front@ledge-dev', ['operator-agent@kernel'], 'Tests verts, PR #48 ouverte.', '17:05', { delivery: 'delivered' }),
      ev('e2', 'message', 'operator-agent@kernel', ['dev-front@ledge-dev'], 'Où en est la 2b ?', '17:03', { delivery: 'failed' }),
      ev('e3', 'given', 'operator-agent@kernel', ['pilot-lead@ledge-dev'], '#40 PR 2', '17:02', { delivery: 'indeterminate' }),
      ev('e4', 'done', 'review-qa@ledge-dev', [], 'Inventaire #40', '16:48', { outcome: 'done' }),
      ev('e5', 'blocked', 'dev-front@ledge-dev', ['review-qa@ledge-dev'], '#44 : attend la relecture', '16:45'),
      ev('e6', 'message', 'tom@kl-site', ['eve@kl-site'], 'Prends les captures.', '16:39', { urgent: true })
    ] });
    const c = within(card('Échanges'));
    expect(c.getByText('6')).toBeTruthy();
    expect(c.getByText('✓ remis')).toBeTruthy();
    expect(c.getByText('✕ non remis').getAttribute('title')).toBe('OpenRig n’a pas pu réveiller ce siège.');
    expect(c.getByText('? remise incertaine')).toBeTruthy();
    expect(c.getByText((_, el) => el?.classList.contains('oc-w') === true && el.textContent === 'operator-agent confie à pilot-lead')).toBeTruthy();
    expect(c.getByText((_, el) => el?.classList.contains('oc-w') === true && el.textContent === 'review-qa termine')).toBeTruthy();
    expect(c.getByText((_, el) => el?.classList.contains('oc-w') === true && el.textContent === 'dev-front se bloque sur review-qa')).toBeTruthy();
    // kl-site is not the usual rig here: tagged; the urgent pill.
    expect(c.getByText((_, el) => el?.classList.contains('oc-w') === true && el.textContent === 'tom → eveurgentkl-site')).toBeTruthy();
    await user.click(c.getByRole('button', { name: 'Messages' }));
    expect(c.getByText('3')).toBeTruthy();
    await user.click(c.getByRole('button', { name: 'Passages' }));
    expect(c.getByText('3')).toBeTruthy();
    expect(c.queryByText('Où en est la 2b ?')).toBeNull();
    await user.selectOptions(c.getByRole('combobox', { name: 'Rig' }), 'kl-site');
    expect(c.getByText('Rien pour ce filtre.')).toBeTruthy();
    await user.click(c.getByRole('button', { name: 'Voir plus ancien' }));
    expect(f.asks().at(-1)!.exchanges).toBe(100);
  });

  it('a daemon that predates #54: no card', () => {
    const f = fake();
    show(f.client);
    act(() => { /* the fleet answers outdated */ });
    f.answer({ error: 'outdated', openrig: 'unreachable', operator: null } as Partial<OpenRigMissionsChanged>);
    expect(screen.queryByText('Missions')).toBeNull();
  });
});
