import { openDesktop } from '../tauri/bridge';

/** What the island asks Ledge Desktop to open. */
export type LedgeTarget =
  | { kind: 'session'; id: string }
  | { kind: 'terminal'; id: string }
  | { kind: 'document'; path: string }
  | { kind: 'settings' }
  | { kind: 'launch' }
  | { kind: 'update' }
  | { kind: 'machines' }
  /** A rig's question, by its OpenRig queue item: Desktop's Rigs view, that card ringed (#40 D1). */
  | { kind: 'ask'; id: string }
  /** OpenRig's requests, none in particular: Desktop's Rigs view (#40 D1). */
  | { kind: 'requests' }
  /** A decision put to the user, by its task: Desktop's Tasks view on it (#40 D3). */
  | { kind: 'task'; id: string }
  /** A routine's page (routines mockup, card 15: « Voir »), by the machine that holds it and its id. */
  | { kind: 'routine'; machine: string; id: string };

/** 'opening' at once; then 'failed' when Ledge Desktop's window could not be shown. */
export type OpenOutcome = 'opening' | 'failed';
type Listener = (target: LedgeTarget, outcome: OpenOutcome) => void;
const listeners = new Set<Listener>();
const tell = (target: LedgeTarget, outcome: OpenOutcome) => { for (const listener of listeners) listener(target, outcome); };

/** Shows Ledge Desktop's window on the target (the same process: `open_in_ledge`) and tells the subscribers how it went. */
export function openInLedge(target: LedgeTarget): void {
  tell(target, 'opening');
  void openDesktop(JSON.stringify(target)).then(r => { if (r === 'failed') tell(target, r); });
}

/** Subscribe to openings. The returned function removes the subscription. */
export function subscribeOpenInLedge(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
