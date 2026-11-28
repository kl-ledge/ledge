import type { JSX, ReactNode } from 'react';
import { Icon } from '@ledge/ui/ui/icons';
import { SHELL_ICONS } from '../shell/icons';

/** A card of the summary beside the thread: a title, a figure, and its rows; it folds to its title. */
export function Card({ title, count, children }: { title: string; count?: string; children: ReactNode }): JSX.Element {
  return (
    <details className="cw-card" open>
      <summary><span>{title}</span>{count !== undefined && <span className="cw-count mono">{count}</span>}<Icon d={SHELL_ICONS.chevronDown} size={13} /></summary>
      <div className="cw-card-body">{children}</div>
    </details>
  );
}
