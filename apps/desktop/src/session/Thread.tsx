import { Fragment, memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { daemonStore, qualify, splitId, type DaemonClient } from '@ledge/fleet';
import { doneCount, latestTodos, liveHelpers, type Helper, type HelperItem, type NoticeItem, type Pending, type ReceivedItem, type SentItem, type Session, type ThreadItem, type ToolItem } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import type { DocumentReference } from '@ledge/ui/documents/references';
import { elapsedMs, liveTool, target } from '@ledge/ui/thread/tools';
import { helperThread } from '@ledge/ui/thread/turns';
import { Badge } from '@ledge/ui/ui/Badge';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { Thumbs } from '../images/Thumbs';
import type { NavAction } from '../nav/state';
import { helperState } from '../atelier/layout';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { StateBadge } from '../shell/SessionBot';
import { ActionGroup, Spin } from './ActionGroup';
import { MessageCard } from './MessageCard';
import { NoticeLine } from './NoticeLine';
import { foldable, packetRaw, PacketRawRow, rawOf, RigBubble, RigNoticeFold, RigNoticeLine, RigTaskCard, RigUnreadable, seatSession, type RigNotice } from './RigItems';
import { changedFiles, nameOf, relativeTo } from './changedFiles';
import { parseDiff } from './diff';
import { PlanCard } from './PlanCard';
import { usePastExchanges } from './pastExchanges';
import { WaitLine } from './WaitLine';
import { Card } from './SideCard';
import { OperatorCards, isOperatorThread } from './OperatorCards';
import { closeAside, useAsides, type HeldAside } from './asides';
import { machineOf } from '../nav/agents';
import { waitOf, type Wait } from './waiting';
import { clock, displayIds, docRefs, fmtDur, helperOf, peerKey, planTitle, summarize, timeMark, verbOf, type Exchange, type Segment } from './exchanges';
import { marksOf, tagLabel, taskOf, type Marked, type SynapseTags, type TaskNotice } from './markers';
import '../styles/thread-cowork.css';

type Decision = 'accept' | 'always' | 'deny' | 'unknown';
/** A task notification's tone: its node, its icon, its badge's colour. */
const TASK: Record<TaskNotice['status'], { node: string; icon: readonly string[]; badge: BotState }> = {
  killed: { node: 'warning', icon: SHELL_ICONS.stop, badge: 'question' }, completed: { node: 'success', icon: ICONS.check.d, badge: 'idle' },
  failed: { node: 'danger', icon: ICONS.close.d, badge: 'error' }, other: { node: '', icon: SHELL_ICONS.mail, badge: 'done' }
};

/** The pinned request, as the thread's foot says it: what it is, and who asks. */
export interface Waiting { kind: Pending['kind']; asker: string }

export interface ThreadProps {
  /** Fetches the prompts' images. */
  client: DaemonClient;
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; xs: readonly Exchange[];
  /** The clock; offline, the instant the thread froze (its times stand still). */
  now: number;
  /** The first item new since the last visit, frozen for the life of the page; null: nothing new. */
  unread: string | null;
  /** « Session terminée · il y a 2 h », « Plus aucune nouvelle… · il y a 2 h » : `whenOf(…).text`. */
  since: string;
  dispatch(a: NavAction): void;
  /** The action reached from the Changes view (« tour 2 »), lit for a moment; null: none. */
  flash: string | null;
  /** « Voir la modification »: the file's change in the side pane. Stable (the page's callback). */
  onChange(path: string): void;
  /** A capture of a tool row clicked (the action and its place): the page's own viewer. Absent, the thumbnail opens its own lightbox. */
  onCapture?(toolId: string, index: number): void;
  /** A document link or card in a message: the document in the side pane. Stable (the page's callback). */
  onDocument(path: string): void;
  /** The plan whose tab is the pane's active one (« Ouvert à côté »); null: none. */
  planOpen: string | null;
  /** « Lire le plan »: the plan in the side pane. Stable (the page's callback). */
  onPlan(key: string): void;
  /** The conversation whose tab is the pane's active one (its peerKey: « Ouvert à côté »); null: none. */
  convOpen: string | null;
  /** « Répondre à Bix » on an OpenRig message: the sender's composer, prefixed with what it is about. Stable. */
  onReplyTo?(peer: Session, about: string): void;
  /** « suivre la conversation »: the conversation with that peer (peerKey) beside the thread. Stable (the page's callback);
   *  absent: no way to it (a subagent's page). */
  onConversation?(peer: string): void;
  /** The pinned request of this thread (online only); null: none. */
  waiting?: Waiting | null;
  /** « Voir la vue Terminal » under an aside Ledge could not read: the session's Terminal view. Absent: no link. */
  onTerminal?(): void;
}

/** What the agent said, as plain prose the column's width, its time under it, and a card for each document it names (docRefs):
 *  parsed again only when its text changes, never on the page's clock. */
const Say = memo(function Say({ kind, text, at, onDocument }: { kind: 'message' | 'reply'; text: string; at: string; onDocument(path: string): void }): JSX.Element {
  const { t } = useI18n();
  const refs = useMemo(() => docRefs(text), [text]);
  const onLink = useCallback((ref: DocumentReference) => onDocument(ref.path), [onDocument]);
  return (
    <li className={`cw-say agent-message ${kind}`}>
      <div className="msg-body"><ThreadMarkdown text={text} onDocument={onLink} /></div>
      {refs.map(path => (
        <button key={path} type="button" className="document-card doc" onClick={() => onDocument(path)}>
          <span className="doc-ico"><Icon d={SHELL_ICONS.file} size={16} /></span>
          <span className="doc-name"><strong>{nameOf(path)}</strong><small className="mono">{path}</small></span>
          <span className="doc-open"><Icon d={SHELL_ICONS.file} size={13} />{t.session.thread.read}</span>
        </button>
      ))}
      <span className="cw-time mono">{at}</span>
    </li>
  );
});

/** The Story / Objectif a prompt carried (`[synapse-obs]`), as the mockup's tags. */
export function Tags({ tags }: { tags: SynapseTags }): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  return (
    <span className="tags">
      {tags.story !== undefined && <span className="tag">{th.tags.story} <b>{tagLabel(tags.story, th.tagValues)}</b></span>}
      {tags.objectif !== undefined && <span className="tag">{th.tags.objectif} <b>{tagLabel(tags.objectif, th.tagValues)}</b></span>}
    </span>
  );
}

