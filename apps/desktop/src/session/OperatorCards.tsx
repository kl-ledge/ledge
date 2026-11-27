import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { splitId, type DaemonClient } from '@ledge/fleet';
import { useOpenRigMissions } from '@ledge/fleet/openrigMissions';
import type { Exchange, Mission, MissionChild, Session } from '@ledge/protocol';
import { useI18n, type Lang } from '../i18n/lang';
import { cls } from '../shell/cls';
import { fmtDur, timeMark } from './exchanges';
import { nameOf, seatSession } from './RigItems';
import { Card } from './SideCard';
import '../styles/operator-cards.css';

/**
 * #54: the kernel operator's thread, « Missions » then « Échanges », in the « Résumé de la session » column
 * (docs/mockups/ledge-operator-rigs-panel.html, Missions in version C). What OpenRig keeps, read by the daemon (openrig.missions).
 * The texts the mockup does not show (states, delivery, variants) are in t…q54, validated by the owner (« AA Oui »).
 */

/** The kernel's operator seat (`operator.agent`): only its thread carries the two cards. */
export const isOperatorThread = (s: Session): boolean => s.rig?.role === 'operator.agent' && (s.rig.seat.split('@')[1] ?? '') === 'kernel';

type Filter = 'all' | 'messages' | 'handoffs';
const KERNEL = 'kernel';

/** A seat as the thread names it: its Ledge session's name, else its seat. */
function useSeatName(machine: string): (address: string) => string {
  return (address: string) => nameOf(address, seatSession(address, machine));
}

/** How long since `at`, in whole minutes past the first (« 34 min », « 1 h 31 »). */
const age = (at: string, now: number, lang: Lang): string => fmtDur(Math.max(60_000, Math.floor((now - Date.parse(at)) / 60_000) * 60_000), lang);

export function OperatorCards({ client, session, now }: { client: DaemonClient; session: Session; now: number }): JSX.Element | null {
  const machine = splitId(session.id)?.machine ?? 'local';
  const { read, error, older } = useOpenRigMissions(client, machine);
  // A daemon that predates #54, or a machine gone: no card rather than an empty one that would read as « nothing ».
  if (error === 'outdated' || (!read && error === 'offline')) return null;
  if (!read) return null;
  return (
    <>
      <MissionsCard read={read} machine={machine} now={now} />
      <ExchangesCard read={read} machine={machine} now={now} onOlder={older} />
    </>
  );
}

type Read = NonNullable<ReturnType<typeof useOpenRigMissions>['read']>;

function MissionsCard({ read, machine, now }: { read: Read; machine: string; now: number }): JSX.Element {
  const { t } = useI18n();
  const q = t.session.thread.q54;
  const body: ReactNode = read.openrig !== 'ok' ? <p className="oc-note">{q.openrig[read.openrig]}</p>
    : read.operator === null ? <p className="oc-note">{q.noOperator}</p>
    : read.missions.length === 0 && !read.partial ? <p className="oc-note">{q.noMission}</p>
    : read.missions.map(m => <MissionRow key={m.rootQitemId} m={m} machine={machine} now={now} />);
  return (
    <Card title={t.session.thread.missions.title} count={read.openrig === 'ok' && read.operator !== null ? String(read.missions.length) : undefined}>
      <div className="oc-body">
        {read.openrig === 'ok' && read.partial && <p className="oc-warn" role="status">{q.partial}</p>}
        {body}
      </div>
    </Card>
  );
}

