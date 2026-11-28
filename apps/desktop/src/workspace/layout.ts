import { isRecord, readJson, writeJson } from '../state/storage';

/** The IDE shell's panel layout: pure state, plus its persisted form (`ledge.ide.layout`). */
export type SideView = 'projects' | 'rigs' | 'prs' | 'routines' | 'tasks';
/** Every sidebar view, as the Ledge guide (docs/ledge-guide.md) describes them: a Record, so a new view fails to compile until it is listed. */
const SIDE_VIEW: Record<SideView, true> = { projects: true, rigs: true, prs: true, routines: true, tasks: true };
export const SIDE_VIEWS = Object.keys(SIDE_VIEW) as SideView[];
/** `right`: the right panel's flag, no longer drawn since the chat left (#40 PR 4); kept so the dispositions saved before read the same. */
export interface IdeLayout { sideOpen: boolean; sideWidth: number; sideView: SideView; bottom: boolean; bottomHeight: number; right: boolean }

export const SIDE_DEFAULT = 248, SIDE_MIN = 120, SIDE_MAX = 440, SIDE_FOLD = 150;
export const BOTTOM_DEFAULT = 240, BOTTOM_MIN = 120, BOTTOM_MAX = 640;
export const LAYOUT_KEY = 'ledge.ide.layout';
const VIEWS: readonly SideView[] = ['projects', 'rigs', 'prs', 'routines', 'tasks'];

export type LayoutAction =
  | { type: 'toggle'; panel: 'side' | 'bottom' }
  | { type: 'show'; panel: 'side' | 'bottom'; on: boolean }
  | { type: 'view'; view: SideView }
  /** The sidebar open on that view, never closed (a « Voir dans Tâches », #40 D3). */
  | { type: 'showView'; view: SideView }
  | { type: 'drag'; width: number }
  | { type: 'drop'; width: number }
  | { type: 'resetWidth' }
  | { type: 'dragBottom'; height: number }
  | { type: 'resetBottom' };

const FIELD = { side: 'sideOpen', bottom: 'bottom' } as const;
const clamp = (w: number) => Math.min(SIDE_MAX, Math.max(SIDE_MIN, w));
const clampBottom = (h: number) => Math.min(BOTTOM_MAX, Math.max(BOTTOM_MIN, Math.round(h)));

/** Returns the same object when the action changes nothing. */
function patch(s: IdeLayout, p: Partial<IdeLayout>): IdeLayout {
  const changed = (Object.keys(p) as (keyof IdeLayout)[]).some(k => s[k] !== p[k]);
  return changed ? { ...s, ...p } : s;
}

export function layoutReducer(s: IdeLayout, a: LayoutAction): IdeLayout {
  switch (a.type) {
    case 'toggle': return patch(s, { [FIELD[a.panel]]: !s[FIELD[a.panel]] });
    case 'show': return patch(s, { [FIELD[a.panel]]: a.on });
    case 'view': return s.sideView === a.view && s.sideOpen ? patch(s, { sideOpen: false }) : patch(s, { sideView: a.view, sideOpen: true });
    case 'showView': return patch(s, { sideView: a.view, sideOpen: true });
    case 'drag': return patch(s, { sideWidth: clamp(a.width) });
    case 'drop': return a.width < SIDE_FOLD ? patch(s, { sideOpen: false, sideWidth: SIDE_DEFAULT }) : patch(s, { sideOpen: true, sideWidth: clamp(a.width) });
    case 'resetWidth': return patch(s, { sideWidth: SIDE_DEFAULT });
    case 'dragBottom': return patch(s, { bottomHeight: clampBottom(a.height) });
    case 'resetBottom': return patch(s, { bottomHeight: BOTTOM_DEFAULT });
  }
}

export function loadLayout(): IdeLayout {
  const raw = readJson(LAYOUT_KEY);
  const r = isRecord(raw) ? raw : {};
  const w = r.sideWidth;
  const h = r.bottomHeight;
  return {
    sideOpen: typeof r.sideOpen === 'boolean' ? r.sideOpen : true,
    sideWidth: typeof w === 'number' && Number.isFinite(w) ? clamp(w) : SIDE_DEFAULT,
    bottomHeight: typeof h === 'number' && Number.isFinite(h) ? clampBottom(h) : BOTTOM_DEFAULT,
    sideView: VIEWS.find(v => v === r.sideView) ?? 'projects',
    bottom: typeof r.bottom === 'boolean' ? r.bottom : false,
    right: typeof r.right === 'boolean' ? r.right : true,
  };
}

export function saveLayout(l: IdeLayout): void {
  writeJson(LAYOUT_KEY, l);
}

/** layoutReducer in the window's width (#40 PR 4: the right panel, the chat's, is gone; nothing else needs the width any more). */
export function layoutFor(l: IdeLayout, a: LayoutAction, _windowWidth: number): IdeLayout {
  return layoutReducer(l, a);
}
