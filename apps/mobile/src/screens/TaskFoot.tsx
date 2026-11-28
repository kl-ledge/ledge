import { useEffect, useId, useState, type ReactNode } from 'react';
import type { PhoneSession, PhoneTask } from '@ledge/protocol';
import { copy } from '../copy';
import { openDecisions } from '../model/tasks';
import { href } from '../router';
import { useMobile, type MobileStore } from '../state/store';
import { buttonClass } from '../ui/Button';
import { NoteProposal } from './cards/NoteProposal';
import { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { Tag } from '../ui/Tag';
import { usePlatform } from './device';

const full = (variant?: 'primary') => buttonClass({ variant, block: true });
/** How long « Réponse envoyée à {n}. » stays before the foot closes (card 1). */
export const SENT_MS = 3000;

/** What a session put to Ledge and still waits on the person, oldest first: its decisions and its proposals about the notes. */
export const askedBy = (tasks: Iterable<PhoneTask>, sessionId: string): PhoneTask[] => openDecisions(tasks).filter(t => t.giver === sessionId);

/**
 * The foot of a session's thread while it waits on the person (#40 D2, docs/mockups/ledge-remove-chat-p2.html, cards 1 and 2): one
 * decision or proposal about the notes at a time, the oldest first, « 1 sur 2 » when there are more. A decision takes a written
 * answer, sent with `task.answer` under the device's check; a proposal keeps its buttons (Ajouter · Modifier · Refuser). Without a
 * passkey, it says so and leads to Réglages; offline, nothing is sent nor queued; one handled elsewhere says so.
 */
export function TaskFoot({ store, session, tasks, sent, onSent }: {
  store: MobileStore; session: PhoneSession; tasks: readonly PhoneTask[];
  /** The decision just answered: its receipt shows for SENT_MS, even once the decision left the list; the thread holds it. */
  sent: string | null; onSent: (task: string | null) => void;
}) {
  const state = useMobile(store);
  const platform = usePlatform();
  const D = copy.decide;
  const P = copy.cards;
  const id = useId();
  const setSent = onSent;
  useEffect(() => {
    if (sent === null) return;
    const t = setTimeout(() => onSent(null), SENT_MS);
    return () => clearTimeout(t);
  }, [sent, onSent]);
  const task = tasks[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'stale' | 'failed' | 'cancelled' | 'expired' | null>(null);
  useEffect(() => { setText(''); setError(null); }, [task?.id]);
  const shown = sent ?? task?.id;
  if (!shown) return null;
  const name = task?.giverName ?? session.name;
  const head = (tag: string, words: string) => (
    <span className="flex flex-wrap items-center gap-1.5 text-body">
      <Tag tone="attention" label={tag} />
      <span className="font-medium">{name}</span><span className="text-muted">{words}</span>
      {tasks.length > 1 && !sent && <span className="ml-auto text-small text-muted">{D.ofN(1, tasks.length)}</span>}
    </span>
  );
  const frame = (children: ReactNode) => (
    <footer aria-label={P.decision} className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg pt-3 pb-4">{children}</footer>
  );
  const keyless = !(state.device?.confirm === true && platform);
  const noKey = <>
    <Notice title={P.note.confirmRequired} tone="warning" role="alert" />
    <a href={href({ name: 'connection' })} className={full()}>{D.openSettings}</a>
  </>;
  const offline = !state.fresh && <Notice title={D.offlineHint} tone="warning" role="status" />;

  if (sent !== null) {
    const was = state.tasks.get(sent);
    return frame(<>
      {head(P.decision, P.asks)}
      {was && <b className="text-title font-semibold">{was.title}</b>}
      <p role="status" className="flex items-center gap-2 rounded-control border border-ok/40 px-3 py-2.5 text-body"><Icon name="check" className="size-4 text-ok" />{D.sent(was?.giverName ?? name)}</p>
    </>);
  }
  if (!task) return null;

  if (task.brain) {
    const note = task as PhoneTask & { brain: NonNullable<PhoneTask['brain']> };
    if (keyless) {
      const p = note.brain;
      return frame(<>
        {head(P.note.tag, p.kind === 'flag' ? P.note.flag(p.note) : p.create ? P.note.create(p.note) : P.note.add(p.note))}
        <p className="text-body">« {p.fact} »</p>
        {p.source && <span className="text-small text-muted">{P.note.source(p.source)}</span>}
        {noKey}
      </>);
    }
    return frame(<>
      {tasks.length > 1 && <span className="self-end text-small text-muted">{D.ofN(1, tasks.length)}</span>}
      <NoteProposal key={task.id} task={note} store={store} fresh={state.fresh} />
      {offline || <p className="text-center text-meta text-muted">{copy.sessionEnd.check}</p>}
    </>);
  }

  const send = async () => {
    const answer = text.trim();
    if (!answer || busy) return;
    setBusy(true); setError(null);
    const r = await store.answerTask(task.id, answer);
    setBusy(false);
    if (r.status === 'applied') { setSent(task.id); return; }
    setError(r.status === 'rejected' && (r.reason === 'stale' || r.reason === 'not_found') ? 'stale'
      : r.status === 'cancelled' ? 'cancelled' : r.status === 'expired' ? 'expired' : 'failed');
  };
  const problem = error === 'stale' ? <Notice title={copy.gone.titleElsewhere} tone="warning" role="alert" />
    : error ? <Notice title={error === 'cancelled' ? copy.confirm.cancelled : error === 'expired' ? copy.confirm.expired : P.note.failed} tone="warning" role="alert" />
    : null;
  return frame(<>
    {head(P.decision, P.asks)}
    <b className="text-title font-semibold">{task.title}</b>
    {task.text && <p className="text-body whitespace-pre-wrap text-muted">{task.text}</p>}
    {keyless ? noKey : error === 'stale' ? problem : <>
      <label htmlFor={id} className="sr-only">{P.answerLabel(task.title)}</label>
      <textarea id={id} rows={2} value={text} disabled={busy || !state.fresh} placeholder={copy.cards.answerPlaceholder} onChange={e => setText(e.target.value)}
        className="w-full resize-none rounded-control border border-line bg-surface px-3 py-2.5 text-body text-fg" />
      {problem}
      {offline}
      <button type="button" disabled={busy || !state.fresh || !text.trim()} onClick={() => { void send(); }} className={full('primary')}>{D.send}</button>
      {!offline && <p className="text-center text-meta text-muted">{copy.sessionEnd.check}</p>}
    </>}
  </>);
}
