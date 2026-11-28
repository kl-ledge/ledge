import { useEffect, useState, type CSSProperties } from 'react';
import { CONTEXT_NEAR, placeSessions, type PhoneRoutine, type PhoneSession } from '@ledge/protocol';
import { copy } from '../copy';
import { MOBILE_STORAGE_PREFIX } from '../link/keys';
import { routinesEntry, wokenSessions } from '../model/routines';
import { closingHere } from '../model/sessionEnd';
import { activeHelpers, contextPct, dotOf, filterCounts, GROUPINGS, rowLine, rowMeta, SESSION_FILTERS, sessionGroups, type Grouping, type KeptOrder, type SessionFilter, type SessionGroup } from '../model/sessions';
import { href, useRoute } from '../router';
import { TabPage } from '../shell/Shell';
import { localStore } from '../state/storage';
import { useMobile, type MobileStore } from '../state/store';
import { Icon } from '../ui/icons';
import { Box, EmptyState, Line } from '../ui/kit/Box';
import { kitButtonClass } from '../ui/kit/Controls';
import { Dot, Pill, RuntimeTag } from '../ui/kit/marks';
import { openDecisions } from '../model/tasks';
import { useWide } from '../ui/layout';
import { useNow } from '../useNow';
import { clock } from '../clock';
import { useLiftDrag, useLongPress } from './longPress';
import { SessionActions } from './SessionHead';
import { ProjectOrderSheet } from './SessionMore';
import { SessionsAtelier } from './SessionsAtelier';
import { SessionName } from '@ledge/ui/ui/SessionName';

/** The filter is kept on the device (m2-sessions.html, « Comportements »). */
const FILTER_KEY = `${MOBILE_STORAGE_PREFIX}sessions.filter`;
const isFilter = (v: unknown): v is SessionFilter => SESSION_FILTERS.includes(v as SessionFilter);

function useFilter(fromRoute: SessionFilter | undefined, storage?: Storage): [SessionFilter, (f: SessionFilter) => void] {
  const store = localStore(storage);
  const [filter, set] = useState<SessionFilter>(() => {
    if (fromRoute) return fromRoute;
    try { const v = store?.getItem(FILTER_KEY); return isFilter(v) ? v : 'all'; } catch { return 'all'; }
  });
  const choose = (f: SessionFilter) => {
    set(f);
    try { store?.setItem(FILTER_KEY, f); } catch { /* kept for this visit only */ }
  };
  // `#/sessions/working` opens the list on « Au travail », even when it is already shown.
  useEffect(() => { if (fromRoute) choose(fromRoute); }, [fromRoute]); // eslint-disable-line react-hooks/exhaustive-deps
  return [filter, choose];
}

/** A choice kept on the device (Comportements: the filter, Liste / Atelier; §7: the grouping and the eye). */
function useKept<T extends string>(key: string, values: readonly T[], fallback: T, storage?: Storage): [T, (v: T) => void] {
  const store = localStore(storage);
  const [value, set] = useState<T>(() => {
    try { const v = store?.getItem(`${MOBILE_STORAGE_PREFIX}${key}`); return values.includes(v as T) ? v as T : fallback; } catch { return fallback; }
  });
  const choose = (v: T) => { set(v); try { store?.setItem(`${MOBILE_STORAGE_PREFIX}${key}`, v); } catch { /* kept for this visit only */ } };
  return [value, choose];
}

type Mode = 'list' | 'atelier';
const MODES: readonly Mode[] = ['list', 'atelier'];

