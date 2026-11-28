import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { ProviderLogo, type Provider } from '@ledge/ui/logos/ProviderLogo';
import { LedgeMark } from '@ledge/ui/logos/LedgeMark';
import { inline } from '@ledge/ui/text/inline';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { useI18n } from '../i18n/lang';
import { NOTICE_MS, type Phase } from './machine';
import './island.css';

/** What a card says (docs/mockups/ledge-dynamic-island.html): a session's notice or request, read from the daemon, or one of
 *  Ledge's own (the complement's cards #ledge): a rig's question, a decision, a routine to activate or that could not run, a
 *  machine offline. Ledge's wear its mark where an agent wears its provider's logo. */
export type AgentKind = 'finished' | 'error' | 'permission' | 'question' | 'plan' | 'diff';
export type LedgeKind = 'rig' | 'decision' | 'routine' | 'routineFailed' | 'offline';
export type CardKind = AgentKind | LedgeKind;
export interface Card {
  /** The item's id: a new one resets the card's choice and field. */
  id: string;
  kind: CardKind; who: string;
  /** An agent's provider; absent on Ledge's own cards. */
  provider?: Provider;
  project?: string; branch?: string;
  /** A finish: the start of the last reply. An error: its message. A question: its text. A plan or a diff: its summary. */
  text?: string;
  /** A permission's command and the tool that asks to run it. */
  cmd?: string; tool?: string;
  /** A question's proposed answers. */
  options?: string[];
  /** Ledge's cards: the sentence (`bold`, its part in bold), the line under it, a rig's proposed answers (the suggested one
   *  first), a routine's state (how many « Activer » covers, whether each was read with its key, a refusal for a change). */
  sentence?: string; bold?: string; meta?: string;
  choices?: { id: string; label: string }[];
  routine?: { count: number; canApprove: boolean; stale?: string };
}

/** The island's sizes (px, before its scale): the pill, the open width, the gap to the top edge, the logo. */
export const ISLAND = { top: 8, seedW: 72, seedH: 36, openW: 420, logo: 16 } as const;

const isRequest = (k: CardKind) => k !== 'finished' && k !== 'error' && k !== 'offline';
const isLedge = (k: CardKind): k is LedgeKind => k === 'rig' || k === 'decision' || k === 'routine' || k === 'routineFailed' || k === 'offline';
/** The colour of each kind's sign, badge and ring: what waits on the person in amber (a permission in coral), a failure in red. */
const TONE: Record<CardKind, string> = { finished: 'var(--success)', error: 'var(--danger-text)', permission: 'var(--primary)', question: 'var(--warning)', plan: 'var(--warning)', diff: 'var(--warning)',
  rig: 'var(--warning)', decision: 'var(--warning)', routine: 'var(--warning)', routineFailed: 'var(--danger-text)', offline: 'var(--muted-foreground)' };
/** The rim an open Ledge card takes: amber when it waits on the person, red for a routine that could not run. */
const LEDGE_RIM: Record<LedgeKind, 'ask' | 'bad' | 'off'> = { rig: 'ask', decision: 'ask', routine: 'ask', routineFailed: 'bad', offline: 'off' };

