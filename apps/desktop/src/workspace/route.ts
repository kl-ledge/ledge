import type { NavAction, NavState, SectionId } from '../nav/state';
import type { LayoutAction } from './layout';
import type { OpenSession } from './openPrefs';
import type { Tab, Workspace } from './model';
import { openAs, type Intent } from './intent';
import { ATELIER_TAB, SETTINGS_TAB, openrigTab } from './store';

/** What an existing screen's NavAction means in the IDE: a nav change, a tab change, a panel change, and the Tasks view's task
 *  (#40 D3: `task` a task's detail, null its list). */
export interface Routed { nav?: NavAction; ws?: (w: Workspace) => Workspace; layout?: LayoutAction; tasks?: { task: string | null } }

/** `lastSettings`: the section the Settings tab was last left on; a `settings` action without a section (Ctrl+,, the gear) brings
 *  the tab back there, as the activity bar does, rather than on General. */
export function routeNav(a: NavAction, ctx: { isSeat(id: string): boolean; modalOpen: boolean; openSession: OpenSession; lastSettings?: SectionId;
  /** The view a session's new tab starts on (#300), when it is not the thread; an open tab keeps its own. */
  startView?(id: string): 'terminal' | undefined;
  /** How the click that dispatched `a` asks for its tab (workspace/intent): a preview, a kept tab, from a tab. */
  how?: Intent | null }): Routed {
  const how = ctx.how ?? null;
  switch (a.type) {
    case 'open': {
      const view = ctx.startView?.(a.id);
      return { nav: a, ws: w => openAs(w, { kind: ctx.isSeat(a.id) ? 'seat' : 'session', ref: a.id, ...(view ? { view } : {}) }, a.where ?? ctx.openSession, how) };
    }
    case 'home': return { ...(a.project !== undefined ? { nav: { type: 'filter', project: a.project } as NavAction } : {}), ws: w => openAs(w, ATELIER_TAB, 'active', how) };
    // « Tâches » is a view of the activity bar (#40 D3): shown, never toggled off, on the task named.
    case 'tasks': return { layout: { type: 'showView', view: 'tasks' }, tasks: { task: a.task ?? null } };
    case 'settings': return { nav: a.section === undefined && ctx.lastSettings ? { ...a, section: ctx.lastSettings } : a, ws: w => openAs(w, SETTINGS_TAB, 'active', how) };
    case 'openrig': return { nav: a, ws: w => openAs(w, openrigTab(a.machine), 'active', how) };
    case 'escape': return ctx.modalOpen ? { nav: { type: 'modal', modal: null } } : {};
    default: return { nav: a };
  }
}

/** The NavState seen by a tab's content: the real one when it speaks of that tab, else a synthetic place. A Settings tab out of
 *  the place (another group focused) stays on `lastSettings`, the section it was left on. */
export function tabNav(nav: NavState, tab: Tab, lastSettings: SectionId = 'general'): NavState {
  if (tab.kind === 'session' || tab.kind === 'seat') {
    return nav.place.kind === 'session' && nav.place.id === tab.ref ? nav : { ...nav, place: { kind: 'session', id: tab.ref, view: 'atelier', project: 'all' } };
  }
  if (tab.kind === 'settings' && nav.place.kind !== 'settings') {
    return { ...nav, place: { kind: 'settings', section: lastSettings, back: { kind: 'overview', view: 'atelier', project: 'all' } } };
  }
  return nav;
}