/** A `<task-notification>` that opened the exchange (a background agent or command that stopped or ended): « Tâche », its
 *  state, what it was about, its exit code and output file, and the notification as it came, folded. */
function TaskRow({ task, at }: { task: TaskNotice; at: string }): JSX.Element {
  const { t } = useI18n();
  const tk = t.session.thread.task;
  const tone = TASK[task.status];
  const { about } = task;
  const code = about?.kind === 'command' ? about.code : undefined;
  return (
    <li className="r task-row prompt-block">
      <span className={cls('n node', tone.node)} aria-hidden="true"><Icon d={tone.icon} size={12} /></span>
      <div className="card task-card">
        <div className="task-head"><span className="kicker mono">{tk.kicker}</span><Badge state={tone.badge} label={tk.statuses[task.status]} /></div>
        <p className="task-text">
          {about?.kind === 'agent' ? <>{tk.agent} <strong>{about.name}</strong> {tk.agentDid[task.status]}</>
            : about?.kind === 'command' ? <>{tk.command} <code>{about.command}</code> {tk.commandDid[task.status]}</>
            : task.summary}
        </p>
        {(code !== undefined || task.output !== undefined) && (
          <div className="task-meta mono">{[code !== undefined ? tk.code(code) : null, task.output ?? null].filter(Boolean).join(' · ')}</div>
        )}
        <details className="raw">
          <summary><Icon d={ICONS.chevronRight.d} size={12} />{tk.raw}</summary>
          <pre className="pre">{task.raw}</pre>
        </details>
      </div>
      <span className="tm">{at}</span>
    </li>
  );
}

/** An agent's text that noted another objective: « Objectif de la session  ~~Analyse~~ → Correction · noté par Mira ». */
function ObjectiveRow({ mark, by, at }: { mark: Marked; by: string; at: string }): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  return (
    <li className="r objective-row">
      <span className="n node info" aria-hidden="true"><Icon d={SHELL_ICONS.arrowRight} size={12} /></span>
      <div className="objective">
        <span className="muted">{th.objective}</span>
        {mark.was && <><del className="tag was">{tagLabel(mark.was, th.tagValues)}</del><Icon d={SHELL_ICONS.arrowRight} size={12} /></>}
        <span className="tag now"><b>{tagLabel(mark.tags.objectif!, th.tagValues)}</b></span>
        <span className="muted noted">{th.notedBy(by)}</span>
      </div>
      <span className="tm">{at}</span>
    </li>
  );
}

/** The files an exchange changed, as chips under its answer: a click opens the change beside the thread. */
function FileChips({ tools, cwd, onChange }: { tools: ToolItem[]; cwd: string; onChange(path: string): void }): JSX.Element | null {
  const files = useMemo(() => {
    const by = new Map<string, { plus: number; minus: number }>();
    for (const x of tools) if (x.status === 'success') for (const f of x.files) {
      const d = f.diff ? parseDiff(f.diff) : { plus: 0, minus: 0 };
      const cur = by.get(f.path) ?? { plus: 0, minus: 0 };
      by.set(f.path, { plus: cur.plus + d.plus, minus: cur.minus + d.minus });
    }
    return [...by];
  }, [tools]);
  if (files.length === 0) return null;
  return (
    <li className="cw-files">
      {files.map(([path, d]) => (
        <button key={path} type="button" className="cw-file" title={relativeTo(path, cwd)} onClick={() => onChange(path)}>
          <Icon d={SHELL_ICONS.file} size={14} />
          <span>{nameOf(path)}</span>
          <span className="cw-delta mono"><b>+{d.plus}</b>{d.minus > 0 && <i>−{d.minus}</i>}</span>
        </button>
      ))}
    </li>
  );
}

