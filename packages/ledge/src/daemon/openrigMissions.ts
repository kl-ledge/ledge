import { KERNEL_RIG, type Exchange, type ExchangeDelivery, type Mission, type MissionChild, type MissionRowState, type MissionWait, type OpenRigMissionsChanged, type OpenRigState } from '@ledge/protocol';
import { operatorOf } from './openrigGoals.js';
import { fetchHttp, type RigHttp } from './openrigHuman.js';

/**
 * #54: the operator's thread, « Missions » and « Échanges » (docs/mockups/ledge-operator-rigs-panel.html, Missions in version C).
 * Everything is read from OpenRig as it keeps it; nothing is asked of the operator or the rigs.
 *
 * - A mission is a row the operator (the kernel's `operator.agent`) gave a seat of another rig, followed down its handoffs to the open
 *   row at the end. Its holder's rows are attached by deduction, and only when sure (MissionChild's `by`); a row that fits no rule is not
 *   shown rather than guessed.
 * - « Échanges »: the members' messages (`GET /api/queue/outbox/list?rig=`, every `rig send`, with OpenRig's delivery state; the envelope
 *   is taken off its text when it reads as OpenRig writes it today, the body is kept whole otherwise), the rows given, handed on, blocked
 *   and ended (each row's journal, `GET /api/queue/<id>/transitions`). A queue wake (`wake-intent-*`) is not a message: its delivery state
 *   goes on its row's entry. A send to several seats is one entry.
 * - The outbox has no cursor and no event on delivery: it is read again on each queue event and on a timer, entries deduplicated by id.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const rowsOf = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);

const OPEN = new Set<string>(['pending', 'in-progress', 'blocked']);
const ENDS = new Set<string>(['done', 'canceled', 'failed', 'denied']);
/** How far a chain of handoffs is followed, backwards from an open row or forwards from a child. */
const CHAIN_MAX = 8;
/** One list read's limit; a read that fills it may leave rows out (partial). */
const LIST_LIMIT = 2000;
/** « Échanges »: entries wanted by default, and the most a front may ask. */
export const EXCHANGES_DEFAULT = 50;
export const EXCHANGES_MAX = 500;
/** A message's or a title's line, at most. */
const LINE_MAX = 300;
/** Sends to several seats within this of each other, from one sender with one text, are one entry. */
const GROUP_MS = 2_000;
/** Closed children's titles sent, at most (their count is whole). */
const CLOSED_TITLES_MAX = 12;
/** How many reads run at once against OpenRig. */
const PARALLEL = 6;
const QITEM_ID = /qitem-\d{14}-[0-9a-f]{8,}/g;

/** The rig of a seat address (`dev@ledge-dev`, `dev@ledge-dev@host`): its second part. */
export const rigOf = (seat: string): string => seat.split('@')[1] ?? '';
/** A person, not a seat (`ledge@external`): their rows are « Demandes » (#40), never missions or exchanges here. */
const isPerson = (seat: string): boolean => rigOf(seat) === 'external';
const oneLine = (t: string): string => {
  const l = t.replace(/\s+/g, ' ').trim();
  return l.length > LINE_MAX ? `${l.slice(0, LINE_MAX - 1)}…` : l;
};
const titleOf = (r: Json): string => oneLine(str(r.summary) ?? (str(r.body) ?? '').trim().split(/\r?\n/).find(Boolean) ?? str(r.qitemId) ?? '');
const handedOn = (r: Json): boolean => str(r.state) === 'handed-off' || !!str(r.handedOffTo) || str(r.closureReason) === 'handed_off_to';
/** A block on something outside OpenRig (`--blocked-on external:<text>`), not on a row. */
const isExternal = (on: string): boolean => on.startsWith('external:');
const isOpen = (r: Json): boolean => OPEN.has(str(r.state) ?? '');

/** The queue's own notes, not a holder's words: creation, claim, the wakes and blockers OpenRig records itself. */
export function isSystemNote(note: string): boolean {
  return note === 'created' || note === 'claimed' || /^(auto-unparked|blocker |unclaimed|reclaimed|released|wake |queue[ -])/i.test(note);
}