function MissionRow({ m, machine, now }: { m: Mission; machine: string; now: number }): JSX.Element {
  const { t, lang } = useI18n();
  const tm = t.session.thread.missions, q = t.session.thread.q54;
  const name = useSeatName(machine);
  const wait = m.waitsOn === null ? (m.state === 'in-progress' ? tm.working : null)
    : m.waitsOn.kind === 'external' ? q.waitsExternal(m.waitsOn.text)
    : m.waitsOn.title === null ? q.waitsUnreadable
    : tm.waits(m.waitsOn.title, name(m.waitsOn.holder ?? ''));
  const pill = m.state === 'blocked' ? 'blk' : m.state === 'in-progress' ? 'run' : 'wait';
  return (
    <div className="oc-mis">
      <div className="oc-mm">
        <span className={cls('oc-pill', pill)}>{m.state === 'blocked' ? q.blocked : tm.state[m.state]}</span>
        <span>{tm.since(timeMark(m.since, now, lang))}</span>
        <span className="oc-rt">{m.rig}</span>
      </div>
      <div className="oc-mt">
        {m.title}
        {m.partial && <span className="oc-partial" title={q.missionPartial} aria-label={q.missionPartial}>⚠</span>}
      </div>
      <div className="oc-mm"><span><b>{name(m.from)}</b> → <b>{name(m.to)}</b>{wait && <> · {wait}</>}</span></div>
      {m.lastNote && <div className="oc-mm oc-last"><span>{timeMark(m.lastNote.at, now, lang)} · « {m.lastNote.text} »</span></div>}
      {(m.children.length > 0 || m.closed.count > 0) && (
        <div className="oc-steps">
          {m.children.map(c => <ChildRow key={c.qitemId} c={c} machine={machine} now={now} />)}
          {m.closed.count > 0 && (
            <div className="oc-stp d">
              <span className="oc-m" aria-hidden="true">✓</span>
              <span className="oc-s"><b>{tm.closed(m.closed.count)}</b>{m.closed.titles.length > 0 && <> · {m.closed.titles.join(', ')}</>}</span>
              <span className="oc-tm" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChildRow({ c, machine, now }: { c: MissionChild; machine: string; now: number }): JSX.Element {
  const { lang } = useI18n();
  const name = useSeatName(machine);
  return (
    <div className={cls('oc-stp', c.state === 'blocked' ? 'b' : c.state === 'in-progress' ? 'r' : 'p')}>
      <span className="oc-m" aria-hidden="true" />
      <span className="oc-s"><b>{c.title}</b> · {name(c.holder)}</span>
      <span className="oc-tm">{age(c.since, now, lang)}</span>
    </div>
  );
}

const MESSAGE = <svg className="oc-gl" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="M2.5 4.5 8 9l5.5-4.5" /></svg>;
const HAND = <svg className="oc-gl" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>;
const DONE = <svg className="oc-gl" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;
const WARN = <svg className="oc-gl" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3" /></svg>;

/** The rigs of an entry that tell something: the kernel (the operator's own) is always obvious. */
const rigsOf = (e: Exchange): string[] => e.rigs.filter(r => r && r !== KERNEL);

function ExchangesCard({ read, machine, now, onOlder }: { read: Read; machine: string; now: number; onOlder(): void }): JSX.Element {
  const { t } = useI18n();
  const tx = t.session.thread.exchanges, q = t.session.thread.q54;
  const [filter, setFilter] = useState<Filter>('all');
  const [rig, setRig] = useState('');
  const rigs = useMemo(() => [...new Set(read.exchanges.flatMap(rigsOf))].sort(), [read.exchanges]);
  // The rig most entries are about goes without saying; another one is tagged (« le rig quand ce n'est pas évident »).
  const usual = useMemo(() => {
    const n = new Map<string, number>();
    for (const e of read.exchanges) for (const r of rigsOf(e)) n.set(r, (n.get(r) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [read.exchanges]);
  const shown = read.exchanges.filter(e => (filter === 'all' || (filter === 'messages') === (e.kind === 'message')) && (!rig || e.rigs.includes(rig)));
  const filtered = filter !== 'all' || rig !== '';
  const body: ReactNode = read.openrig !== 'ok' ? <p className="oc-note">{q.openrig[read.openrig]}</p>
    : shown.length > 0 ? shown.map(e => <ExchangeRow key={e.id} e={e} machine={machine} now={now} usual={usual} />)
    : read.partial ? null
    : <p className="oc-note">{filtered && read.exchanges.length > 0 ? q.noMatch : q.noExchange}</p>;
  return (
    <Card title={tx.title} count={read.openrig === 'ok' ? String(shown.length) : undefined}>
      <div className="oc-body">
        {read.openrig === 'ok' && (
          <div className="oc-filters" role="group" aria-label={tx.title}>
            {(['all', 'messages', 'handoffs'] as const).map(f => (
              <button key={f} type="button" className={cls('oc-chip', filter === f && 'on')} aria-pressed={filter === f} onClick={() => setFilter(f)}>{tx[f]}</button>
            ))}
            {rigs.length > 0 && (
              <select className={cls('oc-chip', rig && 'on')} value={rig} aria-label={tx.rig} onChange={e => setRig(e.target.value)}>
                <option value="">{tx.rig}</option>
                {rigs.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            )}
          </div>
        )}
        {read.openrig === 'ok' && read.partial && <p className="oc-warn" role="status">{q.partial}</p>}
        {body}
        {read.openrig === 'ok' && read.exchangesMore && <button type="button" className="oc-older" onClick={onOlder}>{tx.older}</button>}
      </div>
    </Card>
  );
}

function ExchangeRow({ e, machine, now, usual }: { e: Exchange; machine: string; now: number; usual: string | null }): JSX.Element {
  const { t, lang } = useI18n();
  const tx = t.session.thread.exchanges, q = t.session.thread.q54;
  const name = useSeatName(machine);
  const to = (list: readonly string[]): ReactNode => {
    const names = list.map(name);
    const head = names.slice(0, 3);
    return <>{head.map((n, i) => <span key={i}>{i > 0 && ', '}<b>{n}</b></span>)}{names.length > 3 && ` ${q.more(names.length - 3)}`}</>;
  };
  const tag = rigsOf(e).find(r => r !== usual);
  const who: ReactNode = e.kind === 'message' ? <><b>{name(e.from)}</b> → {to(e.to)}</>
    : e.kind === 'given' ? <><b>{name(e.from)}</b> {tx.given} {to(e.to)}</>
    : e.kind === 'handed' ? <><b>{name(e.from)}</b> {tx.handed} {to(e.to)}</>
    : e.kind === 'blocked' ? (e.to.length > 0 ? <><b>{name(e.from)}</b> {tx.blocksOn} {to(e.to)}</> : <><b>{name(e.from)}</b> {q.blocks}</>)
    : <><b>{name(e.from)}</b> {e.outcome && e.outcome !== 'done' ? q.outcome[e.outcome] : tx.done}</>;
  const glyph = e.kind === 'message' ? MESSAGE : e.kind === 'blocked' ? WARN : e.kind === 'done' ? DONE : HAND;
  const d = e.delivery ? q.delivery[e.delivery] : undefined;
  return (
    <div className={cls('oc-ev', (e.kind === 'given' || e.kind === 'handed') && 'hand', e.kind === 'blocked' && 'warn', e.outcome === 'failed' && 'fail')}>
      {glyph}
      <span className="oc-w">{who}{e.urgent && <span className="oc-pill u">{q.urgent}</span>}{tag && <span className="oc-rt">{tag}</span>}</span>
      <span className="oc-tm">{timeMark(e.at, now, lang)}</span>
      <span className={cls('oc-x', e.kind === 'done' && 'q', d && 'with-dl')}>{e.text}</span>
      {d && e.delivery && <span className={cls('oc-dl', e.delivery)} title={d.hint}>{d.mark} {d.word}</span>}
    </div>
  );
}