/** The latest instant an exchange shows. */
const lastAt = (x: Exchange): string => {
  const ats = [x.at, ...x.received.map(r => r.at), ...x.notices.map(n => n.at), ...x.segments.flatMap(s => (s.kind === 'tools' ? s.tools.map(tool => tool.at) : [s.item.at]))];
  return ats.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
};

interface TurnProps {
  client: DaemonClient;
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; x: Exchange;
  /** Its time mark, and whether it is the last exchange (the frozen or ended row goes in it). */
  at: string; last: boolean;
  /** Its texts and actions folded under « Travail » (a past exchange, by the setting), unless what it holds must show. */
  foldable: boolean; unfolded: boolean; onUnfold(key: string): void;
  /** Still under way: its answer is not known yet, its files and its end not either. */
  busy: boolean;
  /** The id of the action the thread's foot names, left out of its run. */
  live: string | null;
  /** The clock, for the exchanges whose times count on (an action without a duration); the others get 0 and stay still. */
  now: number;
  unread: string | null; since: string; dispatch(a: NavAction): void;
  /** The flashed action when it is in this exchange, else null (the others are left alone). */
  flash: string | null; onChange(path: string): void; onCapture?(toolId: string, index: number): void; onDocument(path: string): void;
  /** The open plan when it is in this exchange, else null. */
  planOpen: string | null; onPlan(key: string): void;
  /** The open conversation when this exchange holds its first message (its header), else null. */
  convOpen: string | null; onConversation?(peer: string): void;
  /** Messages between agents: the peers' sessions Ledge knows (by `peer`), each conversation's message ids in the thread's
   *  order (by peerKey), the folded conversations and the fold's toggle (stable). */
  peers: ReadonlyMap<string, Session>; convs: ReadonlyMap<string, readonly string[]>;
  folded2: ReadonlySet<string>; onFold(key: string): void;
  /** The thread's `[synapse-obs]` markers, by item id. */
  marks: ReadonlyMap<string, Marked>;
  onReplyTo?(peer: Session, about: string): void;
}

/** One exchange: the request (or the task it was told of), then what the agent said, decided and did. A past one keeps its
 *  request and its answer in sight and folds everything between under « Travail »; the one under way shows each text as it
 *  comes. Rendered again only when what it shows changes: the clock's tick reaches the exchange whose action runs. */
