import { useEffect, useMemo, useRef, useState } from 'react';
import type { OpenRigAnswered, OperatorNotice, Session } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '../daemon/client';
import { LOCAL_MACHINE, useMachines, useOperatorNotices, useTasks } from '../daemon/machines';
import { openInLedge } from '../desktop/openInLedge';
import { routineNotice } from '../routines';
import type { Messages } from '../i18n/lang';
import { useRoutines } from './useRoutines';
import { LEDGE_PREFIX, type Item, type SurfaceEvent } from './machine';
import type { Card } from './Island';

/** One of Ledge's notices as the island holds it: its key in the queue, the machine that sent it, the notice itself. */
interface LedgeNotice { key: string; machine: string; notice: OperatorNotice }

/** How long a rig answer waits for its end before it is told `uncertain` (the fleet's « À toi » waits as long). */
export const OPENRIG_ANSWER_WAIT_MS = 45_000;
let nextAnswer = 0;
/** A rig's question the island answers with its buttons: through OpenRig (`questionId`, #40) or, from a daemon before #40, the point
 *  holding it (`qid`). */
/** A rig's question is answered through `openrig.answer`, which needs its `questionId` (#40): a daemon from before #40 sends none, and its
 *  question only opens Desktop's Rigs view. */
const answerable = (n: OperatorNotice): boolean => !!n.qitem && !!n.options?.length && !!n.questionId;

/** The id under which a machine that dropped waits as a notice. */
export const offlineId = (machine: string) => `machine:${machine}`;

/**
 * Ledge's own notices on the island (dynamic-island complement, cards #ledge): a rig's question, a decision a session put to
 * the person, a routine to activate or that could not run (requests, in the island's queue under `ledge:<machine>|<id>`), and
 * a machine that dropped (a 6 s notice). « Le point » stays in Ledge Desktop's chat: it never reaches the island.
 * The words, the buttons and the daemon commands are the notch's of before (routines through `routine.cmd`, an approval bound to the
 * key it was shown with). A rig's question is answered through OpenRig's own `openrig.answer` (#40 D1).
 */