/** A message's text without OpenRig's envelope (« Urgent (marked by …): », From/To/Sent, ---, the « ↩ Reply » foot), when it reads as
 *  written today; otherwise the body whole (`enveloped: false`): the format is not a contract, and nothing is cut on a guess. */
export function messageText(body: string): { text: string; urgent: boolean; enveloped: boolean } {
  const u = /^Urgent \(marked by [^)\n]*\):\r?\n/.exec(body);
  const rest = u ? body.slice(u[0].length) : body;
  const m = /^From: [^\n]*\nTo: [^\n]*\nSent: [^\n]*\n---\n([\s\S]*?)(?:\n---\n↩ Reply:[^\n]*)?\s*$/.exec(rest);
  if (!m) return { text: body, urgent: !!u, enveloped: false };
  return { text: m[1]!.trim(), urgent: !!u, enveloped: true };
}

const DELIVERY: readonly ExchangeDelivery[] = ['delivered', 'indeterminate', 'failed', 'pending'];
const deliveryOf = (v: unknown): ExchangeDelivery => (DELIVERY.includes(v as ExchangeDelivery) ? v as ExchangeDelivery : 'indeterminate');
/** Several recipients' states as one: delivered only when every one is; otherwise the worst of them. */
const worst = (a: ExchangeDelivery, b: ExchangeDelivery): ExchangeDelivery => {
  const rank: Record<ExchangeDelivery, number> = { delivered: 0, indeterminate: 1, pending: 2, failed: 3 };
  return rank[a] >= rank[b] ? a : b;
};

/** The outbox's entries as « Échanges »: messages only (a send to several seats is one), and the wakes' delivery by row. */
export function messagesOf(entries: readonly Json[]): { messages: Exchange[]; wakes: Map<string, ExchangeDelivery> } {
  const wakes = new Map<string, ExchangeDelivery>();
  const messages: Exchange[] = [];
  const sorted = [...entries].sort((a, b) => (str(a.tsDispatched) ?? '').localeCompare(str(b.tsDispatched) ?? ''));
  const open = new Map<string, { e: Exchange; at: number }>();
  for (const x of sorted) {
    const id = str(x.outboxId), from = str(x.senderSession), to = str(x.destinationSession), at = str(x.tsDispatched);
    if (!id || !from || !to || !at) continue;
    if (id.startsWith('wake-intent-')) {
      const row = str(x.auditPointer);
      if (row?.startsWith('qitem-')) wakes.set(row, wakes.has(row) ? worst(wakes.get(row)!, deliveryOf(x.deliveryState)) : deliveryOf(x.deliveryState));
      continue;
    }
    const { text, urgent } = messageText(str(x.body) ?? '');
    const line = oneLine(text), t = Date.parse(at), key = `${from}\n${line}`;
    const prev = open.get(key);
    if (prev && t - prev.at <= GROUP_MS && !prev.e.to.includes(to)) {
      prev.e.to.push(to);
      if (!prev.e.rigs.includes(rigOf(to))) prev.e.rigs.push(rigOf(to));
      prev.e.delivery = worst(prev.e.delivery!, deliveryOf(x.deliveryState));
      prev.at = t;
      continue;
    }
    const e: Exchange = {
      id: `m:${id}`, at, kind: 'message', from, to: [to], rigs: [...new Set([rigOf(from), rigOf(to)])], text: line,
      delivery: deliveryOf(x.deliveryState), ...(urgent || x.urgency === 'urgent' ? { urgent: true } : {})
    };
    messages.push(e);
    open.set(key, { e, at: t });
  }
  return { messages, wakes };
}

