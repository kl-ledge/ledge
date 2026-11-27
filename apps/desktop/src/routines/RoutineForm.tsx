import { useRef, useState, type JSX, type ReactNode } from 'react';
import { WEEKDAYS, type Session, type Tool, type Weekday } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { ProviderLogo } from '../ide/ProviderLogo';
import { providerOf } from '../workspace/sessionTab';
import { ROUTINE_ICONS } from './icons';
import type { DraftErrors, FormFault, Refusal, SpecDraft } from './model';
import { sessionLook } from './RoutinesView';
import { anchorWeek, dateLong, fillPrompt, hhmm, momentLabel } from './schedule';

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'agy', 'omp'];
const TOOL_NAME: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', agy: 'Antigravity CLI', omp: 'OMP' };
const WEEK: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

/** The daemon's preview of the draft's next runs (card 20): its instants, why it cannot say, and whether it differs from what is
 *  saved (amber). Null while nothing can be asked yet. */
export interface PreviewState { runs: readonly string[]; reason?: string; shift: boolean }

export interface RoutineFormProps {
  draft: SpecDraft; onChange(next: SpecDraft): void;
  /** The errors shown (after a save was tried, or the daemon's refusal), and the field to focus once. */
  errors: DraftErrors; focus?: { field: string; n: number } | null;
  /** The field a failed run names, outlined in red (card 8); the parts a session's change asks for, outlined in amber (card 7). */
  fault?: FormFault | null; asked?: ReadonlySet<string>;
  /** A past one-shot's page: the configuration greyed, nothing to edit (card 22). */
  readOnly?: boolean;
  /** The sessions to pick from (the machine's live ones) and how a folder reads (from `~`). */
  sessions: readonly Session[]; dirLabel(path: string): string;
  preview: PreviewState | null;
  /** The previous run's slot, for {last} in the prompt's preview. */
  lastSlot: string | null;
  /** The daemon's refusal of the last save, under the part it names (none: at the head of the configuration; card 28). */
  refusal?: Refusal | null;
  /** Several machines (card 28): the Machine field, at the head of a new routine's configuration. */
  machines?: { choices: readonly { id: string; label: string; up: boolean }[]; value: string; onChange(id: string): void } | null;
  /** The models the tool offers on that machine, as « Nouvelle session » lists them; none: a free field. */
  models?: readonly { id: string; label: string }[];
  /** « Parcourir… »: the machine's folders; resolves with the one chosen. */
  onBrowse?(): Promise<string | null>;
}

/** A labelled row of the configuration (mockup `.fld`). */
function Field({ label, children, id }: { label: string; children: ReactNode; id?: string }): JSX.Element {
  return <div className="rtn-fld"><label htmlFor={id}>{label}</label><div className="rtn-col">{children}</div></div>;
}

/** A routine's configuration (cards 3-5, 19, 20), edited in place: name, session (one that exists, or a new one), the schedule
 *  (recurring: times, days, every week or every two weeks from a reference week; once: dates), the next 3 runs as the daemon
 *  computes them, the missed slot, the prompt with its placeholders and a preview. */