const Turn = memo(function Turn({ client, session, helper, items, x, at, last, foldable: canFold, unfolded, onUnfold, busy, live, now, unread, since, dispatch, flash, onChange, onCapture, onDocument, planOpen, onPlan, convOpen, onConversation, peers, convs, folded2, onFold, marks, onReplyTo }: TurnProps): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const name = helper?.kind ?? session.name;
  const tools = x.segments.flatMap(s => (s.kind === 'tools' ? s.tools : []));
  const sum = summarize(tools, now, !offline);
  const task = x.prompt?.from === 'you' ? taskOf(x.prompt.text) : null;
  const promptMark = x.prompt ? marks.get(x.prompt.id) : undefined;
  const promptText = x.prompt ? promptMark?.text ?? x.prompt.text : '';
  // The answer: the last text of an exchange that is over. Folded, what came before it goes under « Travail ».
  const answerAt = busy ? -1 : x.segments.map(s => s.kind).lastIndexOf('say');
  const fold = canFold && answerAt > 0;
  const body = fold && !unfolded ? x.segments.slice(answerAt) : x.segments;

  const marker = (id: string): ReactNode => id === unread
    ? <li className="r unread-marker" role="separator" aria-label={th.unread}><span className="n new-dot" /><span className="newsep">{th.unread}</span><span className="tm" /></li>
    : null;

  const machine = splitId(session.id)?.machine ?? 'local';
  const rigLabel = { one: t.session.rig.raw, many: t.session.rig.rawMany, deliveries: t.session.rig.deliveries };
  const rigAll = [...x.openers, ...x.segments.flatMap(s => (s.kind === 'sent' || s.kind === 'rigOut' ? [s.item] : []))];
  const rigPeer = (item: SentItem | ReceivedItem | NoticeItem): Session | null => {
    const byPeer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    if (byPeer) return byPeer;
    const address = item.kind === 'sent' ? item.rig?.to : item.kind === 'received' ? item.rig?.from : item.outgoing ? item.rig?.to : item.rig?.from ?? item.name;
    return seatSession(address, machine);
  };
  const message = (item: SentItem | ReceivedItem): ReactNode => {
    if (item.rig) {
      const peer = rigPeer(item);
      const raw = rawOf(item as { rig: NonNullable<typeof item.rig> }, rigAll, { ...rigLabel, one: item.kind === 'sent' ? t.session.rig.command : rigLabel.one });
      return <RigBubble item={item as Parameters<typeof RigBubble>[0]['item']} self={session} peer={peer} raw={raw} onReply={onReplyTo} onOpenPeer={p => dispatch({ type: 'open', id: p.id })} />;
    }
    const key = peerKey(item);
    const conv = convs.get(key) ?? [];
    const peer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    const paired = item.kind === 'sent' ? item.received : item.sent;
    return <MessageCard item={item} self={session} peer={peer} header={conv[0] === item.id && conv.length > 1 ? { count: conv.length } : null}
      folded={folded2.has(key)} lit={flash === item.id} onFold={() => onFold(key)} time={clock(item.at)}
      onOpenPeer={() => peer && dispatch({ type: 'open', id: peer.id, ...(paired !== undefined && { item: paired }) })}
      following={convOpen === key} onFollow={onConversation && (() => onConversation(key))} />;
  };
  const notice = (item: NoticeItem): ReactNode => {
    if (item.rig) {
      const rig = item as RigNotice;
      const raw = rawOf(rig, rigAll, { ...rigLabel, one: rig.outgoing ? t.session.rig.command : rigLabel.one });
      if (rig.rig.kind === 'unreadable') return <RigUnreadable item={rig} />;
      if (rig.rig.kind === 'handoff') return <RigTaskCard item={rig} self={session} client={client} peer={rigPeer(rig)} raw={raw} />;
      return <RigNoticeLine item={rig} raw={raw} />;
    }
    const peer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    return (
      <li className="r notice-row">
        <span className="n node" aria-hidden="true"><Icon d={SHELL_ICONS.mail} size={12} /></span>
        <NoticeLine item={item} peer={peer} onOpenPeer={() => peer && dispatch({ type: 'open', id: peer.id })} onOpenTask={task => dispatch({ type: 'ledge', tab: 'tasks', task })} />
        <span className="tm">{clock(item.at)}</span>
      </li>
    );
  };
  // The marker opens the exchange above its prompt, else above the first message received or notice that opens it.
  const opener = x.prompt?.id ?? x.openers[0]?.id;

  /** An answer the person gave to a request, on their side: what they decided, on what, and when. */
  const decision = (item: Extract<Segment, { kind: 'decision' }>['item']): ReactNode => {
    const d: Decision = item.decision!;
    if (item.tool === 'ExitPlanMode') {
      const title = planTitle(item.text);
      const plan = x.segments.find((s): s is Extract<Segment, { kind: 'plan' }> => s.kind === 'plan' && s.plan.title === title);
      return (
        <li className={cls('cw-decision decision-row plan', d)}>
          <span className={`cw-decision-chip decision-chip plan ${d}`}>
            <span>{th.planDecided[d]}</span><strong>{th.quote(title)}</strong>
            {plan && <button type="button" className="cw-link" onClick={() => onPlan(plan.plan.key)}>{t.session.plan.readPlan}</button>}
          </span>
          <span className="cw-time mono">{clock(item.at)}</span>
        </li>
      );
    }
    return (
      <li className={cls('cw-decision decision-row', d)}>
        <span className={`cw-decision-chip decision-chip ${d}`}><b>{item.byClose ? th.decided.denyByClose : th.decided[d]}</b><code className="mono">{item.text}</code></span>
        <span className="cw-time mono">{clock(item.at)}</span>
      </li>
    );
  };

  const segment = (s: Segment): ReactNode => {
    if (s.kind === 'tools') {
      const first = s.tools.find(tool => tool.id === unread);
      const lit = flash !== null && s.tools.some(tool => tool.id === flash) ? flash : null;
      const shown = s.tools.filter(tool => tool.id !== live);
      return shown.length > 0 && <ActionGroup key={s.key} client={client} sessionId={session.id} who={name} onCapture={onCapture} tools={shown} todos={s.todos} now={now} live={!offline}
        marker={first ? marker(first.id) : null} flash={lit} onChange={onChange} />;
    }
    const { item } = s;
    let node: ReactNode;
    if (s.kind === 'say') {
      const mark = marks.get(item.id);
      const text = mark ? mark.text : s.item.text;
      node = <>
        {text !== '' && <Say kind={s.item.kind} text={text} at={clock(item.at)} onDocument={onDocument} />}
        {mark?.was !== undefined && <ObjectiveRow mark={mark} by={name} at={clock(item.at)} />}
      </>;
    } else if (s.kind === 'decision') node = decision(s.item);
    else if (s.kind === 'plan') node = <li className="cw-plan plan-row"><PlanCard plan={s.plan} open={planOpen === s.plan.key} onOpen={onPlan} /></li>;
    else if (s.kind === 'helper') {
      const h = helperOf(session, items, s.item.id, t.session.subagent)!;
      const state = helperState(h);
      // Its activity (validated with design-ux, 2026-11-27): the action it runs in place of its task, then, once it stopped
      // working, how many actions it made and how long they took.
      const own = helperThread([...items], s.item.id).items.filter((i): i is ToolItem => i.kind === 'tool');
      const doing = offline ? undefined : liveTool(own);
      const ms = own.reduce((n, x) => n + (x.durationMs ?? 0), 0);
      node = (
        <li className="cw-helper-row">
          <button type="button" className="cw-helper" data-helper={s.item.id} aria-label={th.openThread(h.kind)} title={s.item.task} onClick={() => dispatch({ type: 'open', id: session.id, helper: s.item.id })}>
            <span className="cw-helper-ico"><Icon d={SHELL_ICONS.subagents} size={14} /></span>
            <span className="cw-helper-text"><strong>{h.kind}</strong>
              {doing ? <span className="cw-helper-doing">{th.verbs[verbOf(doing)]} <code className="mono">{target(doing) || doing.tool}</code></span> : <span>{s.item.task}</span>}</span>
            {!doing && state !== 'working' && own.length > 0 && <span className="cw-helper-tally mono">{th.actions(own.length)}{ms > 0 && ` · ${fmtDur(ms, lang)}`}</span>}
            <StateBadge state={state} offline={offline} />
            <Icon d={ICONS.chevronRight.d} size={13} />
          </button>
        </li>
      );
    }
    else if (s.kind === 'rigOut') node = notice(s.item);
    else node = message(s.item);
    return <Fragment key={item.id}>{marker(item.id)}{node}</Fragment>;
  };

  // An action still running keeps the exchange from ending, past or not (a command left in the background).
  const running = sum.running !== null;
  const ended = tools.length > 0 && !busy && !running && !(last && offline);
  const lastTool = tools.at(-1);
  const failedText = sum.failed > 0 && th.endFailed(sum.failed, false);
  return (
    <li className={cls('turn cw-turn', last && 'current')} aria-label={th.exchange(at)}>
      <ol className="turn-rows">
        {opener !== undefined && marker(opener)}
        {task ? <TaskRow task={task} at={at} /> : x.prompt && (
          <li className={cls('cw-you prompt-row prompt-block', x.prompt.from === 'parent' && 'from-agent')}>
            {(x.prompt.from === 'parent' || promptMark) && (
              <span className="cw-you-who prompt-author">
                {x.prompt.from === 'parent' && th.fromParent(session.name)}
                {promptMark && <Tags tags={promptMark.tags} />}
              </span>
            )}
            <p className="cw-bubble">{promptText}</p>
            {x.prompt.images && <Thumbs className="cw-images prompt-images" client={client} refs={x.prompt.images} route={{ id: session.id }} max={{ w: 420, h: 260 }} who={th.you} at={clock(x.at)} align="end" />}
            <span className="cw-time mono">{at}</span>
          </li>
        )}
        {openerRows(x.openers).map(g => Array.isArray(g)
          ? <Fragment key={g[0]!.id}>{g[0]!.id !== opener && marker(g[0]!.id)}<RigNoticeFold items={g} raws={n => rawOf(n, rigAll, rigLabel)} />
            {/* A packet that ends inside the fold: its one raw still follows the group, folded or not. */}
            {g.map(n => { const pr = packetRaw(n, rigAll, t.session.rig.rawMany); return pr && <PacketRawRow key={`raw-${n.id}`} raw={pr} />; })}</Fragment>
          : <Fragment key={g.id}>{g.id !== opener && marker(g.id)}{g.kind === 'received' ? message(g) : notice(g)}{(() => { const pr = packetRaw(g, rigAll, t.session.rig.rawMany); return pr && <PacketRawRow raw={pr} />; })()}</Fragment>)}
        {fold && (
          <li className="cw-work-row">
            <button type="button" className={cls('cw-work', unfolded && 'open')} aria-expanded={unfolded} onClick={() => onUnfold(x.key)}>
              <Icon d={ICONS.chevronRight.d} size={13} />
              <strong>{th.work}</strong>
              <span>{th.actions(sum.count)}{sum.files > 0 && ` ${th.files(sum.files)}`}</span>
              {sum.failed > 0 && <span className="cw-tag danger">{th.failed(sum.failed).replace(/^[\s·]+/, '')}</span>}
              <span className="cw-step-time mono">{fmtDur(sum.ms, lang)}</span>
            </button>
          </li>
        )}
        {body.map(segment)}
        {!busy && !running && <FileChips tools={tools} cwd={session.cwd} onChange={onChange} />}
        {ended && (!fold || unfolded) && (
          <li className="cw-end end-row">
            <span className="end-text">
              {th.endOf} · {failedText && <><span className="end-failed">{failedText}</span>{lastTool?.status === 'success' && th.endFailed(sum.failed, true).slice(failedText.length)} · </>}
              {th.actions(sum.count)}{sum.files > 0 && ` ${th.files(sum.files)}`}
            </span>
          </li>
        )}
        {last && offline && (
          <li className="cw-end frozen-end">
            <Icon d={SHELL_ICONS.offline} size={13} />
            <span className="end-text">{th.frozenEnd(since)}</span>
          </li>
        )}
        {last && !offline && session.state === 'exited' && (
          <li className="cw-end turn-end">
            <span className="end-text">{th.ended(clock(lastAt(x)), since)}</span>
          </li>
        )}
      </ol>
    </li>
  );
});

