import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage, PhoneTask } from '@ledge/protocol';
import { closedTasks, openDecisions, openTasks } from '../../src/model/tasks';
import { Thread } from '../../src/screens/Thread';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

// A platform authenticator: the note's foot offers its buttons (without one it leads to Réglages, task-foot.test.tsx).
vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => true), createCredential: vi.fn(), getAssertion: vi.fn() }));

const NOW = new Date().toISOString();
const task = (id: string, extra: Partial<PhoneTask> = {}): PhoneTask => ({ id, title: `Tâche ${id}`, owner: 'otto', ownerName: 'Otto', state: 'taken', at: NOW, updatedAt: NOW, ...extra });
/** A decision Otto put to the user: owner Ledge, giver Otto, the options in its text. */
const decision = (extra: Partial<PhoneTask> = {}): PhoneTask =>
  task('t5d6e7f', { owner: 'ledge', ownerName: 'Ledge', giver: 'otto', giverName: 'Otto', title: 'Fusionner feat/roles ?', text: 'Oui : fusionne maintenant\nNon : attends la revue de Mila', state: 'open', ...extra });

/** Otto's thread on a PC that takes `task.answer`: what Otto put to Ledge is answered at its foot (#40 D2). */
function withDecision(tasks: PhoneTask[]) {
  const t = setup();
  const snap = snapshot([session('otto', { name: 'Otto', repo: 'ledge' })], 'PC-Desan', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...snap, daemon: { ...snap.daemon, taskAnswer: true } } as PhoneServerMessage);
  t.deliver({ type: 'tasks', tasks });
  return t;
}

describe('the decisions a session puts to the user', () => {
  it('are kept apart from the tasks Ledge gave: never open or closed tasks of Ledge', () => {
    const tasks = [
      decision(), decision({ id: 't0a0b0c', state: 'done', updatedAt: NOW }),
      task('t91b0d4', { giver: 'ledge' }), task('t3fa21c', { state: 'done' }),
      task('t7e7e7e', { giver: 'mila', state: 'done' })
    ];
    expect(openDecisions(tasks).map(t => t.id)).toEqual(['t5d6e7f']);
    expect(openTasks(tasks).map(t => t.id)).toEqual(['t91b0d4']);
    expect(closedTasks(tasks).map(t => t.id)).toEqual(['t3fa21c']);
  });
});

describe('a proposal about the notes (docs/mockups/ledge-brain-notes.html, part 2), at the foot of its session\'s thread (#40 D2)', () => {
  const proposal = () => decision({ id: 't1a2b3c', title: 'Note machines : ajouter ce fait ?', text: 'oui — …\nnon — …', brain: { kind: 'add', note: 'machines', fact: 'Le Pi a 906 Mo de RAM', source: 'free -h' } });
  it('is answered in place: the fact and its source, « Refuser » at once, « Ajouter » with the device\'s check over that exact choice', async () => {
    const t = withDecision([proposal()]);
    render(<Thread store={t.store} sessionId="otto" />);
    const yours = within(await screen.findByRole('contentinfo', { name: 'Décision' }));
    expect(yours.getByText('propose d’ajouter à la note machines')).toBeInTheDocument();
    expect(yours.getByText('Le Pi a 906 Mo de RAM')).toBeInTheDocument();
    expect(yours.getByText('Source : free -h')).toBeInTheDocument();
    expect(yours.queryByRole('button', { name: /^Répondre/ })).toBeNull();
    fireEvent.click(yours.getByRole('button', { name: 'Modifier' }));
    fireEvent.change(yours.getByLabelText('Le texte ajouté sous « Ajouts »'), { target: { value: 'Le Pi a 906 Mo' } });
    fireEvent.click(yours.getByRole('button', { name: 'Ajouter ce texte' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([expect.objectContaining({ purpose: 'note', task: 't1a2b3c', choice: { yes: true, text: 'Le Pi a 906 Mo' } })]));
    // Nothing goes before the passkey.
    expect(t.of('brain.answer')).toEqual([]);
  });
  it('« Refuser » goes at once, without a check', async () => {
    const t = withDecision([proposal()]);
    render(<Thread store={t.store} sessionId="otto" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refuser' }));
    await waitFor(() => expect(t.of('brain.answer')).toEqual([expect.objectContaining({ task: 't1a2b3c', choice: { yes: false } })]));
    expect(t.of('brain.answer')[0]).not.toHaveProperty('assertion');
    expect(t.of('confirm.prepare')).toEqual([]);
  });
});