export function useLedgeNotices(o: {
  client: DaemonClient; dispatch: (e: SurfaceEvent) => void; byId: Map<string, Session>; status: DaemonStatus;
  t: Messages; dnd: boolean; visible: boolean; onAnswered: (cue: 'accept' | 'deny') => void;
}) {
  const { client, dispatch, byId, t } = o;
  const machines = useMachines(client);
  const byMachine = useOperatorNotices(client);
  const tasks = useTasks(client);
  const routines = useRoutines(client);
  // Every machine's notices but the point, oldest first, each keyed by its machine so two daemons never collide.
  const notices = useMemo(() => {
    const all: LedgeNotice[] = [];
    for (const [machine, list] of byMachine) for (const notice of list) if (notice.kind !== 'point') all.push({ key: `${LEDGE_PREFIX}${machine}|${notice.id}`, machine, notice });
    return all.sort((a, b) => a.notice.at.localeCompare(b.notice.at));
  }, [byMachine]);
  /** Notices answered here: out of the island until the daemon's next notices settle them. */
  const [aside, setAsideSet] = useState<ReadonlySet<string>>(() => new Set());
  const setAside = (key: string, on: boolean) => setAsideSet(x => { if (x.has(key) === on) return x; const next = new Set(x); if (on) next.add(key); else next.delete(key); return next; });
  // A key the daemon no longer lists is forgotten, so a later notice with the same id speaks again.
  useEffect(() => { setAsideSet(x => { const live = new Set(notices.map(n => n.key)); const next = new Set([...x].filter(k => live.has(k))); return next.size === x.size ? x : next; }); }, [notices]);

  // Each notice that comes joins the queue; one the daemon settled, or answered here, leaves it (« Reçu » when it was ours).
  const shown = useRef<Set<string>>(new Set());
  /** Answers the daemon refused: the question comes back where it was, at the head of the line. */
  const back = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(notices.filter(n => !aside.has(n.key)).map(n => n.key));
    for (const k of now) if (!shown.current.has(k)) dispatch({ type: 'ask', id: k, ...(back.current.delete(k) ? { first: true } : {}) });
    for (const k of shown.current) if (!now.has(k)) dispatch({ type: 'askCleared', id: k });
    shown.current = now;
  }, [notices, aside, dispatch]);

  // A machine that drops is a 6 s notice; coming back removes it. Nothing during Do not disturb or while hidden.
  const ready = useRef<Map<string, boolean>>(new Map());
  const live = useRef({ dnd: o.dnd, visible: o.visible }); live.current = { dnd: o.dnd, visible: o.visible };
  useEffect(() => {
    for (const m of machines) {
      const was = ready.current.get(m.id);
      if (was === true && !m.ready && !live.current.dnd && live.current.visible) dispatch({ type: 'notice', id: offlineId(m.id), kind: 'offline' });
      if (was === false && m.ready) dispatch({ type: 'removed', id: offlineId(m.id) });
      ready.current.set(m.id, m.ready);
    }
  }, [machines, dispatch]);

  const find = (key: string) => notices.find(n => n.key === key);
  const routineOf = (n: LedgeNotice) => {
    // A decision that is a routine's request (routines mockup, cards 15 and 23): its task is the local daemon's.
    const task = n.notice.kind === 'decision' && n.machine === LOCAL_MACHINE.id ? tasks.find(x => `decision:${x.id}` === n.notice.id) : undefined;
    return { task, routine: routineNotice(n.notice, n.machine, task, routines, t) };
  };
  const clock = (at: string) => new Date(at).toLocaleTimeString(t.time.locale, { hour: '2-digit', minute: '2-digit', hour12: false });

  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [stale, setStale] = useState<{ key: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** What the island says of a Ledge item, or null when it is gone. */
  function card(item: Item): Card | null {
    const L = t.ledge;
    if (item.kind === 'offline') {
      const m = machines.find(x => offlineId(x.id) === item.id);
      return { id: item.id, kind: 'offline', who: m?.label ?? L.offline, sentence: m?.label ?? L.offline, bold: m?.label, meta: L.offlineSub };
    }
    const n = find(item.id); if (!n) return null;
    const who = n.notice.who ?? 'Ledge';
    if (n.notice.kind === 'rig.ask') return {
      id: item.id, kind: 'rig', who, sentence: `${who}${L.colon}${L.rigQuote(n.notice.text)}`, bold: who,
      meta: [n.notice.rig, clock(n.notice.at)].filter(Boolean).join(' · '), choices: answerable(n.notice) ? n.notice.options : undefined
    };
    const { task, routine } = routineOf(n);
    if (routine) return {
      id: item.id, kind: routine.kind === 'failed' ? 'routineFailed' : 'routine', who: routine.who, sentence: routine.text,
      bold: routine.kind === 'failed' ? routine.first.name : routine.who, meta: clock(n.notice.at),
      routine: { count: routine.ids.length, canApprove: routine.ids.every(id => !!routine.keys[id]), ...(stale?.key === item.id ? { stale: stale.message } : {}) }
    };
    const giver = task ? byId.get(task.giver) : undefined;
    return { id: item.id, kind: 'decision', who, sentence: `${who}${L.decisionAsks}`, bold: who, meta: giver ? [giver.project, giver.branch].filter(Boolean).join(' · ') : undefined };
  }

  /** « Voir », « Répondre dans Ledge », or a click on a machine offline: the item in Ledge Desktop. */
  function open(item: Item): void {
    if (item.kind === 'offline') { openInLedge({ kind: 'machines' }); return; }
    const n = find(item.id); if (!n) return;
    // #40: a rig's question opens Desktop's Rigs view on it, a decision its Tasks view on that task.
    if (n.notice.kind === 'rig.ask') { openInLedge(n.notice.qitem ? { kind: 'ask', id: n.notice.qitem } : { kind: 'requests' }); return; }
    const { routine } = routineOf(n);
    const task = n.notice.kind === 'decision' && n.notice.id.startsWith('decision:') ? n.notice.id.slice('decision:'.length) : null;
    if (routine) openInLedge({ kind: 'routine', machine: routine.machine, id: routine.first.id });
    else if (task) openInLedge({ kind: 'task', id: task });
  }

  /** The rig answers sent through `openrig.answer`, by requestId: each ends with its `openrig.answered`, or `uncertain` after
   *  OPENRIG_ANSWER_WAIT_MS or when the connection drops (sending it again is safe: OpenRig records an answer once). */
  const answers = useRef(new Map<string, { key: string; timer: ReturnType<typeof setTimeout> }>());
  /** A refused rig answer: the question comes back where it was, with the reason. */
  const refused = (key: string, message: string) => { back.current.add(key); setFailure({ key, message }); setAside(key, false); dispatch({ type: 'decisionFailed', id: key }); };
  const ended = (m: OpenRigAnswered) => {
    const w = answers.current.get(m.requestId); if (!w) return;
    answers.current.delete(m.requestId); clearTimeout(w.timer);
    // Taken, the row already closed (nothing left to answer), or no end heard (it may have gone: as through the point, which never
    // said a success): the question stays aside until the daemon's notices drop it. A refusal is said with the daemon's reason.
    if (m.ok || m.error === 'closed' || m.error === 'uncertain') return;
    refused(w.key, m.message ?? (m.error === 'offline' ? t.offline : m.error ?? ''));
  };
  const lost = () => { for (const [requestId] of [...answers.current]) ended({ type: 'openrig.answered', requestId, qitemId: '', ok: false, error: 'uncertain' }); };
  useEffect(() => {
    const off = client.onMessage(m => { if (m.type === 'openrig.answered') ended(m); });
    const offStatus = client.onStatus(s => { if (s !== 'open') lost(); });
    return () => { off(); offStatus(); for (const w of answers.current.values()) clearTimeout(w.timer); answers.current.clear(); };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps
  /** One of a rig question's proposed answers, through OpenRig's `openrig.answer` on its machine. */
  function choose(key: string, option: string): void {
    const n = find(key); if (!n || !answerable(n.notice)) return;
    const { qitem, questionId } = n.notice;
    const requestId = `island-answer-${++nextAnswer}`;
    answers.current.set(requestId, { key, timer: setTimeout(() => ended({ type: 'openrig.answered', requestId, qitemId: qitem!, ok: false, error: 'uncertain' }), OPENRIG_ANSWER_WAIT_MS) });
    client.send({ type: 'openrig.answer', requestId, machineId: n.machine, qitemId: qitem!, answer: { kind: 'choice', questionId: questionId!, optionId: option } });
    // Set aside at once, as the notch did: the notice leaves the daemon's list only once the rig settles the question.
    // « Reçu », then the island closes; a refusal brings it back.
    setFailure(null); dispatch({ type: 'decided' }); setAside(key, true); o.onAnswered('accept');
  }

  /** A routine item's button, answered on its machine: a grouped request in one command, all or nothing (`others`), only to a
   *  daemon that says it can (`routineGroups`); an approval names what the island showed (each routine's key). A success sets the
   *  notice aside (« Reçu »), a refusal says why. */
  async function routineAct(key: string, action: 'approve' | 'refuse' | 'run'): Promise<void> {
    const n = find(key); const r = n && routineOf(n).routine; const fleet = client.fleet;
    if (!n || !r || !fleet || busy) return;
    setBusy(key); setFailure(null); setStale(null);
    const fail = (message: string) => { setFailure({ key, message }); dispatch({ type: 'decisionFailed', id: key }); };
    try {
      const [head, ...rest] = action === 'run' ? [r.first.id] : r.ids;
      // A daemon that does not answer groups would drop `others` and answer the first routine alone: too old (card 33).
      if (rest.length && !machines.find(m => m.id === r.machine)?.daemon?.routineGroups) { fail(t.routine.groupTooOld); return; }
      dispatch({ type: 'decided' });
      // A refusal needs no key (refusing what changed is harmless): a member not read yet is still named, without one.
      const keyed = (id: string) => ({ routine: id, ...(r.keys[id] !== undefined ? { expect: r.keys[id] } : {}) });
      try {
        await fleet.routineCmd(r.machine, { op: action, routine: head!, ...(action === 'approve' ? { expect: r.keys[head!]! } : {}), ...(rest.length ? { others: rest.map(keyed) } : {}) });
      } catch (e) {
        // Changed since the island showed it (card 32): nothing activated, the routines read again to show the new version.
        if (action === 'approve' && (e as { code?: string }).code === 'stale') { fleet.rereadRoutines(r.machine); setStale({ key, message: t.routine.stale(r.first.name) }); dispatch({ type: 'decisionFailed', id: key }); return; }
        throw e;
      }
      setAside(key, true); o.onAnswered(action === 'refuse' ? 'deny' : 'accept');
    } catch (e) {
      // The island's own words for a machine down or too old; a daemon's refusal is said with its reason.
      const f = e as { code?: string; message?: string };
      fail(f.code === 'offline' ? t.offline : f.code === 'outdated' ? t.routine.tooOld : f.message ?? String(e));
    } finally { setBusy(null); }
  }

  /** Why a Ledge request cannot be answered from here: its machine is out of reach. */
  const blocked = (key: string): string | null => {
    const n = find(key);
    return n && client.fleet && !machines.find(m => m.id === n.machine)?.ready ? t.offline : null;
  };

  return {
    card, open, choose, blocked,
    routine: (key: string, action: 'approve' | 'refuse' | 'run') => { void routineAct(key, action); },
    failure: (key: string) => (failure?.key === key ? failure.message : null),
    busy: (key: string) => busy === key
  };
}
