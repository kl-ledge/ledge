import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { BROADCAST_SESSIONS_MAX, type Project, type Projects, type Session } from '@ledge/protocol';
import { Icon } from '@ledge/ui/ui/icons';
import type { Filing } from '../../atelier/filing';
import type { Decisions } from '../../fleet/decisions';
import { useI18n } from '../../i18n/lang';
import type { Wait } from '../../list/time';
import type { ContextMenuState } from '../../manage/useContextMenu';
import type { SessionActions } from '../../manage/useSessionActions';
import type { NavAction, NavState } from '../../nav/state';
import { useStored } from '../../state/useStored';
import { cls } from '../cls';
import { SHELL_ICONS } from '../icons';
import { Archives } from './Archives';
import { attentionOf, eyeGroups, treeModel } from './model';
import { loadSidebarPrefs, saveSidebarPrefs } from './prefs';
import { Tree } from './Tree';
import { SidebarMenuHost } from './SidebarMenus';
import type { OrderWriter } from './useReorder';
import type { TasksApi } from '../../tasks/useTasksApi';

/** The IDE's « Projets » view (lot 12c): the project tree, then Archives pinned at the bottom. « À toi » left it (#40 PR 3). */
export function Sidebar(p: {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; archived: readonly Session[];
  projects: Projects | null;
  order: readonly Session[]; projectIdOf: (s: Session) => string | null;
  filing: Filing; actions: SessionActions; decisions: Decisions;
  waits: ReadonlyMap<string, Wait>;
  /** The window's one context menu: a session's (rendered by the app) or one of the sidebar's own (rendered here). While one shows, Échap is its own. */
  menu: ContextMenuState;
  /** A short notice (the toast): « Tout restaurer » says what it did once. */
  notify(text: string): void;
  /** The local daemon takes a broadcast: the ✉ of a project row and the Ctrl/⌘ + click selection are offered. */
  broadcast?: boolean;
  /** Bumped by each broadcast that reached someone: the selection is kept until then, emptied then. */
  broadcastSent?: number;
  onTerminal(s: Session): void;
  revealArchives: number; revealCurrent: number;
  /** Ledge's tasks: the context threshold the tree's gauge reads. */
  tasksApi?: TasksApi;
  /** The small clock on a session a routine wakes (card 12): its tooltip and what a click does; null for none. */
  clock?(s: Session): { tip: string; onClick(): void } | null;
  /** Issue #16: writes the order of projects and sessions the tree is put in; none, nothing moves. */
  orderWriter?: OrderWriter;
}): JSX.Element {
  const { t } = useI18n();
  const [prefs, setPrefs] = useStored(loadSidebarPrefs, saveSidebarPrefs);
  // The sessions picked with Ctrl/⌘ + click, in the order picked: from two, the bar below writes to them (broadcast spec).
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  // What is folded in the tree and whether the Archives are open: here, so the context menus fold too.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [archivesOpen, setArchivesOpen] = useState(false);
  const pick = (id: string) => setPicked(was => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else if (next.size < BROADCAST_SESSIONS_MAX) next.add(id);
    return next;
  });
  // A session gone from the list is no longer picked.
  const pickedIds = [...picked].filter(id => p.sessions.some(s => s.id === id));
  // Sent: the selection has done its job.
  useEffect(() => { if (p.broadcastSent) setPicked(new Set()); }, [p.broadcastSent]);
  const { place } = p.nav;
  const base = place.kind === 'settings' ? place.back : place;
  const current = base.kind === 'session' ? base.id : null;
  // An OpenRig seat is never in the projects' tree: the « Rigs » view shows it.
  const groups = useMemo(() => treeModel(p.order.filter(s => !s.rig), p.projects, p.projectIdOf), [p.order, p.projects, p.projectIdOf]);
  // The eye (docs/mockups/ledge-projects-eye.html): pressed, the projects with a live agent; released, every project.
  const { shown: shownGroups, hidden: hiddenProjects } = useMemo(() => eyeGroups(groups, prefs.hideDone, { dragging: !!p.filing.dragging, filter: base.project }),
    [groups, prefs.hideDone, p.filing.dragging, base.project]);
  const attn = useMemo(() => attentionOf(p.sessions, p.waits), [p.sessions, p.waits]);
  const root = useRef<HTMLElement>(null);
  const keys = useRef({ attn, current, dispatch: p.dispatch, quiet: false });
  keys.current = { attn, current, dispatch: p.dispatch, quiet: p.nav.modal !== null || p.actions.pending !== null || p.menu.menu !== null };
  // Alt ↓ opens the next waiting session. Ctrl ⇧ E focuses its tree row, or the first row when none is open.
  // A dialog, a confirmation, the chat, or a text field already owns the key (same rule as the window shortcuts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const typing = active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable);
      if (typing || keys.current.quiet) return;
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])];
        (nodes.find(el => el.dataset.treeKey === keys.current.current) ?? nodes[0])?.focus();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowDown' && keys.current.attn.length) {
        e.preventDefault();
        const { attn: items, current: open, dispatch } = keys.current;
        const i = items.findIndex(a => a.session.id === open);
        const next = items[(i + 1) % items.length]!;
        dispatch({ type: 'open', id: next.session.id, ...(next.helper ? { helper: next.helper.id } : {}) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Échap empties the selection first, before the window's Escape goes back anywhere (a dialog or a field keeps it).
  const anyPicked = picked.size > 0;
  useEffect(() => {
    if (!anyPicked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || keys.current.quiet) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable)) return;
      e.preventDefault(); e.stopPropagation();
      setPicked(new Set());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [anyPicked]);
  const projectOf = (s: Session): { id: string; name: string; color: Project['color'] } | null => {
    const id = p.projectIdOf(s);
    const found = id ? p.projects?.projects.find(x => x.id === id) : undefined;
    return found ? { id: found.id, name: found.name, color: found.color } : null;
  };
  const projectName = (s: Session) => projectOf(s)?.name ?? t.side.unassigned;
  return (
    // No webview menu anywhere in the sidebar: a row with a menu opens it, elsewhere a right click does nothing; a text field keeps its own (copy, paste).
    <aside ref={root} className={cls('sidebar st', prefs.dense && 'st-dense')} aria-label={t.side.label}
      onContextMenu={e => { if (!(e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]'))) e.preventDefault(); }}>
      {(
        <div className="ide-ex-h">
          {/* No « + N » beside it (the user, 2026-11-09): N still opens Nouvelle session. */}
          <span>{t.side.projects}</span>
        </div>
      )}
      <div className="st-scroll">
        {<section aria-label={t.side.projects}>
          <Tree reorder={{ ...(p.orderWriter ? { write: p.orderWriter } : {}), all: project => p.order.filter(s => p.projectIdOf(s) === project), notify: p.notify }}
            near={p.tasksApi?.near} groups={shownGroups} closed={closed} onClosed={setClosed} sessions={p.sessions} projects={p.projects} current={current} filter={base.project}
            hideDone={prefs.hideDone} hiddenProjects={hiddenProjects} anySession={groups.some(g => g.branches.some(b => b.sessions.length > 0))} dense={prefs.dense} byBranch={prefs.byBranch} filing={p.filing} revealCurrent={p.revealCurrent} paused={p.nav.paused}
            onHome={project => p.dispatch({ type: 'home', ...(project !== undefined ? { project } : {}) })}
            onOpen={(id, helper) => p.dispatch({ type: 'open', id, ...(helper !== undefined ? { helper } : {}) })}
            onLaunch={project => p.dispatch({ type: 'modal', modal: { kind: 'launch', ...(project !== undefined ? { project } : {}) } })}
            onBroadcast={p.broadcast ? project => p.dispatch({ type: 'modal', modal: { kind: 'broadcast', to: { project } } }) : undefined}
            picked={picked} onPick={p.broadcast ? pick : undefined} onOpenRight={id => p.dispatch({ type: 'open', id, where: 'right' })}
            onMenu={(target, at, opener) => p.menu.openOn(target, at, opener)}
            onArchive={ids => p.actions.request('archive', ids)} onDelete={ids => p.actions.request('delete', ids)} onRename={p.menu.rename} renaming={p.menu.renaming ? { session: p.menu.renaming, outdated: p.menu.renameOutdated ? t.side.rename.outdated(p.menu.renameOutdated) : null } : null}
            onRenamed={label => (label !== null ? p.menu.sendRename(label) : p.menu.closeRename())} onTerminal={p.onTerminal}
            onToggleHide={() => setPrefs(v => ({ ...v, hideDone: !v.hideDone }))} onToggleDense={() => setPrefs(v => ({ ...v, dense: !v.dense }))}
            onToggleBranches={() => setPrefs(v => ({ ...v, byBranch: !v.byBranch }))}
            onNewProject={() => p.dispatch({ type: 'modal', modal: { kind: 'project' } })} ide {...(p.clock ? { clock: p.clock } : {})} />
          {p.filing.dragging && <p className="st-help">{t.side.dropHelp(p.filing.dragging.name)}</p>}
        </section>}
      </div>
      {<Archives archived={p.archived} current={current} projectName={projectName} reveal={p.revealArchives} open={archivesOpen} onOpenChange={setArchivesOpen}
        project={s => { const found = projectOf(s); return found ? { color: found.color } : null; }}
        onRead={id => p.dispatch({ type: 'open', id })} onRestore={id => p.actions.restore(id)} onResume={id => p.actions.resume(id)}
        onDelete={ids => p.actions.request('delete', ids)} allowed={p.actions.allowed} paused={p.nav.paused}
        onMenu={(target, at, opener) => p.menu.openOn(target, at, opener)} {...(p.clock ? { clock: p.clock } : {})} />}
      <SidebarMenuHost state={p.menu} projects={p.projects} groups={groups} archived={p.archived} actions={p.actions} dispatch={p.dispatch}
        broadcast={!!p.broadcast} closed={closed} onClosed={setClosed} archivesOpen={archivesOpen} onArchivesOpen={setArchivesOpen} notify={p.notify} />
      {p.broadcast && pickedIds.length >= 2 && (
        <div className="st-picked" role="region" aria-label={t.broadcast.picked}>
          <button type="button" className="st-picked-write" onClick={() => p.dispatch({ type: 'modal', modal: { kind: 'broadcast', to: { sessions: pickedIds } } })}>
            <Icon d={SHELL_ICONS.mail} size={13} /><span>{t.broadcast.selection(pickedIds.length)}</span>
          </button>
          <span className="st-fill" />
          <button type="button" className="st-picked-cancel" onClick={() => setPicked(new Set())}>{t.broadcast.cancel}</button>
        </div>
      )}
    </aside>
  );
}
