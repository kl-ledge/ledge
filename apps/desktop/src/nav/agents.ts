import { orderedSessions, type Projects, type Session } from '@ledge/protocol';

const TOOLS: Record<Session['tool'], string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', agy: 'Antigravity CLI', omp: 'OMP' };
export const toolName = (tool: Session['tool']): string => TOOLS[tool];
export const taskOf = (s: Session): string => s.topic ?? s.title;
/** The machine an agent runs on: the fleet's label, else its id. */
export const machineOf = (s: Session): string => s.machineName ?? s.machineId ?? 'local';

/** Agents grouped by project in the projects' order, « Sans projet » last; within a project the order the person chose (issue #16,
 *  kept by the daemon), then the others oldest first (a new one at the bottom). The shared sort of @ledge/protocol. */
export function mainOrder(sessions: readonly Session[], projects: Projects | null): Session[] {
  if (projects) return orderedSessions(sessions, projects);
  // Projects not known yet: oldest first, then by id, as before.
  const at = (s: Session) => Date.parse(s.startedAt) || 0;
  return [...sessions].sort((x, y) => at(x) - at(y) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Agents principaux ni hors ligne ni terminés : le compteur « Atelier » et la bulle de Ledge. */
export function activeCount(sessions: readonly Session[]): number {
  return sessions.filter(s => !s.offline && s.state !== 'exited').length;
}

export const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchSessions(sessions: readonly Session[], query: string, projectName: (s: Session) => string): Session[] {
  const q = fold(query.trim());
  if (!q) return [...sessions];
  return sessions.filter(s => fold([s.name, taskOf(s), toolName(s.tool), s.machineName ?? '', projectName(s)].join('\n')).includes(q));
}

export type Dot = 'working' | 'approval' | 'question' | 'done' | 'offline' | 'error';
export function dotOf(s: Session): Dot {
  if (s.offline) return 'offline';
  switch (s.state) {
    case 'waiting_permission': return 'approval';
    case 'waiting_input': return 'question';
    case 'exited': case 'idle': return 'done';
    case 'error': return 'error';
    default: return 'working';
  }
}
