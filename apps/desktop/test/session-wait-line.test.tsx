import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import type { ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions } from './helpers';

afterEach(async () => { cleanup(); localStorage.clear(); await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const nova = () => listSessions().find(s => s.id === 'nova')!;

/** Nova works (listSessions); its thread: a prompt two seconds ago, nothing since. */
async function openNova(items: ThreadItem[] = [{ kind: 'prompt', id: 'p1', at: ago(2), turn: 1, text: 'Paie en euros' }]) {
  const env = await boot({ sessions: listSessions(), list: true });
  env.d.thread('nova', items);
  await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
  await thread().findByText('Paie en euros');
  return env;
}

describe('the waiting line', () => {
  it('says what the agent last did while it works with no action running', async () => {
    const { d } = await openNova();
    expect(await thread().findByRole('status', { name: 'The agent is working' })).toHaveTextContent('Reading your message…');

    // An action starts: its own live line takes over.
    const t1: ThreadItem = { kind: 'tool', id: 't1', at: ago(1), turn: 1, tool: 'Bash', label: 'npm test', status: 'running', files: [] };
    d.threadItem('nova', t1);
    await thread().findByRole('status', { name: 'Action running' });
    expect(thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();

    // It ends: the line comes back on its result.
    d.threadItem('nova', { ...t1, status: 'success', durationMs: 500 });
    const line = await thread().findByRole('status', { name: 'The agent is working' });
    expect(line).toHaveTextContent('Looking at the output of npm test…');
    expect(within(line).getByText('npm test').tagName).toBe('CODE');
  });

  it('draws what the agent does: the page while it reads its message, then the drawing of its last action\'s verb', async () => {
    const { d } = await openNova();
    const line = await thread().findByRole('status', { name: 'The agent is working' });
    // Reading the prompt (#67, A): the page being read, never an empty cell.
    expect(line.querySelector('[data-drawing]')?.getAttribute('data-drawing')).toBe('read');
    expect(line.querySelector('.spin')).toBeNull();
    const done = (id: string, tool: string, label: string): ThreadItem => ({ kind: 'tool', id, at: ago(1), turn: 1, tool, label, status: 'success', durationMs: 200, files: [] });
    for (const [id, tool, drawing] of [['t1', 'Read', 'read'], ['t2', 'Edit', 'write'], ['t3', 'Grep', 'search'], ['t4', 'Bash', 'run']] as const) {
      d.threadItem('nova', done(id, tool, `${tool.toLowerCase()} x`));
      await expect.poll(() => thread().getByRole('status', { name: 'The agent is working' }).querySelector('[data-drawing]')?.getAttribute('data-drawing')).toBe(drawing);
    }
    expect(thread().getByRole('status', { name: 'The agent is working' }).querySelector('.spin')).toBeNull();
    // A failed action keeps the ring.
    d.threadItem('nova', { ...done('t5', 'Bash', 'npm test'), status: 'failed' } as ThreadItem);
    await expect.poll(() => thread().getByRole('status', { name: 'The agent is working' }).querySelector('.spin')).not.toBeNull();
  });

  it('after a helper that finished, shows the ring, never an empty cell', async () => {
    const { d } = await openNova();
    d.threadItem('nova', { kind: 'helper', id: 'h1', at: ago(1), turn: 1, task: 'Lire', agentType: 'Explore', state: 'exited' });
    await expect.poll(() => thread().getByRole('status', { name: 'The agent is working' }).querySelector('.spin')).not.toBeNull();
    const line = thread().getByRole('status', { name: 'The agent is working' });
    expect([...line.querySelectorAll('.n')].some(n => n.childElementCount === 0)).toBe(false);
  });

  it('after a word of its own, the phrase stands alone, no cell', async () => {
    const { d } = await openNova();
    d.threadItem('nova', { kind: 'message', id: 'm1', at: ago(1), turn: 1, text: 'Je regarde.' });
    await expect.poll(() => thread().getByRole('status', { name: 'The agent is working' }).classList.contains('bare')).toBe(true);
    expect(thread().getByRole('status', { name: 'The agent is working' }).querySelector('.n')).toBeNull();
  });

  it('goes once the agent stops working', async () => {
    const { d } = await openNova();
    await thread().findByRole('status', { name: 'The agent is working' });
    d.upsert({ ...nova(), state: 'idle' });
    await expect.poll(() => thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();
  });

  it('after a long wait, says it takes its time and counts it', async () => {
    await openNova([{ kind: 'prompt', id: 'p1', at: ago(75), turn: 1, text: 'Paie en euros' }]);
    const line = await thread().findByRole('status', { name: 'The agent is working' });
    expect(line).toHaveTextContent(/Taking its time, thinking hard….*1 min 1\d s/);
  });

  it('is not there for a session that does not work', async () => {
    const env = await boot({ sessions: listSessions().map(s => (s.id === 'nova' ? { ...s, state: 'idle' as const } : s)), list: true });
    env.d.thread('nova', [{ kind: 'prompt', id: 'p1', at: ago(2), turn: 1, text: 'Paie en euros' }]);
    await env.user.click(screen.getByRole('button', { name: /^Nova,/ }));
    await thread().findByText('Paie en euros');
    expect(thread().queryByRole('status', { name: 'The agent is working' })).toBeNull();
  });
});