export function RoutineForm(p: RoutineFormProps): JSX.Element {
  const { t, lang } = useI18n();
  const r = t.routines;
  const f = r.form;
  const d = p.draft;
  const ro = !!p.readOnly;
  const set = (patch: Partial<SpecDraft>) => p.onChange({ ...d, ...patch });
  const setSchedule = (patch: Partial<SpecDraft['schedule']>) => set({ schedule: { ...d.schedule, ...patch } });
  const [adding, setAdding] = useState<'time' | 'date' | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  const e = p.errors;
  // The refusal's text under the part it names, that part outlined (card 28).
  const ref = p.refusal;
  const said = (...parts: FormFault[]) => (ref?.part && parts.includes(ref.part) ? <span className="rtn-hint err">{ref.text}</span> : null);
  const bad = (...parts: FormFault[]) => !!ref?.part && parts.includes(ref.part);
  const asked = (k: string) => (p.asked?.has(k) ? ' asked' : '');
  const autoFocus = (field: string) => (p.focus?.field === field ? (el: HTMLElement | null) => { if (el && document.activeElement !== el) el.focus(); } : undefined);

  const addTime = (v: string) => {
    setAdding(null);
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    if (d.schedule.times.includes(v)) { setDup(v); return; }
    setDup(null);
    setSchedule({ times: [...d.schedule.times, v].sort() });
  };
  const addDate = (v: string) => {
    setAdding(null);
    const at = v.slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) || d.schedule.at.includes(at)) return;
    setSchedule({ at: [...d.schedule.at, at].sort() });
  };
  const toggleDay = (day: Weekday) => setSchedule({ days: d.schedule.days.includes(day) ? d.schedule.days.filter(x => x !== day) : WEEKDAYS.filter(x => x === day || d.schedule.days.includes(x)) });
  const insert = (token: string) => {
    const el = prompt.current;
    const at = el ? el.selectionStart : d.prompt.length;
    const end = el ? el.selectionEnd : at;
    set({ prompt: d.prompt.slice(0, at) + token + d.prompt.slice(end) });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };

  const live = p.sessions.filter(s => !s.archivedAt && !s.rig);
  const chosen = live.find(s => s.name === d.target.name && p.dirLabel(s.cwd) === p.dirLabel(d.target.cwd));
  const look = sessionLook(chosen, t);
  const slot = p.preview?.runs[0];
  const once = d.schedule.kind === 'once';

  return (
    <div className={`rtn-form${ro ? ' ro' : ''}`}>
      {ref && !ref.part && <span className="rtn-hint err" role="alert">{ref.text}</span>}
      {p.machines && <Field label={r.machine} id="rtn-machine">
        <span className="rtn-inp rtn-sel rtn-machine">{(() => { const m = p.machines.choices.find(c => c.id === p.machines!.value); return <><span className={`rtn-dot ${m?.up ? 'idle' : 'off'}`} aria-hidden="true" />{m?.label ?? p.machines.value}</>; })()}
          <select id="rtn-machine" value={p.machines.value} onChange={x => p.machines!.onChange(x.target.value)}>{p.machines.choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></span>
      </Field>}
      {!ro && <Field label={f.name} id="rtn-name">
        <input id="rtn-name" ref={autoFocus('name')} className={`rtn-inp${e.name || p.fault === 'name' || bad('name') ? ' err' : ''}${asked('name')}`} value={d.name} readOnly={ro} placeholder="briefing"
          onChange={x => set({ name: x.target.value })} spellCheck={false} />
        {said('name') ?? (e.name === 'invalid' ? <span className="rtn-hint err">{r.err.nameInvalid}</span> : <span className="rtn-hint">{f.nameHint}</span>)}
      </Field>}

      {!ro && <Field label={f.session}>
        <div className={`rtn-radios${asked('session')}`} role="radiogroup" aria-label={f.session}>
          <label className="rtn-radio"><input type="radio" checked={d.mode === 'existing'} onChange={() => set({ mode: 'existing' })} /><span>{f.existing}<small>{f.existingHint}</small></span></label>
          {d.mode === 'existing' && (
            <div className="rtn-sub">
              <div className={`rtn-inp rtn-sel${e.session || p.fault === 'dir' || p.fault === 'session' || bad('session', 'dir') ? ' err' : ''}`} ref={autoFocus('session')}>
                {chosen || d.target.name ? <>
                  <ProviderLogo provider={providerOf(d.target.tool)} size={12} /><b>{d.target.name}</b>
                  <span className={`rtn-dot ${look.dot}`} aria-hidden="true" /><span className="rtn-mut rtn-small">{look.label}</span>
                  <span className="rtn-mono rtn-mut">{p.dirLabel(d.target.cwd)}</span>
                </> : <span className="rtn-mut">{f.pickSession}</span>}
                <select aria-label={f.session} value={chosen?.id ?? ''} onChange={x => { const s = live.find(y => y.id === x.target.value); if (s) set({ target: { name: s.name, cwd: s.cwd, tool: s.tool, model: '' } }); }}>
                  <option value="" disabled>{f.pickSession}</option>
                  {live.map(s => <option key={s.id} value={s.id}>{`${s.name} · ${p.dirLabel(s.cwd)}`}</option>)}
                </select>
              </div>
              {said('session', 'dir') ?? (p.fault === 'dir' ? <span className="rtn-hint err">{r.err.dirExisting}</span> : e.session ? <span className="rtn-hint err">{r.err.session}</span> : null)}
            </div>
          )}
          <label className="rtn-radio"><input type="radio" checked={d.mode === 'new'} onChange={() => set({ mode: 'new' })} /><span>{f.new}<small>{f.newHint}</small></span></label>
          {d.mode === 'new' && (
            <div className="rtn-sub">
              <div className="rtn-fld sm"><label htmlFor="rtn-sname">{f.sName}</label>
                <div className="rtn-col"><input id="rtn-sname" ref={autoFocus('session')} className={`rtn-inp${e.session || bad('session') ? ' err' : ''}`} value={d.target.name} placeholder="Iris"
                  onChange={x => set({ target: { ...d.target, name: x.target.value } })} />
                  {said('session') ?? (e.session ? <span className="rtn-hint err">{r.err.sessionName}</span> : null)}</div></div>
              <div className="rtn-fld sm"><label htmlFor="rtn-dir">{f.dir}</label>
                <div className="rtn-col"><div className="rtn-row-in">
                  <span className={`rtn-inp rtn-grow${e.dir || p.fault === 'dir' || bad('dir') ? ' err' : ''}`}><Icon d={ICONS.folder.d} size={13} />
                    <input id="rtn-dir" ref={autoFocus('dir')} className="rtn-bare rtn-mono" value={d.target.cwd} placeholder="~/assistant" onChange={x => set({ target: { ...d.target, cwd: x.target.value } })} /></span>
                  {p.onBrowse && <button type="button" className="fg-btn" onClick={() => { void p.onBrowse!().then(dir => { if (dir) set({ target: { ...d.target, cwd: dir } }); }); }}>{f.browse}</button>}
                </div>{said('dir') ?? ((e.dir || p.fault === 'dir') && <span className="rtn-hint err">{r.err.dir}</span>)}</div></div>
              <div className="rtn-fld sm"><label htmlFor="rtn-tool">{f.tool}</label>
                <span className={`rtn-inp rtn-sel${p.fault === 'tool' || bad('tool') ? ' err' : ''}`}><ProviderLogo provider={providerOf(d.target.tool)} size={12} />{TOOL_NAME[d.target.tool]}
                  <select id="rtn-tool" value={d.target.tool} onChange={x => set({ target: { ...d.target, tool: x.target.value as Tool, model: '' } })}>{TOOLS.map(x => <option key={x} value={x}>{TOOL_NAME[x]}</option>)}</select></span>{said('tool')}</div>
              <div className="rtn-fld sm"><label htmlFor="rtn-model">{f.model}</label>
                <div className="rtn-col">{p.models?.length
                  // The models « Nouvelle session » lists for this tool on this machine (design-ux point 6); none: a free field.
                  ? <span className={`rtn-inp rtn-sel${p.fault === 'model' || bad('model') ? ' err' : ''}`}>{d.target.model ? (p.models.find(m => m.id === d.target.model)?.label ?? d.target.model) : <span className="rtn-mut">{f.modelDefault}</span>}
                    <select id="rtn-model" value={d.target.model} onChange={x => set({ target: { ...d.target, model: x.target.value } })}>
                      <option value="">{f.modelDefault}</option>{p.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></span>
                  : <input id="rtn-model" className={`rtn-inp${p.fault === 'model' || bad('model') ? ' err' : ''}`} value={d.target.model} placeholder={f.modelDefault} onChange={x => set({ target: { ...d.target, model: x.target.value } })} />}
                  {said('model')}</div></div>
            </div>
          )}
        </div>
      </Field>}

      <Field label={f.kind}>
        <span className={`rtn-seg${asked('schedule')}`} role="radiogroup" aria-label={f.kind}>
          {(['recurring', 'once'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={d.schedule.kind === k} disabled={ro} className={d.schedule.kind === k ? 'on' : undefined} onClick={() => setSchedule({ kind: k })}>{k === 'once' ? f.once : f.recurring}</button>)}
        </span>
      </Field>

      {!once && <>
        <Field label={f.times}>
          <div className={`rtn-chips${asked('schedule')}${p.fault === 'schedule' || bad('schedule') ? ' err' : ''}`} ref={autoFocus('times') as never} tabIndex={-1}>
            {d.schedule.times.map(h => <span key={h} className="rtn-chip">{h}{!ro && <button type="button" className="x" aria-label={`× ${h}`} onClick={() => setSchedule({ times: d.schedule.times.filter(x => x !== h) })}>×</button>}</span>)}
            {adding === 'time'
              ? <input type="time" className="rtn-chip rtn-chip-in" autoFocus aria-label={f.addTime} onKeyDown={x => { if (x.key === 'Enter') addTime(x.currentTarget.value); if (x.key === 'Escape') { x.stopPropagation(); setAdding(null); } }} onBlur={x => addTime(x.currentTarget.value)} />
              : !ro && <button type="button" className="fg-btn ghost" onClick={() => setAdding('time')}><Icon d={ICONS.plus.d} size={12} />{f.addTime}</button>}
          </div>
          {dup && <span className="rtn-hint err">{r.err.dup(dup)}</span>}
          {e.times && <span className="rtn-hint err">{r.err.times}</span>}
          {said('schedule')}
        </Field>
        <Field label={f.days}>
          <div className="rtn-chips">
            <span className="rtn-days" role="group" aria-label={f.days}>
              {WEEKDAYS.map((day, i) => <button key={day} type="button" aria-pressed={d.schedule.days.includes(day)} aria-label={r.days[day]} disabled={ro} className={d.schedule.days.includes(day) ? 'on' : undefined} onClick={() => toggleDay(day)}>{r.letters[i]}</button>)}
            </span>
            {!ro && <><button type="button" className="fg-btn ghost" onClick={() => setSchedule({ days: [...WEEK] })}>{f.presetWeek}</button>
              <button type="button" className="fg-btn ghost" onClick={() => setSchedule({ days: [...WEEKDAYS] })}>{f.presetDaily}</button></>}
          </div>
          {e.days && <span className="rtn-hint err">{r.err.days}</span>}
        </Field>
        <Field label={f.frequency}>
          <div className="rtn-radios" role="radiogroup" aria-label={f.frequency}>
            <label className="rtn-radio"><input type="radio" disabled={ro} checked={d.schedule.weeks === 1} onChange={() => setSchedule({ weeks: 1 })} /><span>{f.weekly}</span></label>
            <label className="rtn-radio"><input type="radio" disabled={ro} checked={d.schedule.weeks === 2} onChange={() => setSchedule({ weeks: 2 })} /><span>{f.biweekly}</span></label>
            {d.schedule.weeks === 2 && (
              <div className="rtn-sub"><div className="rtn-fld anchor"><label htmlFor="rtn-anchor">{f.anchor}</label>
                <div className="rtn-col"><span className={`rtn-inp rtn-date${e.anchor ? ' err' : ''}`}><Icon d={ROUTINE_ICONS.calendar} size={13} />
                  <input id="rtn-anchor" ref={autoFocus('anchor')} type="date" className="rtn-bare rtn-mono" readOnly={ro} value={d.schedule.anchor} onChange={x => setSchedule({ anchor: x.target.value })} /></span>
                  {e.anchor ? <span className="rtn-hint err">{r.err.anchor}</span> : d.schedule.anchor && <span className="rtn-hint">{f.anchorHint(anchorWeek(d.schedule.anchor, lang, r))}</span>}</div></div></div>
            )}
          </div>
        </Field>
      </>}

      {once && <Field label={f.dates}>
        <div className={`rtn-chips${asked('schedule')}${p.fault === 'schedule' || p.fault === 'at' || bad('at', 'schedule') || e.at ? ' err' : ''}`} ref={autoFocus('at') as never} tabIndex={-1}>
          {d.schedule.at.map(a => <span key={a} className={`rtn-chip${e.past?.includes(a) ? ' err' : ''}`}>{momentLabel(a, lang)}{!ro && <button type="button" className="x" aria-label={`× ${a}`} onClick={() => setSchedule({ at: d.schedule.at.filter(x => x !== a) })}>×</button>}</span>)}
          {adding === 'date'
            ? <input type="datetime-local" className="rtn-chip rtn-chip-in" autoFocus aria-label={f.addDate} onKeyDown={x => { if (x.key === 'Enter') addDate(x.currentTarget.value); if (x.key === 'Escape') { x.stopPropagation(); setAdding(null); } }} onBlur={x => addDate(x.currentTarget.value)} />
            : !ro && <button type="button" className="fg-btn ghost" onClick={() => setAdding('date')}><Icon d={ICONS.plus.d} size={12} />{f.addDate}</button>}
        </div>
        {said('at', 'schedule') ?? (e.past?.length || p.fault === 'at' ? <span className="rtn-hint err">{r.err.past}</span> : e.at ? <span className="rtn-hint err">{r.err.date}</span> : null)}
        {!ro && <span className="rtn-hint">{f.onceHint}</span>}
      </Field>}

      {!ro && p.preview && (p.preview.runs.length > 0 || p.preview.reason) && (
        <Field label="">
          <div className={`rtn-prev3${p.preview.shift ? ' shift' : ''}`} aria-live="polite">
            <span className="rtn-lbl">{f.preview3}</span>
            <ol>{p.preview.runs.map(x => <li key={x}><span className="rtn-mono">{hhmm(x)}</span><span>{dateLong(new Date(x), lang)}</span></li>)}</ol>
            {p.preview.reason ? <span className="rtn-hint err">{p.preview.reason}</span> : <span className="rtn-hint">{p.preview.shift ? f.previewShift : f.previewHint}</span>}
          </div>
        </Field>
      )}

      {!ro && <Field label={f.catch}>
        <div className="rtn-radios" role="radiogroup" aria-label={f.catch}>
          <label className="rtn-radio"><input type="radio" checked={d.catchUp === 'once'} onChange={() => set({ catchUp: 'once' })} /><span>{f.catchOnce}<small>{f.catchOnceHint}</small></span></label>
          <label className="rtn-radio"><input type="radio" checked={d.catchUp === 'skip'} onChange={() => set({ catchUp: 'skip' })} /><span>{f.catchSkip}<small>{f.catchSkipHint}</small></span></label>
        </div>
      </Field>}

      <Field label={f.prompt} id="rtn-prompt">
        <textarea id="rtn-prompt" ref={el => { prompt.current = el; if (p.focus?.field === 'prompt' && el && document.activeElement !== el) el.focus(); }}
          className={`rtn-ta${e.prompt || p.fault === 'prompt' || bad('prompt') ? ' err' : ''}${asked('prompt')}`} value={d.prompt} readOnly={ro} placeholder={f.promptPh} rows={3} onChange={x => set({ prompt: x.target.value })} />
        {said('prompt') ?? (e.prompt ? <span className="rtn-hint err">{r.err.prompt}</span> : null)}
        {!ro && <div className="rtn-vars">{f.vars}
          <button type="button" onClick={() => insert('{slot}')}>{'{slot}'}</button>{f.vSlot}
          <button type="button" onClick={() => insert('{date}')}>{'{date}'}</button>{f.vDate}
          <button type="button" onClick={() => insert('{last}')}>{'{last}'}</button>{f.vLast}</div>}
        {!ro && slot && d.prompt.trim() && <div className="rtn-preview">{f.previewAt(hhmm(slot))} <b>{fillPrompt(d.prompt, slot, p.lastSlot)}</b></div>}
      </Field>
    </div>
  );
}