/** Beside the column, when the session is wide enough: where the work plan stands, which files changed, which subagents ran.
 *  No work plan (Cursor keeps none), no Progression card. */
function Summary({ client, session, helper, items, now, dispatch, onChange }: Pick<ThreadProps, 'client' | 'session' | 'helper' | 'items' | 'now' | 'dispatch' | 'onChange'>): JSX.Element {
  const { t } = useI18n();
  const ts = t.session.thread.side;
  const todos = useMemo(() => latestTodos(items, helper?.id), [items, helper?.id]);
  const files = useMemo(() => changedFiles(items, session.cwd, helper?.id), [items, session.cwd, helper?.id]);
  // Issue #47: the « Sous-agents » card lists the ones still at work (liveHelpers); a finished one stays in the thread above.
  const live = new Set(liveHelpers(session).map(h => h.id));
  const kids = helper === null ? items.filter((i): i is HelperItem => i.kind === 'helper' && live.has(i.id)) : [];
  const done = todos ? doneCount(todos) : 0;
  return (
    <aside className="cw-side" aria-label={ts.label}>
      {todos && todos.length > 0 && (
        <Card title={ts.progress} count={`${done}/${todos.length}`}>
          <span className="cw-bar" aria-hidden="true"><i style={{ width: `${(done / todos.length) * 100}%` }} /></span>
          <ol className="cw-todos">
            {todos.map((x, i) => (
              <li key={i} className={`is-${x.status}`}>
                <span className="cw-box" aria-hidden="true">{x.status === 'completed' && <Icon d={ICONS.check.d} size={11} />}</span>
                <span>{x.text}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {files.length > 0 && (
        <Card title={ts.files} count={String(files.length)}>
          <ul className="cw-rows">
            {files.map(f => (
              <li key={f.path}>
                <button type="button" title={f.shown} onClick={() => onChange(f.path)}>
                  <Icon d={SHELL_ICONS.file} size={14} />
                  <span className="cw-row-name">{nameOf(f.path)}</span>
                  <span className="cw-delta mono"><b>+{f.plus}</b>{f.minus > 0 && <i>−{f.minus}</i>}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {kids.length > 0 && (
        <Card title={ts.helpers} count={String(kids.length)}>
          <ul className="cw-rows">
            {kids.map(k => {
              const h = helperOf(session, items, k.id, t.session.subagent)!;
              return (
                <li key={k.id}>
                  <button type="button" title={k.task} onClick={() => dispatch({ type: 'open', id: session.id, helper: k.id })}>
                    <Icon d={SHELL_ICONS.subagents} size={14} />
                    <span className="cw-row-name">{h.kind}</span>
                    <StateBadge state={helperState(h)} offline={session.offline === true} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {/* #54: the operator's thread only, under « Fichiers modifiés » and « Sous-agents ». */}
      {helper === null && isOperatorThread(session) && <OperatorCards client={client} session={session} now={now} />}
    </aside>
  );
}

/** An action whose time counts on with the clock (running, or cut without a duration): its exchange takes every tick. */
const ticks = (x: Exchange) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.durationMs === undefined));
const holds = (x: Exchange, id: string) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.id === id)) || messagesOf(x).some(m => m.id === id);
const holdsPlan = (x: Exchange, key: string) => x.segments.some(s => s.kind === 'plan' && s.plan.key === key);
/** The wait at the foot of the thread: the agent (or the subagent shown) works, online, asks nothing, and nothing in its last
 *  exchange says so already: no action runs, no subagent it launched still works (their row carries the state). */
function useWait(session: Session, helper: Helper | null, items: readonly ThreadItem[], xs: readonly Exchange[], asking: Waiting | null, unnamed: string): Wait | null {
  const x = xs[xs.length - 1];
  const working = session.offline !== true && asking === null && (helper ?? session).state === 'working';
  return useMemo(() => {
    if (!working || !x || x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running'))) return null;
    const sub = (item: HelperItem) => helperOf(session, items, item.id, unnamed);
    if (x.segments.some(s => s.kind === 'helper' && sub(s.item)?.state === 'working')) return null;
    return waitOf(x, item => sub(item)?.kind ?? unnamed, item => {
      const end = sub(item)?.finishedAt;
      return end !== undefined ? Date.parse(end) : undefined;
    });
  }, [working, x, session, items, unnamed]);
}

/** What keeps a past exchange open: an action still running, a plan still waiting for its answer. */
const pending = (x: Exchange, live: boolean) => x.segments.some(s => (live && s.kind === 'tools' && s.tools.some(tool => tool.status === 'running')) || (s.kind === 'plan' && s.plan.status === 'proposed'));

const NONE: ReadonlySet<string> = new Set();

/** The messages between agents of an exchange, in the order shown: the received ones that open it, then the sent ones. */
const messagesOf = (x: Exchange): (SentItem | ReceivedItem)[] => [...x.received, ...x.segments.flatMap(s => (s.kind === 'sent' ? [s.item] : []))];

/** Each conversation's message ids in the thread's order, by peerKey: its first one carries the header. */
function conversations(xs: readonly Exchange[]): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const m of xs.flatMap(messagesOf)) {
    const ids = out.get(peerKey(m));
    if (ids) ids.push(m.id); else out.set(peerKey(m), [m.id]);
  }
  return out;
}

/** The sessions of the thread's peers that Ledge knows, by `peer` (a raw daemon id, on this session's machine). The same
 *  map while none of them changes, so the store's other changes leave the exchanges alone. */
function usePeers(session: Session, xs: readonly Exchange[]): ReadonlyMap<string, Session> {
  const ids = useMemo(() => [...new Set([...xs.flatMap(messagesOf), ...xs.flatMap(x => x.notices)].flatMap(m => (m.peer !== undefined ? [m.peer] : [])))], [xs]);
  const machine = splitId(session.id)?.machine ?? 'local';
  const last = useRef<ReadonlyMap<string, Session>>(new Map());
  const select = useCallback(() => {
    const byId = daemonStore.getState().byId;
    const next = new Map<string, Session>();
    for (const p of ids) { const s = byId.get(qualify(machine, p)); if (s) next.set(p, s); }
    const prev = last.current;
    if (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return prev;
    return (last.current = next);
  }, [ids, machine]);
  return useSyncExternalStore(daemonStore.subscribe, select, select);
}

/** A set of keys kept for this session only: another session starts with none. */
function useKeys(id: string): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState<{ id: string; keys: ReadonlySet<string> }>(() => ({ id, keys: new Set() }));
  const toggle = useCallback((key: string) => setState(f => {
    const keys = new Set(f.id === id ? f.keys : []);
    if (!keys.delete(key)) keys.add(key);
    return { id, keys };
  }), [id]);
  return [state.id === id ? state.keys : NONE, toggle];
}

/** The foot of the thread: what happens now. The action running and its time, the agent's wait and its cause (WaitLine), or that
 *  the session waits for the person (coral). */
function Foot({ run, waiting, wait, thinking, seedKey, now }: {
  run: ToolItem | undefined; waiting: Waiting | null; wait: Wait | null;
  /** The name of the agent at work with nothing else to say (starting, or its subagents working): « Nova réfléchit… »; null: idle. */
  thinking: string | null; seedKey: string; now: number;
}): JSX.Element | null {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  if (waiting) return (
    <li className="cw-foot waiting" role="status">
      <span className="cw-foot-mark" aria-hidden="true"><i /></span>
      <span className="cw-foot-text">{th.waits[waiting.kind](waiting.asker)} {th.resumes}</span>
    </li>
  );
  if (run) return (
    <li className="cw-foot" role="status" aria-label={th.liveAction}>
      <span className="cw-foot-mark" aria-hidden="true"><Spin live /></span>
      <span className="cw-foot-text cw-shimmer" aria-hidden="true">{th.verbs[verbOf(run)]} <code className="mono">{target(run) || run.tool}</code></span>
      <span className="cw-step-time mono" aria-hidden="true">{fmtDur(elapsedMs(run, now), lang)}</span>
    </li>
  );
  if (wait) return <WaitLine wait={wait} seedKey={seedKey} now={now} />;
  if (thinking) return (
    <li className="cw-foot" role="status">
      <span className="cw-foot-mark" aria-hidden="true"><Spin live /></span>
      <span className="cw-foot-text cw-shimmer">{th.thinks(thinking)}</span>
    </li>
  );
  return null;
}

/** An aside (« /btw », #41) under the thread, marked as outside it: its question, then « Nova répond en aparté… », its answer, or
 *  that Ledge could not read it (any failure: the answer is in the terminal). */
function AsideCard({ aside, name, machine, onClose, onDocument, onTerminal }: { aside: HeldAside; name: string; machine: string; onClose(): void; onDocument(path: string): void; onTerminal?(): void }): JSX.Element {
  const { t } = useI18n();
  const ta = t.session.thread.aside;
  const cause = aside.cause ?? 'invalid';
  // The Terminal view helps wherever the answer or the reason is on the agent's screen: not where Ledge cannot type, nor offline.
  const link = onTerminal && !aside.offline && cause !== 'unsupported' && cause !== 'read_only'
    && <button type="button" className="cw-link" onClick={onTerminal}>{ta.seeTerminal}</button>;
  return (
    <li className="cw-aside">
      <div className="cw-aside-head">
        <span className="cw-aside-tag">{ta.tag}</span><span>{ta.head(name)}</span><span className="cw-time mono">{clock(aside.askedAt)}</span>
        <button type="button" aria-label={ta.close} title={ta.close} onClick={onClose}><Icon d={ICONS.close.d} size={13} /></button>
      </div>
      <p className="cw-aside-q">{aside.question}</p>
      {aside.state === 'answered' && aside.answer !== undefined ? <>
        <div className="cw-aside-a agent-message"><div className="msg-body"><ThreadMarkdown text={aside.answer} onDocument={ref => onDocument(ref.path)} /></div></div>
        {aside.truncated && <div className="cw-aside-cut"><span>{ta.truncated(name)}</span>{onTerminal && <button type="button" className="cw-link" onClick={onTerminal}>{ta.seeTerminal}</button>}</div>}
      </>
        : aside.state === 'asking' ? <p className="cw-aside-wait cw-shimmer" role="status">{ta.asking(name)}</p>
        : <div className="cw-aside-failed" role="status"><span>{aside.offline ? ta.offline(machine, name) : ta.failed[cause](name)}</span>{link}</div>}
    </li>
  );
}

/** The asides asked here of the session, under the thread: their own component, so their store's changes leave the thread alone. */
function Asides({ client, session, onDocument, onTerminal }: Pick<ThreadProps, 'client' | 'session' | 'onDocument' | 'onTerminal'>): JSX.Element {
  const asides = useAsides(client, session.id);
  return <>{asides.map(a => <AsideCard key={a.rid} aside={a} name={session.name} machine={machineOf(session)} onClose={() => closeAside(session.id, a.rid)} onDocument={onDocument} onTerminal={onTerminal} />)}</>;
}

/** The session thread as a conversation, in the manner of Claude Desktop's « Cowork » (docs/mockups/ledge-thread-cowork.html,
 *  issue #41): one reading column, what the person wrote in a bubble on the right, what the agent says as plain prose, its work
 *  between two texts folded to one line, and, when the session is wide enough, the summary beside the column. Memoised: the
 *  store's changes elsewhere leave it alone, its props being the session, its items and their exchanges, the clock and the
 *  page's stable callbacks. */
export const Thread = memo(function Thread({ client, session, helper, items, xs, now, unread, since, dispatch, flash, onChange, onCapture, onDocument, planOpen, onPlan, convOpen, onConversation, waiting = null, onReplyTo, onTerminal }: ThreadProps): JSX.Element {
  const { t, lang } = useI18n();
  const offline = session.offline === true;
  const past = usePastExchanges();
  const wait = useWait(session, helper, items, xs, waiting, t.session.subagent);
  const convs = useMemo(() => conversations(xs), [xs]);
  const peers = usePeers(session, xs);
  const marks = useMemo(() => marksOf(xs).byId, [xs]);
  // The folded conversations (peerKeys) and the past exchanges the reader unfolded (their keys).
  const [folded, onFold] = useKeys(session.id);
  const [unfolded, onUnfold] = useKeys(session.id);
  const fresh = useMemo(() => (unread === null ? -1 : xs.findIndex(x => displayIds([x]).includes(unread))), [xs, unread]);
  // The open conversation reaches only the exchange holding its header (its first message).
  const convHead = convOpen === null ? undefined : convs.get(convOpen)?.[0];
  const state = (helper ?? session).state;
  const working = !offline && waiting === null && (state === 'working' || state === 'starting');
  const lastX = xs.at(-1);
  const run = working && lastX ? liveTool(lastX.segments.flatMap(s => (s.kind === 'tools' ? s.tools : []))) : undefined;
  return (
    <div className="cw">
      <ol className="cw-col">
        {xs.map((x, i) => {
          const last = i === xs.length - 1;
          const lit = flash !== null && holds(x, flash);
          const busy = last && (working || waiting !== null);
          const open = last || (fresh >= 0 && i >= fresh) || lit || (planOpen !== null && holdsPlan(x, planOpen)) || pending(x, !offline);
          return (
            <Turn key={x.key} client={client} session={session} helper={helper} items={items} x={x} at={timeMark(x.at, now, lang)} last={last}
              foldable={past === 'folded' && !open} unfolded={unfolded.has(x.key)} onUnfold={onUnfold} busy={busy} live={last && run ? run.id : null}
              now={ticks(x) || (last && wait !== null) ? now : 0} unread={unread} since={since} dispatch={dispatch}
              flash={lit ? flash : null} onChange={onChange} onCapture={onCapture} onDocument={onDocument}
              planOpen={planOpen !== null && holdsPlan(x, planOpen) ? planOpen : null} onPlan={onPlan}
              convOpen={convHead !== undefined && messagesOf(x).some(m => m.id === convHead) ? convOpen : null} onConversation={onConversation}
              peers={peers} convs={convs} folded2={folded} onFold={onFold} marks={marks} onReplyTo={onReplyTo} />
          );
        })}
        <Foot key="foot" run={run} waiting={waiting} wait={wait} thinking={working ? helper?.kind ?? session.name : null} seedKey={lastX?.key ?? ''} now={now} />
        {helper === null && <Asides client={client} session={session} onDocument={onDocument} onTerminal={onTerminal} />}
      </ol>
      <Summary client={client} session={session} helper={helper} items={items} now={now} dispatch={dispatch} onChange={onChange} />
    </div>
  );
});

/** The openers in order, quiet OpenRig notices in a row (two or more, no stuck sweep) gathered to fold as one line. */
function openerRows(openers: ReadonlyArray<ReceivedItem | NoticeItem>): Array<ReceivedItem | NoticeItem | RigNotice[]> {
  const out: Array<ReceivedItem | NoticeItem | RigNotice[]> = [];
  for (const o of openers) {
    const last = out.at(-1);
    if (foldable(o) && Array.isArray(last)) last.push(o);
    else if (foldable(o) && last && !Array.isArray(last) && foldable(last)) out[out.length - 1] = [last, o];
    else out.push(o);
  }
  return out;
}