/** « Liste · Atelier » on the title's line, on a phone (§1, §7). */
function ModeToggle({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const M = copy.sessions.mode;
  return (
    <div role="group" aria-label={M.label} className="flex flex-none overflow-hidden rounded-lg border border-input">
      {MODES.map(m => (
        <button key={m} type="button" aria-pressed={m === value} onClick={() => onChange(m)}
          className="grid h-9 place-items-center px-3.5 text-[13px] font-medium text-muted aria-pressed:bg-raised aria-pressed:text-fg">
          {M[m]}
        </button>
      ))}
    </div>
  );
}

/** « Toutes · En attente · Au travail », each with its count, across the list's width (§1). */
function FilterBar({ value, counts, onChange }: { value: SessionFilter; counts: Record<SessionFilter, number>; onChange: (f: SessionFilter) => void }) {
  const F = copy.sessions.filter;
  return (
    <div role="group" aria-label={F.label} className="flex flex-none rounded-lg border border-input p-0.5">
      {SESSION_FILTERS.map(f => (
        <button
          key={f} type="button" aria-pressed={f === value} onClick={() => onChange(f)}
          className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap text-muted aria-pressed:bg-raised aria-pressed:text-fg"
        >
          {F[f]}<span className="font-mono text-meta">{counts[f]}</span>
        </button>
      ))}
    </div>
  );
}

/** One session (§1): its dot, runtime, name and sub-agents at work, what it does or waits for, its branch or seat role; the small
 *  clock when a routine wakes it (docs/mockups/ledge-routines.html, card 17). */
function Row({ session: s, filter, offline, threshold, now, closing, pressed, onPress, woken, decision = false, drag }: { session: PhoneSession; filter: SessionFilter; offline: boolean; threshold: number; now: number; closing: boolean; pressed: boolean; onPress: (s: PhoneSession) => void; woken: boolean;
  /** The session put a decision to Ledge that waits on the person (#40 D2, card 1): an amber « Décision » on its row. */
  decision?: boolean;
  /** Issue #16: the row can be lifted and dragged within its project; `lifted`: how far it follows the finger. */
  drag?: { onLift(y: number): void; onDrag(y: number): void; onDrop(): void; onCancel(): void; lifted: number | null } | undefined }) {
  const route = useRoute();
  const longPress = useLongPress(() => onPress(s));
  const lift = useLiftDrag({ onLong: () => onPress(s), onLift: y => drag?.onLift(y), onDrag: y => drag?.onDrag(y), onDrop: () => drag?.onDrop(), onCancel: () => drag?.onCancel() });
  const press = { ...(drag ? lift : longPress), 'data-reorder-row': s.id, ...(drag?.lifted !== null && drag?.lifted !== undefined ? { style: liftedStyle(drag.lifted) } : {}) };
  // Its thread, terminal or request beside the list (a request belongs to Sessions since #40 D6).
  const open = (route.name === 'thread' || route.name === 'terminal' || route.name === 'request') && route.sessionId === s.id;
  const dot = dotOf(s);
  const kids = activeHelpers(s);
  const pct = contextPct(s);
  // Under « Au travail » the right side gives the context, the line what the agent does (§1, second board).
  const meta = filter === 'working' ? (pct === undefined ? undefined : `${pct} %`) : rowMeta(s);
  return (
    <Line
      href={href({ name: 'thread', sessionId: s.id })} selected={open} stale={offline} press={press} pressed={pressed}
      lead={<><Dot state={dot} pulse={dot === 'work' && !offline} /><RuntimeTag tool={s.tool} /></>}
      title={<>
        <b className="font-semibold"><SessionName session={s} nameClassName="font-normal text-muted" /></b>
        {woken && <span data-woken="" className="ml-1 inline-flex align-[-2px] text-muted"><Icon name="clock" className="size-[13px]" /></span>}
        {kids > 0 && <span aria-label={copy.sessions.kidsLabel(kids)} className="ml-1.5 font-mono text-small text-muted">{copy.sessions.kids(kids)}</span>}
        {decision && <span className="ml-1.5 inline-flex align-[1px]"><Pill tone="ask">{copy.cards.decision}</Pill></span>}
      </>}
      // A close this phone sent says so over the state, as the list always did, until the session ends.
      sub={closing ? <span className="text-attention">{copy.sessions.closing}</span> : <span className={dot === 'ask' ? 'text-attention' : undefined}>{rowLine(s, filter, now)}</span>}
      {...(dot === 'perm' ? { subTone: 'perm' as const } : {})}
      {...(meta !== undefined ? { meta, metaWarn: filter === 'working' && pct !== undefined && pct / 100 >= threshold } : {})}
    />
  );
}

/** A row or a heading lifted (card 6): it follows the finger, a little bigger, with a shadow. */
const liftedStyle = (dy: number): CSSProperties => ({ transform: `translateY(${dy}px) scale(1.02)`, position: 'relative', zIndex: 5, boxShadow: '0 10px 28px #0008', background: 'var(--color-surface)', borderRadius: 10, touchAction: 'none' });
/** Where a lifted row or heading lands: a violet line. */
// Above the lifted row (#16 review C3): it is drawn where that row is held, and would hide it.
const InsertLine = () => <div aria-hidden="true" data-insert-line="" className="relative z-10 mx-3 my-0.5 h-[3px] rounded-full bg-task" />;

function Group({ group, children, drag }: { group: SessionGroup; children: React.ReactNode;
  /** Issue #16: the project's heading lifts and drags among the projects; a long press without moving opens Monter / Descendre. */
  drag?: { onLong(): void; onLift(y: number): void; onDrag(y: number): void; onDrop(): void; onCancel(): void; lifted: number | null } | undefined }) {
  const rig = group.kind === 'rig';
  const title = rig ? copy.sessions.rigGroup(group.name) : group.name;
  const lift = useLiftDrag({ onLong: () => drag?.onLong(), onLift: y => drag?.onLift(y), onDrag: y => drag?.onDrag(y), onDrop: () => drag?.onDrop(), onCancel: () => drag?.onCancel() });
  return (
    <section aria-label={title} data-reorder-section={group.id} className="flex flex-col gap-1.5" style={drag && drag.lifted !== null ? liftedStyle(drag.lifted) : undefined}>
      <div className="flex items-center gap-1.5 px-0.5 text-small font-semibold text-muted select-none" {...(drag ? lift : {})}>
        {rig && <Dot state="rig" />}{title}<span className="font-normal">{group.sessions.length}</span>
      </div>
      <Box {...(rig ? { tone: 'rigs' as const } : {})}>{children}</Box>
    </section>
  );
}

/** The entry at the top of Sessions (docs/mockups/ledge-routines.html, card 17): « Routines », how many and the next run, the
 *  red count of those waiting on the user or that failed; it opens the Routines screen. */
function RoutinesEntry({ routines, now, offline }: { routines: readonly PhoneRoutine[]; now: number; offline: boolean }) {
  const R = copy.routines;
  const e = routinesEntry(routines, now);
  if (e.count === 0) return null;
  return (
    <Box label={R.entry}>
      <Line href={href({ name: 'routines' })} stale={offline} lead={<Icon name="alarm" className="size-5" />} title={<b className="font-semibold">{R.entry}</b>} {...(e.next ? { sub: R.entrySub(e.count, e.next) } : {})}>
        {e.flagged > 0 && <Pill tone="perm">{String(e.flagged)}</Pill>}
        <Icon name="chevron" className="size-4 text-muted" />
      </Line>
    </Box>
  );
}

/**
 * « Sessions » (docs/mockups/ledge-mobile-refonte/m2-sessions.html §1, Q24, Q25): every session of the PC, filtered (Toutes,
 * En attente, Au travail), grouped by project then by rig; a row opens the session's thread.
 */
export function Sessions({ store, filter: fromRoute, storage }: { store: MobileStore; filter?: SessionFilter | undefined; storage?: Storage }) {
  const state = useMobile(store);
  const now = useNow();
  const [filter, setFilter] = useFilter(fromRoute, storage);
  const wide = useWide();
  const [mode, setMode] = useKept<Mode>('sessions.mode', MODES, 'list', storage);
  const [by, setBy] = useKept<Grouping>('sessions.groupBy', GROUPINGS, 'projects', storage);
  const [helpers, setHelpers] = useKept<'shown' | 'hidden'>('sessions.helpers', ['shown', 'hidden'], 'shown', storage);
  // A long press's session (§8): its actions' sheet is open, its seat or row ringed.
  const [pressed, setPressed] = useState<string | null>(null);
  const pressedSession = pressed ? state.sessions.get(pressed) : undefined;
  // The Atelier in islands is the phone's; a tablet keeps its drawn Atelier (§10).
  const atelier = !wide && mode === 'atelier';
  const sessions = [...state.sessions.values()];
  const counts = filterCounts(sessions);
  const offline = !state.fresh;
  // Issue #16: the PC keeps an order (card 7): the project groups follow it, and a row or a project's heading can be moved.
  const kept = state.daemon?.sessionOrder && state.daemon.atelier ? { projects: state.projects, order: state.sessionOrder ?? {} } : null;
  const groups = sessionGroups(sessions, filter, kept);
  const order = useOrder(store, sessions, kept, offline);
  const woken = wokenSessions(state.routines, sessions);
  // The sessions whose decision waits on the person, answered in their thread (#40 D2); only where the PC takes `task.answer`.
  const deciding = new Set(state.daemon?.taskAnswer ? openDecisions(state.tasks.values()).map(t => t.giver).filter((g): g is string => !!g) : []);
  const threshold = state.device?.contextNear ?? CONTEXT_NEAR;
  const subtitle = offline ? (state.syncedAt ? copy.link.lastKnownAt(clock(state.syncedAt)) : copy.agents.offline) : undefined;

  // « Nouvelle » (§1, §10): the screen opens even when the PC cannot launch; its button then says why (m2-lancement.html §1).
  const newButton = <a href={href({ name: 'launch' })} className={kitButtonClass({ variant: 'primary', size: 'sm', className: 'flex-none' })}><Icon name="plus" className="size-4" />{copy.sessions.new}</a>;
  const seeButton = (to: SessionFilter, label: string) => <button type="button" onClick={() => setFilter(to)} className={kitButtonClass({ size: 'xs' })}>{label}</button>;
  const S = copy.sessions;
  // A filter with nothing in it says so and leads on (§1; « Au travail »: m2-vides.html, Q70).
  const emptyFilter = groups.length === 0 && sessions.length > 0 && (
    <Box label={S.filter[filter]}>
      {filter === 'waiting'
        ? <EmptyState framed={false} glyph={null} title={S.filterEmpty} body={S.filterEmptyBody(counts.working)} action={seeButton('all', S.seeAll)} />
        : counts.waiting > 0
          ? <EmptyState framed={false} glyph={null} title={S.emptyWorking.title} body={S.emptyWorking.waiting(counts.waiting)} action={seeButton('waiting', S.seeWaiting)} />
          : <EmptyState framed={false} glyph={null} title={S.emptyWorking.title} body={S.emptyWorking.idle} action={seeButton('all', S.seeAll)} />}
    </Box>
  );

  return (
    <TabPage
      title={copy.agents.title} subtitle={subtitle} bodyClassName="flex flex-col gap-2.5"
      actions={wide ? undefined : <><ModeToggle value={mode} onChange={setMode} />{newButton}</>} wideActions={wide ? newButton : undefined}
    >
      {pressedSession && <SessionActions store={store} session={pressedSession} onDone={() => setPressed(null)} {...(order.can ? { order: order.stepsOf(groups, pressedSession.id) } : {})} />}
      {order.sheet && <ProjectOrderSheet name={order.sheet.name} up={order.projectStep(groups, order.sheet, -1)} down={order.projectStep(groups, order.sheet, 1)} onClose={() => order.setSheet(null)} />}
      {/* Issue #16: « Ida est maintenant 1re sur 3 dans ledge. », for screen readers; a move not saved, said on screen. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-reorder-said="">{order.said}</div>
      {order.problem && <p role="alert" className="rounded-lg border border-destructive/40 px-3 py-2 text-small text-danger-fg">{order.problem}</p>}
      {state.routines && <RoutinesEntry routines={state.routines} now={now} offline={offline} />}
      {sessions.length === 0 ? (
        <Box label={copy.agents.empty}>
          <EmptyState list glyph={<Icon name="sessions" />} title={copy.agents.empty} body={copy.agents.emptyHint}
            action={<a href={href({ name: 'launch' })} className={kitButtonClass({ variant: 'primary', size: 'sm' })}><Icon name="plus" className="size-4" />{copy.sessions.newSession}</a>} />
        </Box>
      ) : atelier ? (
        <SessionsAtelier
          sessions={sessions} by={by} onBy={setBy} helpers={helpers === 'shown'} onHelpers={() => setHelpers(helpers === 'shown' ? 'hidden' : 'shown')}
          rigs={!!state.daemon?.rigs} pressed={pressed} onPress={s => setPressed(s.id)}
          requests={(state.asks ?? []).filter(a => a.kind !== 'update').length}
        />
      ) : (
        <>
          <FilterBar value={filter} counts={counts} onChange={setFilter} />
          {groups.map((g, gi) => {
            const movable = order.can && g.kind === 'project';
            const l = order.lift;
            const rowsLifted = l && l.kind === 'session' && l.gid === g.id ? l : null;
            // The line goes before the row the lifted one would push down (or after the last).
            const lineAt = rowsLifted && rowsLifted.to !== rowsLifted.from ? (rowsLifted.to < rowsLifted.from ? rowsLifted.to : rowsLifted.to + 1) : -1;
            const projLine = l && l.kind === 'project' && l.to !== l.from && (l.to < l.from ? l.to : l.to + 1) === gi;
            return (
              <div key={g.id} className="contents">
                {projLine && <InsertLine />}
                <Group group={g} {...(movable && g.project ? { drag: order.projectDrag(groups, g) } : {})}>
                  {g.sessions.flatMap((s, i) => [
                    ...(i === lineAt ? [<InsertLine key="line" />] : []),
                    <Row key={s.id} session={s} filter={filter} offline={offline} threshold={threshold} now={now} closing={closingHere(s, state.ops, now)} pressed={pressed === s.id} onPress={x => setPressed(x.id)} woken={woken.has(s.id)} decision={deciding.has(s.id)}
                      {...(movable ? { drag: order.rowDrag(g, i) } : {})} />
                  ])}
                  {lineAt === g.sessions.length && <InsertLine />}
                </Group>
                {l && l.kind === 'project' && l.to !== l.from && l.to > l.from && l.to === gi && gi === groups.filter(x => x.kind === 'project' && x.project).length - 1 && <InsertLine />}
              </div>
            );
          })}
          {emptyFilter}
        </>
      )}
    </TabPage>
  );
}

type Lift = { kind: 'session' | 'project'; gid: string; from: number; to: number; y0: number; dy: number; mids: number[] };

/** Where a finger at `y` puts the lifted item among the others' middles (its own excluded). */
const placeAt = (mids: readonly number[], from: number, y: number): number => mids.filter((m, k) => k !== from && m < y).length;
const moveTo = <T,>(list: readonly T[], from: number, to: number): T[] => { const n = [...list]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return n; };

/**
 * Issue #16 on the phone (docs/mockups/ledge-reorder.html, cards 6 and 7): a session moves within its project, a project among
 * the projects, by a long press then a drag, or Monter / Descendre in the actions. The PC keeps the order (`session.order`,
 * `project.order`): nothing moves before it answers; a move not saved is said, the move said for screen readers.
 */
function useOrder(store: MobileStore, sessions: readonly PhoneSession[], kept: KeptOrder | null, offline: boolean) {
  const R = copy.sessions.reorder;
  const state = useMobile(store);
  const [lift, setLift] = useState<Lift | null>(null);
  const [said, setSaid] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SessionGroup | null>(null);
  const can = !!kept && !offline;
  const failure = (r: Awaited<ReturnType<MobileStore['orderSessions']>>, name: string): string | null =>
    r.status === 'applied' ? null : r.status === 'rejected' && r.reason === 'unavailable' ? R.outdated(name) : r.status === 'rejected' ? R.stale(name) : R.offline(name);

  const moveSession = (g: SessionGroup, from: number, to: number) => {
    if (from === to || to < 0 || to >= g.sessions.length) return;
    const s = g.sessions[from]!;
    const next = moveTo(g.sessions, from, to);
    // The whole project as the PC keeps it, the ones a filter hides included: those moved take the places theirs had.
    const all = sessionGroups(sessions, 'all', kept).find(x => x.id === g.id)?.sessions ?? g.sessions;
    const ids = placeSessions(all.map(x => x.id), next.map(x => x.id));
    setProblem(null);
    void store.orderSessions(g.project ?? null, ids).then(r => {
      const p = failure(r, s.name);
      if (p) setProblem(p); else setSaid(R.moved(s.name, R.ordinal(to + 1, true), next.length, g.name));
    });
  };
  const projectIds = () => (kept?.projects ?? []).map(p => p.id);
  const moveProject = (g: SessionGroup, to: number) => {
    const ids = projectIds();
    const from = ids.indexOf(g.project ?? '');
    if (from < 0 || from === to || to < 0 || to >= ids.length) return;
    setProblem(null);
    void store.orderProjects(moveTo(ids, from, to)).then(r => {
      const p = failure(r, g.name);
      if (p) setProblem(p); else setSaid(R.movedProject(g.name, R.ordinal(to + 1, false), ids.length));
    });
  };
  const measure = (selector: string): number[] => [...document.querySelectorAll<HTMLElement>(selector)].map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });

  return {
    can, said, problem, lift, sheet, setSheet,
    rowDrag: (g: SessionGroup, i: number) => ({
      lifted: lift && lift.kind === 'session' && lift.gid === g.id && lift.from === i ? lift.dy : null,
      onLift: (y: number) => setLift({ kind: 'session', gid: g.id, from: i, to: i, y0: y, dy: 0, mids: measure(`[data-reorder-section="${CSS.escape(g.id)}"] [data-reorder-row]`) }),
      onDrag: (y: number) => setLift(l => (l ? { ...l, dy: y - l.y0, to: placeAt(l.mids, l.from, y) } : l)),
      onDrop: () => { const l = lift; setLift(null); if (l) moveSession(g, l.from, l.to); },
      onCancel: () => setLift(null)
    }),
    projectDrag: (groups: readonly SessionGroup[], g: SessionGroup) => {
      const movable = groups.filter(x => x.kind === 'project' && x.project);
      const i = movable.indexOf(g);
      return {
        lifted: lift && lift.kind === 'project' && lift.gid === g.id ? lift.dy : null,
        onLong: () => setSheet(g),
        onLift: (y: number) => setLift({ kind: 'project', gid: g.id, from: i, to: i, y0: y, dy: 0, mids: movable.map(x => measure(`[data-reorder-section="${CSS.escape(x.id)}"]`)[0] ?? 0) }),
        onDrag: (y: number) => setLift(l => (l ? { ...l, dy: y - l.y0, to: placeAt(l.mids, l.from, y) } : l)),
        onDrop: () => {
          const l = lift; setLift(null);
          if (!l || l.to === l.from) return;
          // The place among the projects shown, as an index in the PC's whole list.
          const target = movable[l.to];
          const at = target ? projectIds().indexOf(target.project!) : -1;
          if (at >= 0) moveProject(g, at);
        },
        onCancel: () => setLift(null)
      };
    },
    /** Monter / Descendre of a session's actions (card 6), in its project's group. */
    stepsOf: (groups: readonly SessionGroup[], id: string) => {
      const g = groups.find(x => x.kind === 'project' && x.sessions.some(s => s.id === id));
      if (!g) return {};
      const i = g.sessions.findIndex(s => s.id === id);
      return { ...(i > 0 ? { up: () => moveSession(g, i, i - 1) } : {}), ...(i < g.sessions.length - 1 ? { down: () => moveSession(g, i, i + 1) } : {}) };
    },
    projectStep: (_groups: readonly SessionGroup[], g: SessionGroup, by: -1 | 1) => {
      const ids = projectIds();
      const i = ids.indexOf(g.project ?? '');
      const to = i + by;
      return i < 0 || to < 0 || to >= ids.length || !state.daemon?.projectEdit ? undefined : () => moveProject(g, to);
    }
  };
}
