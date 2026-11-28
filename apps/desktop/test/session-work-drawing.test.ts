// The waiting line's drawing follows what the agent does (docs/mockups/ledge-operator-rigs-panel.html, « Selon ce qu'il fait »).
import { describe, expect, it } from 'vitest';
import { drawingOf, nodeOf, WAIT_WITHOUT_TOOL } from '../src/session/workDrawing';

const tool = (verb: 'read' | 'edit' | 'search' | 'command', failed = false) => ({ kind: 'tool' as const, verb, target: 'x', failed });

describe('drawingOf', () => {
  it('draws the last action\'s verb: a page read, lines written, a lens searching, a command run', () => {
    expect(drawingOf(tool('read'))).toBe('read');
    expect(drawingOf(tool('edit'))).toBe('write');
    expect(drawingOf(tool('search'))).toBe('search');
    expect(drawingOf(tool('command'))).toBe('run');
  });

  it('draws nothing (the ring stays) when no action is behind the wait, or for a failed one', () => {
    expect(drawingOf(tool('command', true))).toBeNull();
    expect(drawingOf({ kind: 'said' })).toBeNull();
    expect(drawingOf({ kind: 'decision' })).toBeNull();
    expect(drawingOf({ kind: 'prompt', from: 'user' } as never)).toBeNull();
    expect(drawingOf({ kind: 'received', from: 'Otto' } as never)).toBeNull();
    expect(drawingOf({ kind: 'helper', name: 'Explore' } as never)).toBeNull();
  });
});

// #67: every cause has its node, and no cause leaves an empty cell.
describe('nodeOf', () => {
  it('a tool: its verb\'s drawing; a failed one, the ring', () => {
    expect(nodeOf(tool('read'))).toEqual({ kind: 'drawing', drawing: 'read' });
    expect(nodeOf(tool('edit'))).toEqual({ kind: 'drawing', drawing: 'write' });
    expect(nodeOf(tool('search'))).toEqual({ kind: 'drawing', drawing: 'search' });
    expect(nodeOf(tool('command'))).toEqual({ kind: 'drawing', drawing: 'run' });
    expect(nodeOf(tool('command', true))).toEqual({ kind: 'ring' });
  });
  it('a verb with no drawing keeps the ring', () => {
    expect(nodeOf({ kind: 'tool', verb: 'other' as never, target: 'x', failed: false })).toEqual({ kind: 'ring' });
  });
  it('the agent reads its message (you, or its parent): the page being read (A)', () => {
    expect(nodeOf({ kind: 'prompt', from: 'you' })).toEqual({ kind: 'drawing', drawing: 'read' });
    expect(nodeOf({ kind: 'prompt', from: 'parent' })).toEqual({ kind: 'drawing', drawing: 'read' });
  });
  it('a message received: the page being read (A)', () => {
    expect(nodeOf({ kind: 'received', from: 'Otto' })).toEqual({ kind: 'drawing', drawing: 'read' });
  });
  it('a helper\'s answer: the ring (A)', () => {
    expect(nodeOf({ kind: 'helper', name: 'Explore' })).toEqual({ kind: 'ring' });
  });
  it('the agent thinks after a decision or a word of its own: nothing', () => {
    expect(nodeOf({ kind: 'decision' })).toEqual({ kind: 'none' });
    expect(nodeOf({ kind: 'said' })).toEqual({ kind: 'none' });
  });
  it('the choice for what came in is in one place (A coded)', () => {
    expect(WAIT_WITHOUT_TOOL).toEqual({ prompt: { kind: 'drawing', drawing: 'read' }, received: { kind: 'drawing', drawing: 'read' }, helper: { kind: 'ring' } });
  });
});
