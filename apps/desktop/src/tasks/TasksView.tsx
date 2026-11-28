import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { LEDGE_GIVER, openDecision, taskClosed, type Task } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import { ReportDecision } from '../report/ReportDecision';
import type { TasksApi } from './useTasksApi';
import { NoteDecision } from './NoteDecision';
import { DecisionAnswer } from './DecisionAnswer';
import '../styles/rtabs.css';

/** Where the local daemon stands for these lists, which only come from its state: before its first state, gone, or there. */
export type ListState = 'connecting' | 'offline' | 'ready';

type StateFilter = 'all' | 'open' | 'closed';
type GiverFilter = 'all' | 'ledge' | 'sessions' | 'decisions';
/** Who a task comes from: Ledge, a session for another, or a session asking the user (a decision, owner Ledge). */
const giverOf = (x: Task): Exclude<GiverFilter, 'all'> => x.owner === LEDGE_GIVER ? 'decisions' : x.giver === LEDGE_GIVER ? 'ledge' : 'sessions';
// « 13:58 » in both languages, as the mockup: a 12-hour « 01:58 PM » would not fit the history's 40 px column.
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** A row's mark: a decision awaited from the user, then done, refused or dropped, else open. */
const markOf = (x: Task): ['asked' | 'done' | 'bad' | 'open', string] =>
  openDecision(x) ? ['asked', '?'] : x.state === 'done' ? ['done', '✓'] : x.state === 'refused' || x.state === 'dropped' ? ['bad', '!'] : ['open', '○'];

/** The tasks the view lists and counts: all but a routine's request, which Routines answers (its buttons are routine.cmd, not
 *  task.cmd's « Répondre », and the daemon titles it in French only). */
export const shownTasks = (tasks: readonly Task[]): Task[] => tasks.filter(x => !x.routine);
/** The Tasks icon's amber badge (#40 D7): the decisions waiting for the user, an agent's report (D5) among them. */
export const tasksBadge = (tasks: readonly Task[]): number => shownTasks(tasks).filter(openDecision).length;

/** « Connexion… » before the local daemon's first state: in place of the list, no skeleton. */
export function Connecting(): JSX.Element {
  const { t } = useI18n();
  return <div className="rt-empty" role="status"><span className="rt-spin" aria-hidden="true" />{t.tasks.connecting}</div>;
}
/** The local daemon is gone: the last list stays, dimmed, under this banner. */
export function OfflineBanner(): JSX.Element {
  const { t } = useI18n();
  return <div className="rt-banner" role="status"><span className="rt-dot" aria-hidden="true" />{t.tasks.offline}</div>;
}

/** What the report card (issue #9) needs to answer an agent's report from its detail (#40 D5). */
export interface ReportHandlers { client: DaemonClient; desktop: string | null; onEdit(task: string): void; onCreated(n: number, url: string | undefined): void; onOpenUrl(url: string): void }

/**
 * The list and a task's detail (the chat's « Tâches » tab of before, docs/mockups/ledge-ide-tasks-history.html): two filters,
 * the latest first; a click opens the task in place of the list, « ‹ Tâches » (and Escape) brings the list back at the same place
 * with its filters. An agent's report (#40 D5) is a decision whose detail is its report card.
 */
