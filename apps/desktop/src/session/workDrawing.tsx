import type { JSX } from 'react';
import { cls } from '../shell/cls';
import type { WaitCause } from './waiting';

/** What the agent is doing, drawn (docs/mockups/ledge-operator-rigs-panel.html, « Quand l'agent travaille : le dessin suit l'action »,
 *  validated by the owner: « Selon ce qu'il fait »). */
export type WorkDrawingKind = 'read' | 'write' | 'search' | 'run';

/** The drawing for an action's verb (it reads a page, writes lines, searches with a lens, runs a command); none for a cause that is
 *  not an action, nor for a failed one (the ring stays). nodeOf decides what the line shows. */
export function drawingOf(c: WaitCause): WorkDrawingKind | null {
  if (c.kind !== 'tool' || c.failed) return null;
  switch (c.verb) {
    case 'read': return 'read';
    case 'edit': return 'write';
    case 'search': return 'search';
    case 'command': return 'run';
  }
}

/** What stands in the waiting line's node: a drawing, the turning ring, or nothing (the phrase alone, with no empty cell kept for it). */
export type WaitNode = { kind: 'drawing'; drawing: WorkDrawingKind } | { kind: 'ring' } | { kind: 'none' };

/** #67: a wait with no action behind it but the agent reading what came in (its message, a message received) or a helper's answer.
 *  The owner's choice A (2026-11-28, « A »): the page being read for a message, the ring for a helper. B would be nothing, as for the
 *  agent thinking: it would change here only. */
export const WAIT_WITHOUT_TOOL: Record<'prompt' | 'received' | 'helper', WaitNode> = {
  prompt: { kind: 'drawing', drawing: 'read' },
  received: { kind: 'drawing', drawing: 'read' },
  helper: { kind: 'ring' }
};

/** The node for every cause: a tool's verb draws it (a failed one, or a verb without a drawing, keeps the ring); what came in, per
 *  WAIT_WITHOUT_TOOL; the agent thinking after a decision or a word of its own, nothing (owner's choice A: the phrase alone). */
export function nodeOf(c: WaitCause): WaitNode {
  switch (c.kind) {
    case 'tool': { const d = drawingOf(c); return d ? { kind: 'drawing', drawing: d } : { kind: 'ring' }; }
    case 'prompt': case 'received': case 'helper': return WAIT_WITHOUT_TOOL[c.kind];
    case 'decision': case 'said': return { kind: 'none' };
  }
}

/** The mockup's drawings, its strokes and timings as they are, in the Atelier's coral; `still` (the app's « reduce motion ») stops
 *  them, as the stylesheet does for the system's. */
export function WorkDrawing({ kind, still }: { kind: WorkDrawingKind; still: boolean }): JSX.Element {
  return (
    <svg className={cls('work-draw', still && 'still')} data-drawing={kind} viewBox="0 0 18 18" aria-hidden="true">
      {kind === 'read' ? <><rect x="4" y="2.5" width="10" height="13" rx="1.8" /><path className="wd-scan" d="M6.5 6h5" /></>
        : kind === 'write' ? <g className="wd-write"><path d="M3 5h8" /><path d="M3 9h8" /><path d="M3 13h8" /></g>
        : kind === 'search' ? <g className="wd-seek"><circle cx="8" cy="8" r="4" /><path d="m11 11 3.5 3.5" /></g>
        : <><path d="m3 5.5 4 3.5-4 3.5" /><path className="wd-caret" d="M9.5 13h5.5" /></>}
    </svg>
  );
}
