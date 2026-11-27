import { type CSSProperties, type JSX, type ReactNode } from 'react';
import type { Session } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import type { IdeLayout, LayoutAction } from '../workspace/layout';
import type { Tab } from '../workspace/model';
import { ActivityBar } from './ActivityBar';
import { BottomEdge } from './BottomEdge';
import { IdeExplorer } from './IdeExplorer';
import { IdeStatusBar } from './IdeStatusBar';
import { DispositionsMenu, type DispositionsProps } from './DispositionsMenu';
import { IdeTitleBar } from './IdeTitleBar';
import { noteClick } from '../workspace/intent';
import '../styles/ide.css';

// The chunk's other entries: the editing area and the bottom panel, drawn inside the frame (ide/lazy.tsx).
export { DockHost } from './DockHost';
export { BottomPanel } from './BottomPanel';
export { OutputView } from './OutputView';
export { AtelierBar } from './AtelierBar';
export { RigsView } from './rigs/RigsView';
export { RigView } from './rig/RigView';
export { RigLaunchModal } from './launch-rig/RigLaunchModal';
export { IdePalette } from './palette/IdePalette';
export { OpenRigView } from './openrig/OpenRigView';
export { PrsView } from '../forge/PrsView';
export { PrPage } from '../forge/PrPage';
export { PrsStatus } from '../forge/PrsStatus';
export { PrTabLabel } from '../forge/PrTabLabel';
export { RoutinesView } from '../routines/RoutinesView';
export { RoutinePage } from '../routines/RoutinePage';

export interface IdeFrameProps {
  layout: IdeLayout; onLayout(a: LayoutAction): void;
  /** The sidebar's view, the editing area (DockHost), the status bar's footer. */
  explorer: ReactNode; editor: ReactNode; footer: ReactNode;
  /** The bottom panel (BottomPanel), under the editing area while the layout shows it. */
  bottom: ReactNode;
  /** The harnesses' limits, at the status bar's far right (not inside the footer, which starts it). */
  usage?: ReactNode;
  /** Above the editing area (« daemon outdated »). */
  notice?: ReactNode;
  onSearch(): void;
  /** « Signaler » (issue #9). */
  onReport?(): void;
  /** A dialog is open: the frame takes neither clicks nor the focus. */
  blocked: boolean;
  /** The local daemon is down (`data-readonly`); an agent is dragged onto a project (`is-dragging`). */
  readOnly: boolean; dragging: boolean;
  onTab(t: Tab): void; activeTab: Tab | null; badge: { perm: number; ask: number };
  waiting: readonly Session[]; onNextWaiting(): void;
  /** Lot 8b: the activity bar's badge (open requests whose pipeline failed) and the status bar's count. */
  prsFailing?: number; prsStatus?: ReactNode;
  /** The activity bar's « Routines » badge: to activate, or last run failed (routines mockup, card 1). */
  routinesBadge?: number;
  /** #40 D7: the Rigs icon's amber badge (OpenRig's open requests) and the Tasks icon's (the decisions waiting). */
  requestsBadge?: number; tasksBadge?: number;
  /** « Dispositions », at the status bar's far right (DispositionsMenu). */
  dispositions: DispositionsProps;
}

/** The IDE shell (mockup `titlebar()`, `activity()`, `sidebar()`, `editor()`, `bottomPanel()`, `statusbar()`):
 *  the panels the layout shows, at the mockup's sizes. The chat's right panel left with #40 PR 4. */
export function IdeFrame(p: IdeFrameProps): JSX.Element {
  const { t } = useI18n();
  const { layout, onLayout } = p;
  const columns = {
    '--ide-side': layout.sideOpen ? `${layout.sideWidth}px` : '0px',
    '--ide-right': '0px',
    '--ide-bottom': `${layout.bottomHeight}px`
  } as CSSProperties;
  return (
    <div className={`ide${p.dragging ? ' is-dragging' : ''}`} data-readonly={p.readOnly ? 'true' : undefined}>
      <IdeTitleBar layout={layout} onLayout={onLayout} onSearch={p.onSearch} onReport={p.onReport} blocked={p.blocked} />
      <div className="ide-body" style={columns} inert={p.blocked}>
        <ActivityBar layout={layout} onLayout={onLayout} onTab={p.onTab} activeTab={p.activeTab} badge={p.badge} prsFailing={p.prsFailing} routinesBadge={p.routinesBadge} requestsBadge={p.requestsBadge} tasksBadge={p.tasksBadge} />
        {layout.sideOpen && <IdeExplorer width={layout.sideWidth} onLayout={onLayout}>{p.explorer}</IdeExplorer>}
        <section className="ide-editor" aria-label={t.ide.editorLabel}>
          {p.notice}
          <div className="ide-dock-area">{p.editor}</div>
          {layout.bottom && <div className="ide-bottom-host"><BottomEdge onLayout={onLayout} />{p.bottom}</div>}
        </section>
      </div>
      {/* The next waiting request opens a preview (spec 2026-11-26-preview-tabs §5.2). */}
      <div className="ide-status-row" inert={p.blocked} onClickCapture={e => noteClick(e.nativeEvent)}>
        <IdeStatusBar footer={p.footer} usage={p.usage} waiting={p.waiting} onNextWaiting={p.onNextWaiting} prs={p.prsStatus} disposition={<DispositionsMenu {...p.dispositions} />} />
      </div>
    </div>
  );
}