export function TasksPane({ api, task, seen, state, onShow, report }: { api: TasksApi; task: string | null; seen: number; state: ListState; onShow(id: string | null): void; report?: ReportHandlers }): JSX.Element {
  const { t } = useI18n();
  const tasks = shownTasks(api.tasks);
  const c = t.tasks;
  const [filter, setFilter] = useState<StateFilter>('all');
  const [giver, setGiver] = useState<GiverFilter>('all');
  const [answering, setAnswering] = useState<string | null>(null);
  // A « Voir dans Tâches » from elsewhere: the filters back to All / Anyone (the first render keeps the defaults anyway).
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setFilter('all'); setGiver('all'); }, [seen]);
  // The list's scroll, kept while a detail replaces it, and given back on the way back.
  const listRef = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const detail = task ? tasks.find(x => x.id === task) : undefined;
  useLayoutEffect(() => { if (!detail && listRef.current) listRef.current.scrollTop = scroll.current; }, [detail]);
  useEffect(() => { setAnswering(null); }, [task]);
  // The detail takes the focus on its way in (the row clicked is gone with the list): Escape brings the list back.
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (detail) backRef.current?.focus({ preventScroll: true }); }, [detail?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const offline = state === 'offline';
  if (state === 'connecting') return <Connecting />;

  if (detail) {
    const asked = openDecision(detail);
    const r = detail.report;
    return (
      <section className="rt-detail" aria-label={detail.title}>
        {offline && <OfflineBanner />}
        <button ref={backRef} type="button" className="rt-back" onClick={() => onShow(null)}>‹ {c.back}</button>
        <h3><code>{detail.id}</code> · {detail.title}</h3>
        <span className="rt-meta">{asked ? t.decision.asks(detail.giverName) : `${c.from(detail.giverName, detail.ownerName)} · ${t.tasks.state[detail.state]}`}</span>
        {detail.text && !r && <div className="rt-txt">{detail.text}</div>}
        {detail.result && <div><b>{detail.state === 'done' ? c.result : c.reason} :</b> {detail.result}</div>}
        {asked && r && report && <ReportDecision task={{ ...detail, report: r }} {...report} />}
        {asked && !r && detail.brain && <NoteDecision task={{ ...detail, brain: detail.brain }} api={api} />}
        {asked && !r && !detail.brain && (answering === detail.id && !offline
          ? <DecisionAnswer task={detail} api={api} onClose={() => setAnswering(null)} />
          : <button type="button" className="rt-btn pri" disabled={offline} onClick={() => setAnswering(detail.id)}>{t.decision.answer}</button>)}
        <h4>{c.log}</h4>
        <ul className="rt-log">{detail.log.map((l, i) => <li key={i}><small>{clock(l.at)}</small>{l.by} : {l.what}</li>)}</ul>
      </section>
    );
  }

  const list = tasks.filter(x => (filter === 'all' || (filter === 'open') !== taskClosed(x)) && (giver === 'all' || giver === giverOf(x))).slice().reverse();
  const open = (id: string) => { scroll.current = listRef.current?.scrollTop ?? 0; onShow(id); };
  return (
    <div className="rt-pane" aria-label={c.back}>
      {offline && <OfflineBanner />}
      <div className="rt-filters" role="group" aria-label={c.filters}>
        <select aria-label={c.filters} value={filter} onChange={e => setFilter(e.target.value as StateFilter)}>
          <option value="all">{c.all}</option><option value="open">{c.open}</option><option value="closed">{c.closed}</option>
        </select>
        <select aria-label={c.giver} value={giver} onChange={e => setGiver(e.target.value as GiverFilter)}>
          <option value="all">{c.anyGiver}</option><option value="ledge">{c.ledge}</option><option value="sessions">{c.sessions}</option><option value="decisions">{c.decisions}</option>
        </select>
      </div>
      {tasks.length === 0 ? <div className="rt-empty">{c.none}</div>
        : list.length === 0 ? <div className="rt-empty">{c.noneFiltered}<button type="button" className="rt-btn" onClick={() => { setFilter('all'); setGiver('all'); }}>{c.clearFilters}</button></div>
          : (
            <div ref={listRef} className={cls('rt-list', offline && 'dim')}>
              {list.map(x => {
                const [k, m] = markOf(x);
                return (
                  <button key={x.id} type="button" className="rt-trow" data-task={x.id} onClick={() => open(x.id)}>
                    <span className={`mk ${k}`} aria-hidden="true">{m}</span>
                    <b>{x.title}</b>
                    <small><code>{x.id}</code> · {x.report && k === 'asked'
                      ? <>{x.giverName} · <span className="rt-pill">{t.report.pill}</span></>
                      : <>{c.from(x.giverName, x.ownerName)} · {k === 'asked' ? t.asks.pill.decision : t.tasks.state[x.state]}</>}</small>
                  </button>
                );
              })}
            </div>
          )}
    </div>
  );
}

/**
 * « Tâches » as a view of the activity bar (#40 D3, docs/mockups/ledge-remove-chat-d1-d3-d6.html, cards 5 and 6): the title and
 * the open tasks counted, then TasksPane. Escape on a task's detail brings the list back.
 */
export function TasksView({ api, task, seen, state, onShow, report }: Parameters<typeof TasksPane>[0]): JSX.Element {
  const { t } = useI18n();
  const open = shownTasks(api.tasks).filter(x => !taskClosed(x)).length;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing || !task) return;
    e.preventDefault(); e.stopPropagation(); onShow(null);
  };
  return (
    <aside className="ide-tasks" aria-label={t.tasks.back} onKeyDown={onKey}>
      <div className="ide-tasks-h"><span>{t.tasks.back}</span><small>{t.ide.tasksOpen(open)}</small></div>
      <div className="ide-tasks-b">
        <TasksPane api={api} task={task} seen={seen} state={state} onShow={onShow} {...(report ? { report } : {})} />
      </div>
    </aside>
  );
}