/** A sentence with one part in bold (who asks, a machine's or a routine's name). */
function Bold({ text, bold }: { text: string; bold?: string }) {
  const i = bold ? text.indexOf(bold) : -1;
  if (!bold || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<b>{bold}</b>{text.slice(i + bold.length)}</>;
}

/** The sign of the event beside the logo on the pill. */
function Tone({ kind, size = 14 }: { kind: CardKind; size?: number }) {
  const c = TONE[kind];
  const common = { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (kind === 'finished') return <svg {...common}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>;
  if (kind === 'error') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (kind === 'permission') return <svg {...common}><path d="M8 2.2 13 4v3.6c0 3-2.2 5.2-5 6.2-2.8-1-5-3.2-5-6.2V4z" /></svg>;
  if (kind === 'question' || kind === 'rig' || kind === 'decision') return <svg {...common}><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill={c} /></svg>;
  if (kind === 'routineFailed') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (kind === 'routine') return <svg {...common}><circle cx="8" cy="8.5" r="5" /><path d="M8 6v2.7l1.8 1.2M3.5 3 5 1.8M12.5 3 11 1.8" /></svg>;
  if (kind === 'offline') return <svg {...common}><path d="M2.5 6.5a8 8 0 0 1 11 0M4.8 9a4.6 4.6 0 0 1 6.4 0M2.5 2.5l11 11" /><circle cx="8" cy="12" r=".5" fill={c} /></svg>;
  return <svg {...common}><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>;
}

export interface IslandProps {
  card: Card | null;
  /** The machine's phase; `entering`: the first frame of a card coming from rest, drawn off the edge so it can come out. */
  phase: Phase; entering?: boolean;
  /** Notifications waiting behind this one. */
  more: number;
  /** A decision taken here: `sent` until the terminal confirms it (« Envoyé, en attente du terminal »), then `received` (« Reçu »). */
  ack?: 'sent' | 'received' | null;
  /** A decision for this request is in flight from another path: its actions stay locked. */
  deciding?: boolean;
  /** Why the actions are off (offline, read-only), or null. */
  blocked?: string | null;
  /** Why the last decision failed, or null. */
  failure?: string | null;
  /** Allow, deny or answer from the island (Desktop's setting); off, a request only opens in Ledge or waits. */
  quick?: boolean;
  /** What is left of a notice's 6 s, and whether its clock is held (hover, focus). */
  leftMs?: number; held?: boolean;
  /** Reduced motion: the island fades instead of moving. */
  reduced?: boolean;
  /** The tallest the open card may be (px, before the scale): past it the middle scrolls, the head and the actions stay. */
  maxH?: number;
  onEnter?: () => void; onLeave?: () => void;
  onDecide: (d: 'accept' | 'deny') => void; onReply: (text: string) => void;
  onLater: () => void; onOpen: () => void;
  /** A rig's proposed answer, by id; a routine's buttons. */
  onChoice?: (id: string) => void; onRoutine?: (action: 'approve' | 'refuse' | 'run') => void;
  cardRef?: Ref<HTMLDivElement>;
}

export function Island(p: IslandProps) {
  const { t } = useI18n();
  const c = t.island;
  const inner = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  /** « Répondre » pressed with no answer: the red line under the answers, gone as soon as one is chosen or typed. */
  const [nudge, setNudge] = useState(false);
  /** The middle passes the height available: it scrolls between two hairlines. */
  const [scrolls, setScrolls] = useState(false);
  const card = p.card;
  // The open height follows the card's content; the middle is checked for overflow at the same time.
  useLayoutEffect(() => {
    const el = inner.current; if (!el) return;
    const measure = () => { setH(el.offsetHeight); const b = body.current; setScrolls(!!b && b.scrollHeight > b.clientHeight + 1); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el); if (body.current) ro.observe(body.current);
    return () => ro.disconnect();
  }, [card?.id, card?.kind, p.maxH]);
  useEffect(() => { setChoice(null); setReply(''); setNudge(false); }, [card?.id, card?.kind, card?.text]);
  const setRef = (el: HTMLDivElement | null) => { inner.current = el; const r = p.cardRef; if (typeof r === 'function') r(el); else if (r) (r as { current: HTMLDivElement | null }).current = el; };

  const phase = p.entering ? 'gone' : p.phase;
  if (!card) return <div className="di-island" data-phase="gone" style={{ width: ISLAND.seedW, height: ISLAND.seedH }} />;
  const open = phase === 'open';
  const notice = !isRequest(card.kind);
  const ledge = isLedge(card.kind);
  const L = t.ledge;
  const quick = p.quick ?? true;
  const acting = !!p.ack || (!!p.deciding && !p.failure);
  /** Allow, deny and reply are off while a decision is on its way, or when the request cannot be answered from here. */
  const locked = acting || p.blocked != null;
  const left = p.leftMs ?? NOTICE_MS;
  const pct = (left / NOTICE_MS) * 100;
  const running = open && notice && !p.held;
  /** The ring empties from where it is: `pathLength` is 100, so the offset is the share already spent. */
  const drain = { pathLength: 100, style: { stroke: TONE[card.kind], strokeDashoffset: 100 - pct, animation: running ? `di-drain ${left}ms linear forwards` : 'none' } as CSSProperties };
  const size: CSSProperties = { width: open ? ISLAND.openW : ISLAND.seedW, height: open && h ? h : ISLAND.seedH };
  /** Under the head: the start of a finished turn's reply, an error's message, or a diff's summary (its stats). */
  const preview = card.kind === 'finished' || card.kind === 'error' || card.kind === 'diff' ? card.text : undefined;
  const review = card.kind === 'plan' || card.kind === 'diff';
  /** Decided in Ledge Desktop: a plan or a diff after reading it, and every request once the quick answers are off. */
  const handOff = review || !quick;
  const answer = () => {
    if (locked) return;
    const text = reply.trim() || (choice !== null ? card.options?.[choice] ?? '' : '');
    if (!text) { setNudge(true); return; }
    p.onReply(text);
  };
  /** A plan names itself after the sentence (its summary's first line). */
  const title = card.kind === 'plan' && card.text ? card.text.split('\n')[0] : undefined;
  const hasBody = (card.kind === 'permission' && !!card.cmd) || (card.kind === 'question' && (!!card.text || quick));
  const logo = ledge || !card.provider ? <LedgeMark size={ISLAND.logo} /> : <ProviderLogo provider={card.provider} size={ISLAND.logo} />;
  const badge = ledge ? L.badge[card.kind === 'routineFailed' ? 'routine' : card.kind as Exclude<LedgeKind, 'routineFailed'>] : c.badge[card.kind as AgentKind];
  const meta = ledge ? card.meta : [card.project, card.branch].filter(Boolean).join(' · ');
  /** What « Plus tard » and its key say: « suivante » when another notification waits. */
  const later = <button type="button" onClick={p.onLater}>{p.more > 0 ? c.laterNext : c.later}<Kbd>Esc</Kbd></button>;
  /** The link under the buttons that opens the item in Ledge Desktop (O), when the buttons are not that already. */
  const seeLink = (label: string) => <button type="button" onClick={p.onOpen}>{label}<Kbd>O</Kbd></button>;
  const routineBusy = locked || !p.onRoutine;
  return (
    <div className="di-island" data-phase={phase} data-kind={card.kind} data-ledge={ledge ? LEDGE_RIM[card.kind as LedgeKind] : undefined} data-reduced={p.reduced || undefined} style={size} onMouseEnter={p.onEnter} onMouseLeave={p.onLeave}>
      <div className="di-seed" aria-hidden="true">{logo}<Tone kind={card.kind} /></div>
      <div ref={setRef} className="di-card" inert={!open} role={notice ? 'button' : 'group'} tabIndex={notice && open ? 0 : undefined}
        aria-label={notice ? (card.kind === 'offline' ? L.openMachines : c.openAria(card.who)) : undefined} data-card={card.kind}
        style={p.maxH ? { maxHeight: p.maxH } : undefined}
        onClick={notice ? p.onOpen : undefined} onKeyDown={notice ? e => { if (e.key === 'Enter') { e.preventDefault(); p.onOpen(); } } : undefined}>
        <div className="di-head">
          <span className="di-logo">
            {logo}
            {notice && <svg className="di-ring" viewBox="0 0 34 34" aria-hidden="true"><rect className="di-track" x="1" y="1" width="32" height="32" rx="11" /><rect key={`${running}|${Math.round(left)}`} className="di-left" data-ring data-running={running || undefined} data-left={Math.round(left)} x="1" y="1" width="32" height="32" rx="11" {...drain} /></svg>}
          </span>
          <div className="di-id">
            <span className="di-line"><span className="di-badge" data-kind={card.kind}>{badge}</span><span className="di-sentence">
              {ledge ? <Bold text={card.sentence ?? card.who} bold={card.bold} /> : <><b>{card.who}</b> {c.say[card.kind as AgentKind]}{title ? ` · ${title}` : ''}</>}
            </span></span>
            {(meta || p.more > 0) && <span className="di-meta">{meta}{p.more > 0 ? <em>{meta ? ' · ' : ''}{c.more(p.more)}</em> : null}</span>}
          </div>
        </div>
        {preview && <p className="di-preview" data-mono={card.kind !== 'finished' || undefined}>{card.kind === 'finished' ? inline(preview) : preview}</p>}
        {hasBody && <div ref={body} className="di-body" data-scrolls={scrolls || undefined}>
          {card.kind === 'permission' && card.cmd && <div className="di-command"><span className="di-chip-k" title={card.tool || 'Bash'}>{card.tool || 'Bash'}</span><code>{card.cmd}</code></div>}
          {card.kind === 'question' && card.text && <p className="di-question">{card.text}</p>}
          {card.kind === 'question' && quick && <>
            {!!card.options?.length && <div role="radiogroup" aria-label={c.choices} className="di-choices">
              {card.options.map((o, i) => <button key={`${i}:${o}`} type="button" role="radio" aria-checked={choice === i} disabled={locked} className="di-choice"
                onFocus={e => e.currentTarget.scrollIntoView?.({ block: 'nearest' })}
                onClick={() => { setChoice(i); setReply(''); setNudge(false); }}><Kbd>{i + 1}</Kbd><span>{o}</span></button>)}
            </div>}
            <input className="di-reply" data-reply type="text" maxLength={140} placeholder={c.short} aria-label={c.short} value={reply} disabled={locked}
              onFocus={e => e.currentTarget.scrollIntoView?.({ block: 'nearest' })}
              onChange={e => { setReply(e.target.value); if (e.target.value) setChoice(null); setNudge(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); answer(); } }} />
          </>}
        </div>}
        {!notice && <>
          {nudge && !acting && <span className="di-note" data-tone="bad" role="alert">{c.choose}</span>}
          {card.routine?.stale && !p.failure && <span className="di-note" data-tone="warn" role="status">{card.routine.stale}</span>}
          {/* A session's refused decision says what to do next; Ledge's own refusals are already whole sentences (routines, cards 32-33). */}
          {p.failure && !p.ack && <span className="di-note" data-tone="bad" role="status">{ledge ? p.failure : c.failed(p.failure)}</span>}
          {!p.failure && p.blocked && <span className="di-note" role="status">{p.blocked}</span>}
          <div className="di-actions">
            {card.kind === 'permission' && !handOff && <>
              <Button variant="primary" size="sm" disabled={locked} onClick={() => p.onDecide('accept')}>{c.approve}<Kbd accent>Y</Kbd></Button>
              <Button variant="outline" size="sm" disabled={locked} onClick={() => p.onDecide('deny')}>{c.deny}<Kbd>N</Kbd></Button>
            </>}
            {card.kind === 'question' && !handOff && <Button variant="primary" size="sm" disabled={locked} onClick={answer}>{c.reply}</Button>}
            {review && <Button variant="primary" size="sm" onClick={p.onOpen}>{c.review}</Button>}
            {!ledge && !review && handOff && <Button variant="primary" size="sm" onClick={p.onOpen}>{c.open}<Kbd accent>O</Kbd></Button>}
            {/* A rig's question: its proposed answers, the suggested one first in coral; without any, one « Répondre dans Ledge ». */}
            {card.kind === 'rig' && (card.choices?.length
              ? card.choices.map((o, i) => <Button key={o.id} variant={i === 0 ? 'primary' : 'outline'} size="sm" disabled={locked} onClick={() => p.onChoice?.(o.id)}>{o.label}</Button>)
              : <Button variant="primary" size="sm" onClick={p.onOpen}>{L.answerIn}<Kbd accent>O</Kbd></Button>)}
            {card.kind === 'decision' && <Button variant="primary" size="sm" onClick={p.onOpen}>{L.see}<Kbd accent>O</Kbd></Button>}
            {card.kind === 'routine' && card.routine && <>
              <Button variant="primary" size="sm" disabled={routineBusy || card.routine.count === 0 || !card.routine.canApprove} onClick={() => p.onRoutine?.('approve')}>{card.routine.count > 1 ? t.routine.activateAll(card.routine.count) : t.routine.activate}</Button>
              <Button variant="outline" size="sm" disabled={routineBusy || card.routine.count === 0} onClick={() => p.onRoutine?.('refuse')}>{t.routine.refuse}</Button>
            </>}
            {card.kind === 'routineFailed' && <Button variant="primary" size="sm" disabled={routineBusy} onClick={() => p.onRoutine?.('run')}>{t.routine.retry}</Button>}
            {p.ack === 'received' ? <span className="di-ack" role="status">{c.confirmed}</span>
              : acting ? <span className="di-ack" role="status">{c.pending}</span>
              : <span className="di-foot">
                {!ledge && !handOff && seeLink(c.open)}
                {card.kind === 'rig' && !!card.choices?.length && seeLink(L.answerIn)}
                {(card.kind === 'routine' || card.kind === 'routineFailed') && seeLink(L.see)}
                {later}
              </span>}
          </div>
        </>}
      </div>
    </div>
  );
}
