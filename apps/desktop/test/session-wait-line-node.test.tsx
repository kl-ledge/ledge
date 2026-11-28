// #67: the waiting line's node for every cause. Each draws, turns, or shows nothing, and nothing never keeps an empty cell.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';
import { WaitLine } from '../src/session/WaitLine';
import type { WaitCause } from '../src/session/waiting';
import { declarations } from './helpers';

afterEach(() => cleanup());

const NOW = Date.parse('2026-11-28T13:00:00Z');
function line(cause: WaitCause): HTMLElement {
  const { container } = render(<LangProvider lang="en"><ul><WaitLine wait={{ cause, since: NOW - 2000 }} seedKey="k" now={NOW} /></ul></LangProvider>);
  return container.querySelector('.wait-row') as HTMLElement;
}
const drawn = (el: HTMLElement) => el.querySelector('[data-drawing]')?.getAttribute('data-drawing') ?? null;
const ring = (el: HTMLElement) => el.querySelector('.spin') !== null;
/** A cell kept with nothing in it: the gap the owner saw (« Lit le message… »). */
const emptyCell = (el: HTMLElement) => [...el.querySelectorAll('.n')].some(n => n.childElementCount === 0);

describe('#67: the waiting line never leaves an empty cell', () => {
  it.each([['read', 'read'], ['edit', 'write'], ['search', 'search'], ['command', 'run']] as const)('a tool %s: its drawing', (verb, drawing) => {
    const el = line({ kind: 'tool', verb, target: 'src/a.ts', failed: false });
    expect(drawn(el)).toBe(drawing);
    expect(ring(el)).toBe(false);
    expect(emptyCell(el)).toBe(false);
  });

  it('a failed tool: the ring', () => {
    const el = line({ kind: 'tool', verb: 'command', target: 'npm test', failed: true });
    expect(ring(el)).toBe(true);
    expect(drawn(el)).toBeNull();
    expect(emptyCell(el)).toBe(false);
  });

  it('the agent reads its message (« Lit le message… »): the page being read', () => {
    const el = line({ kind: 'prompt', from: 'you' });
    expect(drawn(el)).toBe('read');
    expect(emptyCell(el)).toBe(false);
  });

  it('the agent reads its parent\'s message: the page being read', () => {
    const el = line({ kind: 'prompt', from: 'parent' });
    expect(drawn(el)).toBe('read');
    expect(emptyCell(el)).toBe(false);
  });

  it('a message received: the page being read', () => {
    const el = line({ kind: 'received', from: 'Otto' });
    expect(drawn(el)).toBe('read');
    expect(emptyCell(el)).toBe(false);
  });

  it('a helper\'s answer: the ring', () => {
    const el = line({ kind: 'helper', name: 'Explore' });
    expect(ring(el)).toBe(true);
    expect(emptyCell(el)).toBe(false);
  });

  it.each([['decision'], ['said']] as const)('the agent thinks (%s): the phrase alone, no cell at all, the row marked bare', kind => {
    const el = line({ kind });
    expect(el.querySelector('.n')).toBeNull();
    expect(el.classList.contains('bare')).toBe(true);
    expect(el.querySelector('.wait-phrase')?.textContent).toBeTruthy();
  });

  it('a thinking row drops the node column, including under the Atelier skin', () => {
    const cols = 'grid-template-columns:minmax(0,1fr)minmax(56px,max-content)';
    expect(declarations('session.css', '.wait-row.bare')).toContain(cols);
    expect(declarations('session.css', ':root[data-skin="atelier"] .ide-pane .wait-row.bare')).toContain(cols);
  });
});
