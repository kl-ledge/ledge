import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ISLAND_PREFS, labelledName, type IslandPrefs, type Session } from '@ledge/protocol';
import { providerOf } from '@ledge/ui/logos/ProviderLogo';
import { useDaemon } from '../daemon/store';
import type { DaemonClient } from '../daemon/client';
import { createSurfaceController } from './controller';
import { waitingCount, type Item, type SurfaceState } from './machine';
import { Island, ISLAND, type Card } from './Island';
import { islandAxis, type IslandPosition } from './geometry';
import { frameOf } from './frame';
import { useMeasuredHeight } from './useMeasuredHeight';
import { useDaemonAsks } from './useDaemonAsks';
import { useLedgeNotices } from './useLedgeNotices';
import { openInLedge, subscribeOpenInLedge } from '../desktop/openInLedge';
import { useSounds } from '../sounds/useSounds';
import { createSilentPlayer, type SoundPlayer } from '../sounds/player';
import { useMotionPreferences } from '../motionPreferences';
import { useI18n } from '../i18n/lang';
import { onShortcut, onNewSessionShortcut, focusOverlay, releaseFocus } from '../tauri/bridge';
import { useNativeFrame } from '../tauri/useNativeFrame';

/** No region at all: nothing on screen takes the mouse, every click goes through (dev-back's `set_frame` 0 × 0). */
const NO_FRAME = { left: 0, top: 0, w: 0, h: 0 } as const;
/** The frame waits out the open card's size transition before it shrinks back to the pill. */
const SETTLE_MS = 460;
/** The start of a last reply shown on a finish card: two lines at most are drawn, this is plenty to fill them. */
const PREVIEW_CHARS = 280;

export interface SurfaceProps {
  /** The work area in logical px (the page itself is never zoomed). */
  screenH: number; screenW?: number;
  client: DaemonClient; dnd: boolean;
  /** The island's axis on the top edge, and its size (a CSS zoom on its layer). */
  islandPosition?: IslandPosition; islandScale?: number;
  soundPlayer?: SoundPlayer;
  /** The island's settings from Ledge Desktop: hidden, nothing is drawn and nothing opens; `shows.finished` and `shows.quick` apply. */
  visible?: boolean; shows?: IslandPrefs['shows'];
}

/** A turn's last reply on one line: its whitespace folded, cut where two lines could never reach. */
const firstWords = (text: string) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat; };

/** What the island says of `item`, read from its session; null when there is nothing to draw (yet). */
export function cardOf(item: Item, s: Session | undefined): Card | null {
  if (!s) return null;
  // Its nickname before its name when it has one, « KB Projet 1 (Otto) » (docs/mockups/ledge-sidebar-names.html, card 2).
  const base = { id: s.id, who: labelledName(s), provider: providerOf(s.tool), project: s.project, branch: s.branch };
  if (item.kind === 'finished') return { ...base, kind: 'finished', text: s.lastReply?.text ? firstWords(s.lastReply.text) : undefined };
  if (item.kind === 'error') return { ...base, kind: 'error', text: s.lastError };
  if (item.kind !== 'ask' || !s.pending) return null;
  const p = s.pending;
  if (p.kind === 'permission') return { ...base, kind: 'permission', cmd: p.text, tool: p.tool };
  if (p.kind === 'question') return { ...base, kind: 'question', text: p.text, options: p.options };
  return { ...base, kind: p.kind, text: p.text };
}

