import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenRigMissionsChanged } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** « Échanges »: how many entries are asked first, and how many more « Voir plus ancien » adds (the daemon's bound is 500). */
export const EXCHANGES_FIRST = 50;
export const EXCHANGES_STEP = 50;
export const EXCHANGES_MOST = 500;

type Read = Omit<OpenRigMissionsChanged, 'type' | 'requestId' | 'machineId' | 'error'>;
export interface OpenRigMissionsView {
  /** The daemon's last read; null before the first answer. */
  read: Read | null;
  /** The machine could not answer: `offline`, or `outdated` (its Ledge daemon predates #54). */
  error?: 'offline' | 'outdated';
  /** What is shown is an older read: the machine answered `offline` after it, or the connection is not open. */
  stale: boolean;
  /** « Voir plus ancien »: asks for more entries. */
  older(): void;
}

let next = 0;

/** The machine can answer: through a fleet, its own connection is ready; otherwise the client's is open. */
function up(client: DaemonClient, machine: string | null): boolean {
  if (client.status() !== 'open') return false;
  const m = client.fleet?.machines().find(x => x.id === (machine ?? 'local'));
  return client.fleet ? m?.ready === true : true;
}

/** The operator thread's « Missions » and « Échanges » on one machine (#54): asked when shown, again when the connection comes back,
 *  taken whole from every push. Null machine: nothing asked. */
export function useOpenRigMissions(client: DaemonClient, machine: string | null): OpenRigMissionsView {
  const [state, setState] = useState<{ machine: string | null; read: Read | null; error?: 'offline' | 'outdated' }>({ machine, read: null });
  const [want, setWant] = useState(EXCHANGES_FIRST);
  const [open, setOpen] = useState(() => up(client, machine));
  const asked = useRef<string | null>(null);

  const ask = useCallback((exchanges: number) => {
    if (machine === null) return;
    const requestId = `openrig-missions-${++next}`;
    asked.current = requestId;
    client.send({ type: 'openrig.missions', requestId, machineId: machine, exchanges });
  }, [client, machine]);

  useEffect(() => {
    setState({ machine, read: null });
    setWant(EXCHANGES_FIRST);
    if (machine === null) return;
    const off = client.onMessage(m => {
      if (m.type !== 'openrig.missionsChanged' || (m.machineId ?? 'local') !== machine) return;
      if (m.requestId !== undefined && m.requestId !== asked.current) return;
      const { type: _t, requestId: _r, machineId: _m, error, ...read } = m;
      setState(s => (error ? { ...s, machine, error } : { machine, read }));
    });
    return off;
  }, [client, machine]);

  // Asked at once with what « Échanges » wants, and again whenever the machine comes back.
  useEffect(() => {
    if (machine === null) return;
    ask(want);
    let was = up(client, machine);
    setOpen(was);
    const check = () => {
      const now = up(client, machine);
      if (now !== was) { was = now; setOpen(now); if (now) ask(want); }
    };
    const offStatus = client.onStatus(check);
    const offFleet = client.fleet?.subscribe(check);
    return () => { offStatus(); offFleet?.(); };
  }, [client, machine, want, ask]);

  const older = useCallback(() => setWant(w => Math.min(EXCHANGES_MOST, w + EXCHANGES_STEP)), []);
  const read = state.machine === machine ? state.read : null;
  const error = state.machine === machine ? state.error : undefined;
  return { read, ...(error ? { error } : {}), stale: read !== null && (error === 'offline' || !open), older };
}
