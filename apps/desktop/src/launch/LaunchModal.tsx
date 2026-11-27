import { useContext, useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { cleanName, nameHolder, nameRefusal, namesInUse, type OmpApproval, type Project, type Session } from '@ledge/protocol';
import { splitId } from '@ledge/fleet';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { SHELL_ICONS } from '../shell/icons';
import { useI18n, type Messages } from '../i18n/lang';
import { cls } from '../shell/cls';
import { Menu, MenuItem } from '../shell/Menu';
import { ModalTitleSlot } from '../shell/Modal';
import { PROVIDER_TITLES, ProviderLogo } from '../ide/ProviderLogo';
import { providerOf } from '../workspace/sessionTab';
import { tilde } from '../openrig/roles/model';
import { useDefaultTool } from '../settings/tool';
import { resetShort, type UsageGroup } from '../usage/model';
import { isUp, launchDefaults, missingOf, previewOf, reposOn, withMachine, withPick, withProject, withTool, type LaunchForm, type LaunchMessage, type Tool } from './model';
import { agentLimit, projectRows, type ProjectRow } from './modalModel';
import { useRepoInfo } from './useRepoInfo';
import { useModels } from './useModels';
import { loadPick } from './modelPrefs';
import { ModelPicker } from './ModelPicker';
import { launchKeys, ompBlocked, sentMessage } from './send';
import type { LaunchState } from './useLaunch';

export type LaunchWhere = 'active' | 'right';

const TOOLS: readonly Tool[] = ['claude', 'codex', 'cursor', 'agy', 'omp'];
const APPROVALS: readonly OmpApproval[] = ['always-ask', 'write', 'yolo'];

const onRow = (f: LaunchForm, r: ProjectRow) => f.project === r.project && f.machine === r.machine && f.repos[0] === r.path;
/** A row taken: its project, its machine, its one folder (R3), and the model remembered for that project. */
function takeRow(f: LaunchForm, projects: readonly Project[], r: ProjectRow): LaunchForm {
  const g = { ...withMachine(withProject(f, projects, r.project), projects, r.machine), repos: [r.path] };
  return withPick(g, loadPick(r.project, g.tool));
}
/** The row to stand on when the current one is gone or offline: one online in the same project, else one online anywhere. */
const onlineRow = (rows: readonly ProjectRow[], project: string | null) => rows.find(r => r.project === project && r.up) ?? rows.find(r => r.up);

/** An agent's limit line (5 h; Cursor: the month, else the week): « Limite 5 h <b>84 %</b> · réinit. 14:20 », the percent amber past the threshold and red at 100 % (the usage
 *  footer's tones); none read, « Limite non lue ». */
function LimitLine({ limit, lang, now, m }: { limit: ReturnType<typeof agentLimit>; lang: string; now: number; m: Messages['launch']['modal'] }): JSX.Element {
  if (!limit) return <small>{m.limitUnread}</small>;
  const reset = limit.resetsAt ? resetShort(limit.resetsAt, now, lang) : null;
  return <small>{withPart(x => (limit.kind === 'month' ? m.limitMonth : limit.kind === 'seven_day' ? m.limitWeek : m.limit)(x, reset), <b className={limit.tone || undefined}>{`${limit.pct} %`}</b>)}</small>;
}

/** A sentence with one strong part (the branch, a limit's percent), wherever the language puts it. */
function withPart(text: (x: string) => string, part: ReactNode): ReactNode {
  const [before, after] = text('\u0001').split('\u0001');
  return <>{before}{part}{after}</>;
}

/** The IDE's « Nouvelle session » form, in a Modal (docs/mockups/ledge-ide-interactive.html, launchPage()): one row per field, the project
 *  as one of its folders on a machine, each agent's 5 h limit on its tile, and where the session opens. It sends as LaunchComposer does
 *  (send.ts): nothing while a field is missing, a launch is in flight or OMP cannot run on the machine. */
export function LaunchModal(p: {
  client: DaemonClient; projects: readonly Project[]; machines: readonly MachineState[]; sessions: readonly Session[];
  projectIdOf(s: Session): string | null; wanted: { project?: string; filter?: string };
  usage: { groups: readonly UsageGroup[]; threshold: number; now: number };
  /** Where « Ouvrir » starts (openWhere); changed here for this session only. */
  where: LaunchWhere;
  launch: LaunchState;
  onLaunch(msg: LaunchMessage, preview: { name: string; project: string; projectId: string }, where: LaunchWhere): void;
  onNewProject(): void; onCancel(): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const m = t.launch.modal;
  const { projects, machines } = p;
  const [defaultTool] = useDefaultTool();
  const rows = useMemo(() => projectRows(projects, machines), [projects, machines]);
  const [form, setForm] = useState<LaunchForm>(() => {
    const f = launchDefaults(projects, machines, p.wanted, defaultTool);
    const r = rows.find(x => onRow(f, x) && x.up) ?? onlineRow(rows, f.project) ?? rows.find(x => x.project === f.project);
    return r ? takeRow(f, projects, r) : withPick(f, loadPick(f.project, f.tool));
  });
  const [where, setWhere] = useState<LaunchWhere>(p.where);
  const [tried, setTried] = useState(false);
  const [menu, setMenu] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  // docs/mockups/ledge-sidebar-names.html, card 4 (proposal A, which replaces #15's switch): the name the session will get stands in the
  // box's title; a click or F2 makes it a field there. Escape goes back to Ledge's pick.
  const [editing, setEditing] = useState(false);
  const slot = useContext(ModalTitleSlot);
  // The field gone (kept or dropped), the keyboard goes back to the name in the title: Ctrl+Entrée still launches from there.
  const nameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  // Only when it was lost with the field: a click elsewhere (the first message) keeps what it clicked.
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!editing && wasEditing.current && lost) nameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const id = useId();

  const project = projects.find(x => x.id === form.project);
  const chosen = machines.find(x => x.id === form.machine);
  const online = !!chosen && isUp(chosen);
  const infos = useRepoInfo(p.client, online ? form.machine : null, reposOn(project, form.machine).map(r => r.path));
  const models = useModels(p.client, online ? form.machine : null, form.tool);
  const outdated = models.error === 'outdated';
  const unavailable = ompBlocked(form, online, models, chosen?.daemon);
  const approvable = chosen?.daemon?.ompApproval === true;
  const memo = loadPick(form.project, form.tool);
  const remembered = !!memo?.remembered && memo.model === form.model && memo.effort === form.effort;

  // A row gone (a project or a folder removed) or its machine going offline: a row online, in the same project first.
  useEffect(() => {
    setForm(f => {
      if (rows.find(r => onRow(f, r))?.up) return f;
      const to = onlineRow(rows, f.project);
      return to ? takeRow(f, projects, to) : f;
    });
  }, [rows, projects]);
  // The chosen folder not found on its machine is let go for the project's first one there that is (LaunchComposer's rule).
  useEffect(() => {
    setForm(f => (f.repos[0] !== undefined && infos.get(f.repos[0])?.exists === false && f.machine !== null ? withMachine(f, projects, f.machine, infos) : f));
  }, [infos, projects]);

  const missing = missingOf(form, machines);
  // The name Ledge would give (the field's placeholder, and what an empty or switched-off field leaves to the daemon).
  const auto = previewOf({ ...form, name: '' }, p.sessions, p.projectIdOf).name;
  // The name typed in the title, as the session will carry it; checked against the live sessions of the chosen machine,
  // whose daemon refuses a taken name (name_taken) — so « Lancer » does not send it.
  const typed = form.name ?? '';
  const clean = cleanName(typed);
  const live = p.sessions.filter(s => (splitId(s.id)?.machine ?? s.machineId ?? 'local') === form.machine && s.state !== 'exited' && !s.archivedAt);
  const refused = nameRefusal(namesInUse(live), typed) !== undefined;
  const holder = refused ? nameHolder(live, typed) : undefined;
  const holderProject = holder ? projects.find(x => x.id === p.projectIdOf(holder))?.name : undefined;
  const nameError = !refused ? null
    : !holder ? m.nameReserved
    : holder.name.toLowerCase() === clean.toLowerCase() && holderProject ? m.nameTaken(clean, holderProject)
    : m.nameTakenBy(clean, holder.name);
  const alert = refused ? t.launch.missing.name : !missing ? null : missing === 'repos' && projects.length === 0 ? t.launch.noProjects : t.launch.missing[missing];
  const launching = p.launch.status === 'launching';
  const submit = () => {
    setTried(true);
    if (refused || missing || launching || !project || unavailable) return;
    // No name (none typed, or nothing left once cleaned): the daemon picks the first free one, so two launches never race for it.
    const { name: _auto, ...msg } = sentMessage(form, project.id, auto, { outdated, approvable });
    // Ledge's own pick left as it is goes unsent too: the daemon chooses again at launch, so two launches never race for it.
    p.onLaunch(clean && clean !== auto ? { ...msg, name: clean } : msg, { name: clean || auto, project: project.name, projectId: project.id }, where);
  };

  const row = rows.find(r => onRow(form, r));
  const branch = form.repos[0] ? infos.get(form.repos[0])?.branch : null;
  const lbl = (k: string) => `${id}-${k}`;
  // The field opens on the name shown (Ledge's pick when none was typed), selected, as the sidebar's rename does.
  const edit = () => { if (editing) return; setEditing(true); setForm(f => ({ ...f, name: f.name || auto })); };
  // Enter, Tab or a click elsewhere keeps the name; emptied, the session takes the one Ledge picks. Escape goes back to Ledge's pick.
  // Ledge's pick kept as it is is not pinned: another machine, or a launch elsewhere, may change it before « Lancer ».
  const keepName = () => { setForm(f => (cleanName(f.name ?? '') === auto ? { ...f, name: '' } : f)); setEditing(false); };
  const dropName = () => { setForm(f => ({ ...f, name: '' })); setEditing(false); };
  const keys = launchKeys(submit);
  const shown = clean || auto;

  return (
    <form className="launch-modal" onSubmit={e => { e.preventDefault(); submit(); }}
      onKeyDown={e => { if (e.key === 'F2' && !editing) { e.preventDefault(); edit(); return; } keys(e); }}>
      {slot && createPortal(editing ? (
        <span className="launch-modal-tname">
          <span className="dot" aria-hidden="true">·</span>
          <input autoFocus className={cls('launch-modal-tfield', refused && 'bad')} value={typed} placeholder={auto} maxLength={100} spellCheck={false} autoComplete="off"
            aria-label={m.name} aria-invalid={refused || undefined} aria-describedby={lbl('sub')}
            onFocus={e => e.currentTarget.select()}
            onChange={e => { const name = e.target.value; setForm(f => ({ ...f, name })); }}
            onBlur={keepName}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dropName(); }
              else if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); keepName(); }
            }} />
        </span>
      ) : (
        <span className="launch-modal-tname">
          <span className="dot" aria-hidden="true">·</span>
          <button ref={nameButton} type="button" className={cls('launch-modal-tbtn', refused && 'bad')} title={m.renameTip} aria-label={`${m.renameTip} · ${shown}`} onClick={edit}>
            {shown}<Icon d={SHELL_ICONS.pencil} size={12} />
          </button>
        </span>
      ), slot)}
      <p id={lbl('sub')} className={cls('launch-modal-sub', nameError && 'bad')} role={nameError ? 'alert' : undefined}>
        {nameError ?? (editing ? (clean && clean !== typed.trim() ? m.cleaned(clean) : m.editHint(auto)) : `${m.opensIn[where]} ${m.keys}`)}
      </p>
      <div className="launch-modal-fld">
        <span className="launch-modal-lbl" id={lbl('project')}>{m.project}</span>
        {projects.length === 0 ? (
          <div className="launch-modal-empty">
            <span>{t.launch.noProjects}</span>
            <Button variant="outline" size="sm" onClick={p.onNewProject}><Icon d={ICONS.plus.d} size={14} />{t.launch.newProject}</Button>
          </div>
        ) : (
          <div className="launch-modal-prj">
          <Menu open={menu} onOpenChange={setMenu} label={m.project} className="launch-modal-menu" menuClassName="launch-modal-rows"
            trigger={tr => (
              <button type="button" id={lbl('row')} className="launch-modal-inp" aria-labelledby={`${lbl('project')} ${lbl('row')}`} {...tr}>
                <b>{project?.name ?? '—'}</b>
                <span className="mut">· {form.repos[0] ? tilde(form.repos[0]) : t.launch.noRepo} · {chosen?.label ?? form.machine ?? '—'}</span>
                <span className="car" aria-hidden="true">▾</span>
              </button>
            )}>
            {rows.map(r => (
              <MenuItem key={r.key} disabled={!r.up} aria-current={r === row || undefined} className={cls(r === row && 'on')}
                onSelect={() => setForm(f => takeRow(f, projects, r))}>
                <span>{r.projectName}</span><span className="mut">· {tilde(r.path)} · {r.machineLabel}</span>{!r.up && <small>{m.offline}</small>}
              </MenuItem>
            ))}
          </Menu>
          </div>
        )}


        <span className="launch-modal-lbl">{m.where}</span>
        <div className="launch-modal-txt">{branch ? withPart(m.onBranch, <span className="mono">⎇ {branch}</span>) : m.inFolder}</div>

        <span className="launch-modal-lbl" id={lbl('agent')}>{m.agent}</span>
        <div>
          <div className="launch-modal-agents" role="group" aria-labelledby={lbl('agent')}>
            {TOOLS.map(tool => (
              <button type="button" key={tool} className={cls('launch-modal-agent', form.tool === tool && 'on')} aria-pressed={form.tool === tool}
                onClick={() => { if (tool !== form.tool) setForm(f => withTool(f, tool, loadPick(f.project, tool))); }}>
                <span className="an"><span aria-hidden="true"><ProviderLogo provider={providerOf(tool)} size={16} /></span><span>{t.launch.tools[tool][0]}</span></span>
                <small>{PROVIDER_TITLES[providerOf(tool)]}</small>
                {tool === 'agy' ? <small>{m.noLimitRead}</small> : <LimitLine limit={agentLimit(p.usage.groups, tool, form.machine, p.usage.threshold, p.usage.now)} lang={lang} now={p.usage.now} m={m} />}
              </button>
            ))}
          </div>
          {unavailable !== null && <p className="launch-modal-alert" role="alert">{form.tool === 'agy' ? (unavailable === 'outdated' ? t.launch.agyOutdated : t.launch.agyUnavailable(unavailable)) : unavailable === 'outdated' ? t.launch.ompOutdated : t.launch.ompUnavailable(unavailable)}</p>}
        </div>

        <span className="launch-modal-lbl">{m.model}</span>
        <div className="launch-modal-model">
          {online && !unavailable && (outdated ? <small className="models-note">{t.launch.modelsOutdated}</small>
            : <ModelPicker key={`${form.machine}|${form.tool}|${form.project}`} tool={form.tool} state={models} pick={form} remembered={remembered} logos onPick={pick => setForm(f => withPick(f, pick))} />)}
        </div>

        {form.tool === 'omp' && !unavailable && <>
          <span className="launch-modal-lbl" id={lbl('perm')}>{m.permissions}</span>
          {approvable ? (
            <div className="launch-modal-segc" role="radiogroup" aria-labelledby={lbl('perm')}>
              {APPROVALS.map(a => (
                <label key={a} className={cls(form.approval === a && 'on')} title={t.launch.approvals[a][1]}>
                  <input type="radio" name={lbl('approval')} checked={form.approval === a} onChange={() => setForm(f => ({ ...f, approval: a }))} />{t.launch.approvals[a][0]}
                </label>
              ))}
            </div>
          ) : <small className="launch-modal-txt models-note">{online ? t.launch.approvalOutdated : null}</small>}
        </>}

        <label className="launch-modal-lbl" htmlFor={lbl('msg')}>{m.message}</label>
        <textarea id={lbl('msg')} ref={field} className="launch-modal-ta" value={form.prompt} aria-invalid={tried && !form.prompt.trim()}
          onChange={e => { const prompt = e.target.value; setForm(f => ({ ...f, prompt })); }} />

        <span className="launch-modal-lbl" id={lbl('open')}>{m.open}</span>
        <div className="launch-modal-radios" role="radiogroup" aria-labelledby={lbl('open')}>
          {(['active', 'right'] as const).map(w => (
            <label key={w} className="launch-modal-radio">
              <input type="radio" name={lbl('where')} checked={where === w} onChange={() => setWhere(w)} />{w === 'active' ? m.openActive : m.openRight}
            </label>
          ))}
        </div>

        {form.tool === 'agy' && <><span /><small className="models-note">{t.launch.agyHint}</small></>}

        <span />
        <div className="launch-modal-go">
          <Button variant="primary" type="submit" aria-disabled={refused || !!missing || launching || unavailable !== null}>
            {launching ? t.launch.launching : m.launch}<Kbd accent>{m.launchKeys}</Kbd>
          </Button>
          <Button variant="outline" type="button" onClick={p.onCancel}>{m.cancel}</Button>
          {tried && alert ? <span className="launch-modal-alert" role="alert">{alert}</span>
            : p.launch.status === 'refused' ? <span className="launch-modal-alert" role="alert">{t.launch.refused(p.launch.message)}</span>
            : p.launch.status === 'timeout' ? <span className="launch-modal-alert" role="alert">{t.launch.timeout}</span> : null}
        </div>
      </div>
    </form>
  );
}
