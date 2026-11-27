import type { NavAction } from '../nav/state';

/** What the island asks Ledge Desktop to show (« Open in Ledge »): the island's `LedgeTarget`, as JSON on `--open`. */
export type LedgeTarget =
  | { kind: 'session'; id: string } | { kind: 'terminal'; id: string } | { kind: 'document'; path: string }
  | { kind: 'settings' } | { kind: 'launch' } | { kind: 'update' } | { kind: 'machines' }
  /** A rig's question, by its OpenRig queue item: the Rigs view's « Demandes », that card ringed (#40 D1). */
  | { kind: 'ask'; id: string }
  /** OpenRig's requests, none in particular: the Rigs view's « Demandes » (#40 D1). */
  | { kind: 'requests' }
  /** A task, a decision put to the user among them: the Tasks view on its detail (#40 D3). */
  | { kind: 'task'; id: string }
  /** A routine's page (routines mockup, card 15: the island's « Voir »), by its machine and its id. */
  | { kind: 'routine'; machine: string; id: string };

const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 4096;

/** The island's target, or null for anything else. */
export function parseTarget(raw: string): LedgeTarget | null {
  let v: unknown; try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case 'session': case 'terminal': return str(o.id) ? { kind: o.kind, id: o.id } : null;
    case 'document': return str(o.path) ? { kind: 'document', path: o.path } : null;
    case 'settings': case 'launch': case 'update': case 'machines': return { kind: o.kind };
    case 'ask': return str(o.id) ? { kind: 'ask', id: o.id } : null;
    case 'requests': return { kind: 'requests' };
    case 'task': return str(o.id) ? { kind: 'task', id: o.id } : null;
    case 'routine': return str(o.machine) && !o.machine.includes(':') && typeof o.id === 'string' && /^r[0-9a-f]{6}$/.test(o.id) ? { kind: 'routine', machine: o.machine, id: o.id } : null;
    default: return null;
  }
}

/** Where a target takes Desktop: a session (its terminal and documents live on its page), a Settings section, the New
 *  session dialog. The island's gear opens « Settings in Ledge Desktop », its own section first. */
export function targetAction(t: Exclude<LedgeTarget, { kind: 'ask' | 'routine' | 'requests' }>): NavAction {
  switch (t.kind) {
    case 'session': case 'terminal': return { type: 'open', id: t.id };
    case 'document': return { type: 'home' };
    case 'settings': return { type: 'settings', section: 'island' };
    case 'machines': return { type: 'settings', section: 'machines' };
    case 'update': return { type: 'settings', section: 'about' };
    case 'launch': return { type: 'modal', modal: { kind: 'launch' } };
    case 'task': return { type: 'tasks', task: t.id };
  }
}
