// #40 D2 (docs/mockups/ledge-remove-chat-p2.html, cards 1 and 2): a decision a session put to Ledge, and a proposal about the notes,
// are answered at the foot of that session's thread, one at a time, the decision with `task.answer` under the device's check.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage, PhoneTask } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { getAssertion, platformAvailable } from '../../src/link/webauthn';
import { Sessions } from '../../src/screens/Sessions';
import { SENT_MS } from '../../src/screens/TaskFoot';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => true), createCredential: vi.fn(), getAssertion: vi.fn() }));
beforeEach(() => { vi.mocked(platformAvailable).mockResolvedValue(true); vi.mocked(getAssertion).mockReset(); });

const ASSERTION = { id: 'a', clientDataJSON: 'b', authenticatorData: 'c', signature: 'd' };
const NOW = new Date().toISOString();
const decision = (id: string, extra: Partial<PhoneTask> = {}): PhoneTask => ({
  id, owner: 'ledge', ownerName: 'Ledge', giver: 'nova', giverName: 'Nova', title: 'Choisir le dossier des captures', text: 'captures/ ou docs/shots/ ? Les deux existent.',
  state: 'open', at: NOW, updatedAt: NOW, ...extra
});

function open(tasks: PhoneTask[], o: { taskAnswer?: boolean; confirm?: boolean } = {}) {
  const t = setup();
  const snap = snapshot([session('nova', { name: 'Nova', repo: 'ledge' })], 'PC-Desan', undefined, { confirm: o.confirm ?? true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...snap, daemon: { ...snap.daemon, ...(o.taskAnswer === false ? {} : { taskAnswer: true }) } } as PhoneServerMessage);
  t.deliver({ type: 'tasks', tasks });
  return t;
}
const foot = () => screen.getByRole('contentinfo', { name: copy.cards.decision });
const field = () => within(foot()).getByRole('textbox');