export function Surface({ screenH, screenW = window.innerWidth, client, dnd, islandPosition = 'center', islandScale = 1, soundPlayer, visible = true, shows = DEFAULT_ISLAND_PREFS.shows }: SurfaceProps) {
  const { sessions, byId, status, lastError } = useDaemon();
  const { t } = useI18n();
  const reduced = useMotionPreferences().reduced;
  const quick = shows.quick;
  const [ctl] = useState(() => createSurfaceController({ onState: s => setSt(s) }));
  const [st, setSt] = useState<SurfaceState>(() => ctl.state());
  const dispatch = ctl.dispatch;
  useEffect(() => () => ctl.dispose(), [ctl]);
  const live = useRef({ visible, finished: shows.finished }); live.current = { visible, finished: shows.finished };

  useEffect(() => { dispatch({ type: 'reduced', on: reduced }); }, [reduced, dispatch]);
  // Do not disturb closes the island and keeps the requests; turning it off reopens nothing.
  useEffect(() => { dispatch({ type: 'dnd', on: dnd }); }, [dnd, dispatch]);
  // Hidden from Desktop: nothing on screen at once; the requests wait and open once it is shown again.
  useEffect(() => { dispatch({ type: 'visible', on: visible }); }, [visible, dispatch]);
  // A hidden document holds a notice's clock.
  useEffect(() => {
    const sync = () => dispatch({ type: 'visibility', hidden: document.hidden });
    if (document.hidden) sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [dispatch]);

  // Daemon changes drive the island: a request queues, a finish or an error becomes a 6 s notice, every change plays its cue.
  const player = useMemo(() => soundPlayer ?? createSilentPlayer(), [soundPlayer]);
  const sounds = useSounds({ player, dnd, status });
  const asks = useDaemonAsks({ sessions, status, lastError, dnd, dispatch, onChange: c => {
    sounds.onChange(c);
    if (!live.current.visible) return;
    if (c.kind === 'finished' && live.current.finished) dispatch({ type: 'notice', id: c.id, kind: 'finished' });
    // A failed decision keeps its request (the card says why): only a turn that stopped on its own is an error notice.
    if (c.kind === 'failed' && !byId.get(c.id)?.pending) dispatch({ type: 'notice', id: c.id, kind: 'error' });
  } });
  // Ledge's own notices: a rig's question, a decision, a routine (requests), a machine offline (a notice).
  const ledge = useLedgeNotices({ client, dispatch, byId, status, t, dnd, visible, onAnswered: cue => sounds.user(cue) });

  // Ctrl+Alt+L reopens the oldest request still waiting, and takes the focus so its keys arrive; without one it does nothing.
  useEffect(() => onShortcut(() => {
    if (!live.current.visible || ctl.state().queue.length === 0) return;
    dispatch({ type: 'shortcut' });
    void focusOverlay();
  }), [ctl, dispatch]);
  // Ctrl+Alt+N asks Ledge Desktop for a new session.
  useEffect(() => onNewSessionShortcut(() => { openInLedge({ kind: 'launch' }); }), []);
  // The island opened from the keyboard gives the focus back once it has left.
  const wasKeyboard = useRef(false);
  useEffect(() => {
    if (st.openedBy === 'keyboard') wasKeyboard.current = true;
    else if (st.current === null && wasKeyboard.current) { wasKeyboard.current = false; void releaseFocus(); }
  }, [st.openedBy, st.current]);

  // The card stays drawn from its last known session while it closes, even once the daemon has dropped it.
  const lastCard = useRef<Card | null>(null);
  const ledgeItem = !!st.current && (st.current.kind === 'ledge' || st.current.kind === 'offline');
  const found = st.current ? (ledgeItem ? ledge.card(st.current) : cardOf(st.current, byId.get(st.current.id))) : null;
  if (found) lastCard.current = found;
  const card = st.current ? found ?? (lastCard.current?.id === st.current.id ? lastCard.current : null) : null;
  // An item with nothing to draw (its session gone before it opened) is closed at once.
  useEffect(() => { if (st.current && !card && !st.closing) dispatch({ type: 'dismiss' }); }, [st.current, card, st.closing, dispatch]);

  // A card coming from rest is first drawn off the edge, then let out on the next frame, so it can come out.
  const [entering, setEntering] = useState(false);
  const hadCurrent = useRef(false);
  const currentId = st.current?.id ?? null;
  if (currentId !== null && !hadCurrent.current && !entering && !reduced) setEntering(true);
  hadCurrent.current = currentId !== null;
  useEffect(() => {
    if (!entering) return;
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setEntering(false)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [entering]);

  const blockedFor = (s: Session | undefined): string | null => status === 'unreachable' ? t.offline : s?.source === 'hook_only' ? t.readOnlyBlocked : s ? null : t.offline;
  /** One decision command per request: false when blocked or already in flight. */
  const decide = (id: string, d: 'accept' | 'deny'): boolean => {
    if (blockedFor(byId.get(id)) !== null || !asks.begin(id)) return false;
    client.send({ type: 'session.decide', id, decision: d }); sounds.user(d === 'accept' ? 'accept' : 'deny');
    dispatch({ type: 'decided' });
    return true;
  };
  const reply = (id: string, text: string) => {
    if (blockedFor(byId.get(id)) !== null || !asks.begin(id)) return;
    asks.replied(id, text);
    client.send({ type: 'session.reply', id, text }); sounds.user('accept');
    dispatch({ type: 'decided' });
  };
  /** The item in Ledge Desktop: a session, or what a Ledge notice points to (« À toi », a routine's page, the machines). */
  const open = () => {
    const c = ctl.state().current; if (!c) return;
    if (c.kind === 'ledge' || c.kind === 'offline') ledge.open(c); else openInLedge({ kind: 'session', id: c.id });
    dispatch({ type: 'dismiss' });
  };

  // The open island's keys: Y, N, 1-9, O, Esc. Letters never fire inside the field; Enter on a focused button keeps its click.
  const cardEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = ctl.state();
      if (s.phase !== 'open' || s.closing || !s.current || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') { e.preventDefault(); dispatch({ type: s.current.kind === 'ask' ? 'defer' : 'dismiss' }); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); open(); return; }
      if (s.current.kind !== 'ask' || s.ack || !quick) return;
      const pending = byId.get(s.current.id)?.pending;
      if (pending?.kind === 'permission' && k === 'y') { e.preventDefault(); decide(s.current.id, 'accept'); }
      else if (pending?.kind === 'permission' && k === 'n') { e.preventDefault(); decide(s.current.id, 'deny'); }
      else if (pending?.kind === 'question' && /^[1-9]$/.test(k)) { e.preventDefault(); cardEl.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[Number(k) - 1]?.click(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Said to a screen reader when Ledge Desktop is asked to open something, or could not.
  const [handoff, setHandoff] = useState<string | null>(null);
  useEffect(() => subscribeOpenInLedge((target, outcome) => {
    if (outcome !== 'opening') { setHandoff(t.handoff[outcome]); return; }
    const handed = target.kind === 'session' ? byId.get(target.id) : undefined;
    setHandoff(target.kind === 'session' ? `${t.handoff.session(handed ? labelledName(handed) : target.id)}…` : null);
  }), [byId, t]);

  // Where the island is drawn, in real px: its axis on the top edge, 8 px under it, at its size; the frame follows it.
  const s = islandScale;
  const openH = useMeasuredHeight(cardEl, !!card, s, card?.id);
  const axis = islandAxis(screenW, islandPosition);
  const openBox = st.phase === 'open' && !entering;
  const w = (openBox ? ISLAND.openW : ISLAND.seedW) * s;
  const h = (openBox ? openH || ISLAND.seedH : ISLAND.seedH) * s;
  // The anchor sits on the axis, kept far enough from the edges for the open card.
  const anchorX = Math.min(Math.max(axis, (ISLAND.openW * s) / 2), Math.max((ISLAND.openW * s) / 2, screenW - (ISLAND.openW * s) / 2));
  const left = anchorX - w / 2;
  const frame = card && visible ? frameOf({ left, top: ISLAND.top * s, w, h }, [], { w: screenW, h: screenH }) : NO_FRAME;
  useNativeFrame(frame, reduced ? 200 : SETTLE_MS);
  // The card never passes the work area: its choices scroll first.
  const maxH = Math.max(160, screenH / s - ISLAND.top - 32);

  const ack = st.ack && st.current && st.ack.id === st.current.id;
  const failure = !st.current ? null : ledgeItem ? ledge.failure(st.current.id) : st.failed === st.current.id ? asks.failures[st.current.id] ?? t.lost : null;
  const remaining = ctl.noticeRemaining() ?? undefined;
  const held = st.hovering || st.focusWithin || st.hidden;
  if (!visible) return null;
  return (
    <>
      <div data-surface data-phase={st.phase} data-closing={st.closing || undefined} data-quiet={st.quiet || undefined} data-current={st.current?.id} style={{ position: 'absolute', left: 0, top: 0, zoom: s }}>
        <div className="di-anchor" style={{ left: anchorX / s }}
          onFocus={() => { if (!ctl.state().focusWithin) dispatch({ type: 'focusWithin', on: true }); }}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) dispatch({ type: 'focusWithin', on: false }); }}>
          {card && <Island card={card} phase={st.phase} entering={entering} more={waitingCount(st)} ack={ack ? (st.ack!.confirmed ? 'received' : 'sent') : null} deciding={(ledgeItem ? ledge.busy(card.id) : asks.inFlight.has(card.id)) && !ack}
            blocked={st.current?.kind === 'ask' ? blockedFor(byId.get(card.id)) : st.current?.kind === 'ledge' ? ledge.blocked(card.id) : null} failure={failure} quick={quick}
            leftMs={remaining} held={held} reduced={reduced} maxH={maxH} cardRef={cardEl}
            onEnter={() => dispatch({ type: 'surfaceEnter' })} onLeave={() => dispatch({ type: 'surfaceLeave' })}
            onDecide={d => { if (st.current) decide(st.current.id, d); }} onReply={text => { if (st.current) reply(st.current.id, text); }}
            onLater={() => dispatch({ type: 'defer' })} onOpen={open}
            onChoice={id => { if (st.current) ledge.choose(st.current.id, id); }} onRoutine={a => { if (st.current) ledge.routine(st.current.id, a); }} />}
        </div>
      </div>
      <div aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{handoff}</div>
    </>
  );
}