/** A row's entries in « Échanges », from its journal: given (or handed on, for a successor), each block, its end. */
export function rowExchanges(row: Json, steps: readonly Json[], rows: ReadonlyMap<string, Json>, wakes: ReadonlyMap<string, ExchangeDelivery>): Exchange[] {
  const id = str(row.qitemId), from = str(row.sourceSession), to = str(row.destinationSession);
  if (!id || !from || !to) return [];
  const title = titleOf(row), rigs = [...new Set([rigOf(from), rigOf(to)])];
  const out: Exchange[] = [];
  const wake = wakes.get(id);
  out.push({ id: `r:${id}:given`, at: str(row.tsCreated) ?? str(steps[0]?.ts) ?? '', kind: str(row.handedOffFrom) ? 'handed' : 'given', from, to: [to], rigs, text: title, qitemId: id, ...(wake ? { delivery: wake } : {}) });
  let prev: string | null = null;
  steps.forEach((s, i) => {
    const st = str(s.state), at = str(s.ts) ?? '', actor = str(s.actorSession) ?? to;
    if (st === 'blocked' && prev !== 'blocked') {
      // Who it waits on is known for the block in force only (the row's `blockedOn`); an earlier one says just that it blocked.
      const last = !steps.slice(i + 1).some(n => str(n.state) !== 'blocked');
      const on = last && str(row.state) === 'blocked' ? str(row.blockedOn) : null;
      const holder = on && !isExternal(on) ? str(rows.get(on)?.destinationSession) : null;
      out.push({ id: `r:${id}:blocked:${String(s.transitionId ?? i)}`, at, kind: 'blocked', from: actor, to: holder ? [holder] : [], rigs: [...new Set([rigOf(actor), ...(holder ? [rigOf(holder)] : [])])], text: title, qitemId: id });
    }
    // A close that hands on to a new row (`handedOffTo`) is that row's « handed »; one « handed_off_to » a seat without a new row
    // (the result goes back to it) is an end.
    if (st && ENDS.has(st) && !str(row.handedOffTo)) {
      out.push({ id: `r:${id}:end`, at, kind: 'done', from: actor, to: [], rigs: [rigOf(actor)], text: title, qitemId: id, outcome: st as Exchange['outcome'] });
    }
    prev = st;
  });
  return out;
}

/** The holder's notes on a row (`rig queue update --note`, a block's note…), oldest first: the queue's own left out. */
export function holderNotes(row: Json, steps: readonly Json[]): { at: string; by: string; text: string }[] {
  const holder = str(row.destinationSession);
  return steps.flatMap(s => {
    const note = str(s.transitionNote), actor = str(s.actorSession);
    return note && actor && actor === holder && !isSystemNote(note) ? [{ at: str(s.ts) ?? '', by: actor, text: note }] : [];
  });
}

/** Since when the row is in its state: its journal's last change into it, else its last update. */
function sinceOf(row: Json, steps: readonly Json[]): string {
  let since: string | null = null, prev: string | null = null;
  for (const s of steps) { const st = str(s.state); if (st !== prev && st === str(row.state)) since = str(s.ts); prev = st; }
  return since ?? str(row.tsUpdated) ?? str(row.tsCreated) ?? '';
}

export interface MissionsDeps { state: () => Promise<OpenRigState>; http?: RigHttp; now?: () => number }
export type MissionsRead = Omit<OpenRigMissionsChanged, 'type' | 'requestId' | 'machineId'>;
export interface MissionsService { list(exchanges?: number): Promise<MissionsRead> }