describe('a decision put to Ledge, in its session\'s thread (#40 D2)', () => {
  it('takes the composer\'s place: who asks, the title, the detail, a field, « Envoyer ma réponse » and the check\'s line (card 1)', async () => {
    const t = open([decision('t1')]);
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(f).toHaveTextContent('DécisionNovate demande');
    expect(within(f).getByText('Choisir le dossier des captures')).toBeInTheDocument();
    expect(within(f).getByText('captures/ ou docs/shots/ ? Les deux existent.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('placeholder', 'Ta réponse…');
    expect(within(f).getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
    expect(within(f).getByText('Une vérification sur ton appareil sera demandée.')).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.thread.composer.label('Nova'))).toBeNull();
  });

  it('signs that exact answer, sends task.answer, says « Réponse envoyée à Nova. », then gives the composer back after 3 s', async () => {
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const t = open([decision('t1')]);
    render(<Thread store={t.store} sessionId="nova" />);
    await screen.findByRole('contentinfo', { name: copy.cards.decision });
    fireEvent.change(field(), { target: { value: 'docs/shots/, et supprime captures/' } });
    fireEvent.click(within(foot()).getByRole('button', { name: 'Envoyer ma réponse' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([expect.objectContaining({ purpose: 'decision', task: 't1', taskAnswer: 'docs/shots/, et supprime captures/' })]));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'decision', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('task.answer')).toEqual([expect.objectContaining({ task: 't1', answer: 'docs/shots/, et supprime captures/', confirmed: true, assertion: ASSERTION })]));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => t.deliver({ type: 'operation.result', op: t.of('task.answer')[0]!.op, status: 'applied' }));
    act(() => t.deliver({ type: 'tasks', tasks: [decision('t1', { state: 'done', result: 'docs/shots/' })] }));
    await act(async () => { await Promise.resolve(); });
    expect(within(foot()).getByText('Réponse envoyée à Nova.')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(SENT_MS); });
    vi.useRealTimers();
    expect(screen.queryByRole('contentinfo', { name: copy.cards.decision })).toBeNull();
  });

  it('one at a time, the oldest first, « 1 sur 2 » (card 2)', async () => {
    const t = open([decision('t2', { title: 'La seconde', at: new Date(Date.now() + 1000).toISOString() }), decision('t1', { title: 'La première' })]);
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(within(f).getByText('La première')).toBeInTheDocument();
    expect(within(f).queryByText('La seconde')).toBeNull();
    expect(within(f).getByText('1 sur 2')).toBeInTheDocument();
  });

  it('without a passkey: says so, and « Ouvrir les Réglages » (card 2)', async () => {
    const t = open([decision('t1')], { confirm: false });
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(within(f).getByText(copy.cards.note.confirmRequired)).toBeInTheDocument();
    expect(within(f).getByRole('link', { name: 'Ouvrir les Réglages' })).toHaveAttribute('href', '#/connection');
    expect(within(f).queryByRole('textbox')).toBeNull();
  });

  it('offline: nothing can be sent, and it says why (card 2)', async () => {
    const t = open([decision('t1')]);
    act(() => t.set('pc_offline'));
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(within(f).getByText(copy.decide.offlineHint)).toBeInTheDocument();
    expect(within(f).getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
  });

  it('a decision closed meanwhile says « Déjà traitée ailleurs » (card 2)', async () => {
    vi.mocked(getAssertion).mockResolvedValue(ASSERTION);
    const t = open([decision('t1')]);
    render(<Thread store={t.store} sessionId="nova" />);
    await screen.findByRole('contentinfo', { name: copy.cards.decision });
    fireEvent.change(field(), { target: { value: 'captures/' } });
    fireEvent.click(within(foot()).getByRole('button', { name: 'Envoyer ma réponse' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'decision', challenge: 'Y2g', rpId: 'pc.local', credentialId: 'Y3I', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('task.answer')).toHaveLength(1));
    act(() => t.deliver({ type: 'operation.result', op: t.of('task.answer')[0]!.op, status: 'rejected', reason: 'stale' }));
    expect(await within(foot()).findByText(copy.gone.titleElsewhere)).toBeInTheDocument();
  });

  it('a proposal about the notes keeps its buttons: Ajouter · Modifier · Refuser (card 2)', async () => {
    const t = open([decision('t3', { title: 'Note captures : ajouter ce fait ?', brain: { kind: 'add', note: 'captures', fact: 'Les captures vont dans docs/shots/, jamais à la racine.', source: 't-13, réponse du 27/11' } })]);
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(within(f).getByText('propose d’ajouter à la note captures')).toBeInTheDocument();
    expect(within(f).getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
    expect(within(f).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
    expect(within(f).getByRole('button', { name: 'Refuser' })).toBeInTheDocument();
  });

  it('a session that ended: the decision\'s foot stays, above « Session terminée » (design-ux, 19:43Z)', async () => {
    const t = setup();
    const snap = snapshot([session('nova', { name: 'Nova', repo: 'ledge', state: 'exited' })], 'PC-Desan', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...snap, daemon: { ...snap.daemon, taskAnswer: true } } as PhoneServerMessage);
    t.deliver({ type: 'tasks', tasks: [decision('t1')] });
    render(<Thread store={t.store} sessionId="nova" />);
    const f = await screen.findByRole('contentinfo', { name: copy.cards.decision });
    expect(within(f).getByText('Choisir le dossier des captures')).toBeInTheDocument();
    const ended = screen.getByText(copy.sessionEnd.ended);
    expect(f.compareDocumentPosition(ended) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a PC without task.answer keeps the composer', async () => {
    const t = open([decision('t1')], { taskAnswer: false });
    render(<Thread store={t.store} sessionId="nova" />);
    await waitFor(() => expect(screen.getByLabelText(copy.thread.composer.label('Nova'))).toBeInTheDocument());
    expect(screen.queryByRole('contentinfo', { name: copy.cards.decision })).toBeNull();
  });

  it('marks the session\'s row in Sessions with an amber « Décision » while it waits', () => {
    const t = open([decision('t1')]);
    render(<Sessions store={t.store} />);
    const row = screen.getByRole('link', { name: /Nova/ });
    expect(within(row).getByText('Décision')).toHaveAttribute('data-pill', 'ask');
  });
});