/** Reads for « Missions » and « Échanges ». A row's journal is reused while the row is unchanged. */
export function createMissions(deps: MissionsDeps): MissionsService {
  const http = deps.http ?? fetchHttp, now = deps.now ?? Date.now;
  const journals = new Map<string, { updated: string; steps: Json[] }>();

  const read = async (want: number): Promise<MissionsRead> => {
    const st = await deps.state();
    const none = (openrig: MissionsRead['openrig']): MissionsRead => ({ openrig, operator: null, missions: [], exchanges: [], exchangesMore: false });
    if (!st.installed) return none('absent');
    if (st.daemon.state === 'stopped') return none('stopped');
    if (st.daemon.state !== 'running' || !st.daemon.port) return none('unreachable');
    const url = `http://127.0.0.1:${st.daemon.port}`;
    let partial = false;
    const get = async (path: string): Promise<unknown> => {
      const r = await http('GET', `${url}${path}`);
      return r.status === 200 ? r.json : undefined;
    };
    /** A list, or undefined when it could not be read (partial); a list that fills `limit` may leave rows out (partial too). */
    const list = async (path: string, limit = LIST_LIMIT, fullIsPartial = true): Promise<Json[] | undefined> => {
      const j = await get(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}`);
      if (!Array.isArray(j)) { partial = true; return undefined; }
      if (fullIsPartial && j.length >= limit) partial = true;
      return rowsOf(j);
    };
    const rowCache = new Map<string, Json | null>();
    const row = async (id: string): Promise<Json | null> => {
      if (rowCache.has(id)) return rowCache.get(id)!;
      const j = obj(await get(`/api/queue/${encodeURIComponent(id)}`));
      const r = str(j.qitemId) === id ? j : null;
      rowCache.set(id, r);
      return r;
    };
    const keep = (r: Json) => { const id = str(r.qitemId); if (id) rowCache.set(id, r); };
    /** A row's journal, or null when it could not be read. */
    const journal = async (r: Json): Promise<Json[] | null> => {
      const id = str(r.qitemId)!, updated = str(r.tsUpdated) ?? '';
      const known = journals.get(id);
      if (known && known.updated === updated) return known.steps;
      const j = await get(`/api/queue/${encodeURIComponent(id)}/transitions`);
      if (!Array.isArray(j)) return null;
      const steps = rowsOf(j).sort((a, b) => (str(a.ts) ?? '').localeCompare(str(b.ts) ?? ''));
      journals.set(id, { updated, steps });
      return steps;
    };
    const successor = async (id: string): Promise<Json | null | undefined> => {
      const l = await list(`/api/queue/list?handedOffFrom=${encodeURIComponent(id)}`, 5);
      if (!l) return undefined;
      l.forEach(keep);
      return l[0] ?? null;
    };
    /** A row followed down its handoffs: its chain, and whether its end was reached. */
    const forward = async (r: Json): Promise<{ chain: Json[]; whole: boolean }> => {
      const chain = [r];
      for (let cur = r; handedOn(cur); ) {
        if (chain.length >= CHAIN_MAX) return { chain, whole: false };
        const next = await successor(str(cur.qitemId)!);
        // Closed `done` « handed_off_to » someone with no new row (the result goes back to them): an end, whole.
        if (next === null && ENDS.has(str(cur.state) ?? '') && !str(cur.handedOffTo)) return { chain, whole: true };
        if (!next) return { chain, whole: false };
        chain.push(next); cur = next;
      }
      return { chain, whole: true };
    };

    const rigs = st.rigs.map(r => r.name);
    const operator = operatorOf(st);

    // ── Échanges: the messages, then the rows of the same span ──
    const limit = Math.min(1000, Math.max(100, want * 2));
    const boxes = await pool(rigs, rig => list(`/api/queue/outbox/list?rig=${encodeURIComponent(rig)}`, limit, false).then(l => ({ l, full: (l?.length ?? 0) >= limit })));
    const entries = new Map<string, Json>();
    let cutoff: string | null = null;
    for (const { l, full } of boxes) {
      for (const e of l ?? []) { const id = str(e.outboxId); if (id) entries.set(id, e); }
      // A list cut by its limit is whole only down to its oldest entry: nothing older is shown, for any rig.
      if (full && l?.length) {
        const oldest = l.map(e => str(e.tsDispatched) ?? '').sort()[0]!;
        if (!cutoff || oldest > cutoff) cutoff = oldest;
      }
    }
    // A full list only means older messages exist (« Voir plus ancien »): not a read that failed.
    const { messages, wakes } = messagesOf([...entries.values()]);
    // The rows' span: down to the messages' cutoff, else a time that grows with what is asked.
    const span = new Date(now() - Math.ceil(want / EXCHANGES_DEFAULT) * 24 * 3600_000).toISOString();
    const since = cutoff ?? span;
    const changed = await list(`/api/queue/list?updatedSince=${encodeURIComponent(since)}`) ?? [];
    changed.forEach(keep);
    const inRigs = (seat: string) => rigs.includes(rigOf(seat));
    const exchangeRows = changed.filter(r => {
      const s = str(r.sourceSession) ?? '', d = str(r.destinationSession) ?? '';
      return !isPerson(s) && !isPerson(d) && !str(r.humanIntent) && (inRigs(s) || inRigs(d));
    });
    const rowEntries = (await pool(exchangeRows, async r => {
      const steps = await journal(r);
      if (!steps) partial = true;
      const on = str(r.blockedOn);
      if (str(r.state) === 'blocked' && on && !isExternal(on)) await row(on);
      return rowExchanges(r, steps ?? [], rowCache as Map<string, Json>, wakes);
    })).flat();
    const all = [...messages, ...rowEntries].filter(e => e.at >= since).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
    const exchanges = all.slice(0, want);
    const exchangesMore = all.length > want || !!cutoff || since === span;

    // ── Missions ──
    const missions: Mission[] = [];
    if (operator) {
      const open = await list('/api/queue/list?state=pending,in-progress,blocked') ?? [];
      open.forEach(keep);
      /** The operator's row an open row comes from, backwards along `handedOffFrom`: its chain from that row, or null. */
      const fromOperator = async (r: Json): Promise<Json[] | null> => {
        const back = [r];
        for (let cur: Json | null = r; cur; ) {
          if (str(cur.sourceSession) === operator) return back.reverse();
          const prev = str(cur.handedOffFrom);
          if (!prev || back.length >= CHAIN_MAX) return null;
          cur = await row(prev);
          if (!cur) { partial = true; return null; }
          back.push(cur);
        }
        return null;
      };
      const chains = (await pool(open, async r => {
        const d = str(r.destinationSession) ?? '';
        if (isPerson(d) || rigOf(d) === KERNEL_RIG || str(r.humanIntent)) return null;
        const chain = await fromOperator(r);
        return chain && rigOf(str(chain[0]!.destinationSession) ?? '') !== KERNEL_RIG ? chain : null;
      })).filter((c): c is Json[] => !!c);

      // Every mission's hands, open and recent, for the « only mission it held » rule: a seat holding two at once attaches neither's rows
      // by time. The operator's rows changed since the oldest open mission began, followed down their handoffs.
      const start = chains.map(c => str(c[0]!.tsCreated) ?? '').sort()[0];
      type Tenure = { seat: string; from: string; to: string; root: string };
      const tenures: Tenure[] = [];
      const tenureOf = (r: Json, root: string): Tenure => ({
        seat: str(r.destinationSession) ?? '', from: str(r.tsCreated) ?? '', root,
        to: isOpen(r) ? new Date(now()).toISOString() : str(r.tsUpdated) ?? ''
      });
      if (start) {
        const given = await list(`/api/queue/list?sourceSession=${encodeURIComponent(operator)}&updatedSince=${encodeURIComponent(start)}`) ?? [];
        given.forEach(keep);
        const roots = new Map<string, Json>([...given, ...chains.map(c => c[0]!)].map(r => [str(r.qitemId)!, r]));
        for (const r of roots.values()) {
          const d = str(r.destinationSession) ?? '';
          if (isPerson(d) || rigOf(d) === KERNEL_RIG) continue;
          const own = chains.find(c => str(c[0]!.qitemId) === str(r.qitemId));
          const chain = own ?? (await forward(r)).chain;
          for (const c of chain) tenures.push(tenureOf(c, str(r.qitemId)!));
        }
      }
      const sole = (seat: string, at: string, root: string) =>
        !tenures.some(t => t.seat === seat && t.root !== root && t.from <= at && at <= t.to);
      const holderRows = new Map<string, Promise<Json[] | undefined>>();
      const madeBy = (seat: string, since: string) => {
        const k = `${seat}\n${since}`;
        if (!holderRows.has(k)) holderRows.set(k, list(`/api/queue/list?sourceSession=${encodeURIComponent(seat)}&updatedSince=${encodeURIComponent(since)}`).then(l => { l?.forEach(keep); return l; }));
        return holderRows.get(k)!;
      };

      for (const chain of chains) {
        const root = chain[0]!, cur = chain.at(-1)!;
        const rootId = str(root.qitemId)!, curId = str(cur.qitemId)!;
        let mine = false;
        const steps = await pool(chain, journal);
        if (steps.some(s => !s)) mine = true;
        const notes = chain.flatMap((r, i) => holderNotes(r, steps[i] ?? [])).sort((a, b) => a.at.localeCompare(b.at));
        const cited = new Set(notes.flatMap(n => n.text.match(QITEM_ID) ?? []));
        const inChain = new Set(chain.map(r => str(r.qitemId)!));
        const blockedOn = str(cur.blockedOn);
        // The holders' rows: each chain row's holder, over its own tenure.
        const found = new Map<string, { r: Json; by: MissionChild['by'] }>();
        const rank = { blocked_on: 0, cited: 1, created: 2 } as const;
        const attach = (r: Json, by: MissionChild['by']) => {
          const id = str(r.qitemId)!;
          if (inChain.has(id) || isPerson(str(r.destinationSession) ?? '') || str(r.humanIntent)) return;
          const had = found.get(id);
          if (!had || rank[by] < rank[had.by]) found.set(id, { r, by });
        };
        for (const c of chain) {
          const t = tenureOf(c, rootId), seat = t.seat;
          const made = await madeBy(seat, t.from);
          if (!made) { mine = true; continue; }
          for (const r of made) {
            const at = str(r.tsCreated) ?? '';
            if (at >= t.from && at <= t.to && sole(seat, at, rootId)) attach(r, 'created');
          }
        }
        for (const id of cited) {
          if (inChain.has(id)) continue;
          const r = await row(id);
          if (r) attach(r, 'cited'); else mine = true;
        }
        let waitsOn: MissionWait | null = null;
        if (blockedOn && !isExternal(blockedOn)) {
          const r = await row(blockedOn);
          if (r) attach(r, 'blocked_on'); else mine = true;
          waitsOn = { kind: 'row', qitemId: blockedOn, title: r ? titleOf(r) : null, holder: r ? str(r.destinationSession) : null, state: r ? str(r.state) : null };
        } else if (blockedOn) {
          waitsOn = { kind: 'external', text: oneLine(blockedOn.replace(/^external:/, '')) };
        }
        // Each attached row at the end of its own handoffs: still open, or ended.
        const children: MissionChild[] = [];
        const closed: { at: string; title: string }[] = [];
        for (const { r, by } of found.values()) {
          const { chain: down, whole } = await forward(r);
          const end = down.at(-1)!;
          if (!whole) mine = true;
          if (isOpen(end)) {
            const s = await journal(end);
            if (!s) mine = true;
            children.push({ qitemId: str(end.qitemId)!, title: titleOf(r), holder: str(end.destinationSession) ?? '', state: str(end.state) as MissionRowState, since: sinceOf(end, s ?? []), by });
          } else if (whole) {
            closed.push({ at: str(end.tsUpdated) ?? '', title: titleOf(r) });
          }
        }
        children.sort((a, b) => a.since.localeCompare(b.since));
        closed.sort((a, b) => b.at.localeCompare(a.at));
        const last = notes.at(-1);
        if (mine) partial = true;
        missions.push({
          qitemId: curId, rootQitemId: rootId, rig: rigOf(str(cur.destinationSession) ?? ''), state: str(cur.state) as MissionRowState,
          since: sinceOf(cur, steps.at(-1) ?? []), title: titleOf(cur), from: str(cur.sourceSession) ?? '', to: str(cur.destinationSession) ?? '',
          waitsOn, lastNote: last ? { at: last.at, by: last.by, text: oneLine(last.text) } : null,
          children, closed: { count: closed.length, titles: closed.slice(0, CLOSED_TITLES_MAX).map(c => c.title) },
          ...(mine ? { partial: true } : {})
        });
      }
      missions.sort((a, b) => b.since.localeCompare(a.since));
    }
    return { openrig: 'ok', operator, missions, exchanges, exchangesMore, ...(partial ? { partial: true } : {}) };
  };

  /** One read at a time, in the order asked: an older read never lands after a newer one. */
  let reading: Promise<unknown> = Promise.resolve();
  const list: MissionsService['list'] = (exchanges = EXCHANGES_DEFAULT) => {
    const want = Math.min(EXCHANGES_MAX, Math.max(1, Math.floor(exchanges)));
    const next = reading.then(() => read(want), () => read(want));
    reading = next.catch(() => undefined);
    return next;
  };
  return { list };
}

/** `f` over `items`, PARALLEL at a time, results in order. */
async function pool<T, R>(items: readonly T[], f: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]!); }
  }));
  return out;
}
