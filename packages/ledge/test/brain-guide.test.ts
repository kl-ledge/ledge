// The guide `ledge brain @ledge` and `@projects` give (#40: it left the chat for brain/guide.ts, the chat being gone).
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACTIONS as REGISTRY, CHAT_ACTIONS as ACTIONS, NEVER_PROPOSED } from '@ledge/protocol';
import { installedAgents, ledgeMd, projectsMd, readGuide } from '../src/brain/guide.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'guide-'));

describe('ledge.md', () => {
  it('finds the hand-written guide in the repository docs', async () => {
    const guide = await readGuide();
    expect(guide).toBe(readFileSync(new URL('../../../docs/ledge-guide.md', import.meta.url), 'utf8'));
  });

  it('holds the guide, then the version, the agents, every action and what is never proposed', () => {
    const md = ledgeMd({ guide: '# Guide\n\nLe guide.', version: '1.2.3', agents: ['claude', 'omp'] });
    expect(md.startsWith('# Guide\n\nLe guide.')).toBe(true);
    expect(md).toContain('- Daemon version: 1.2.3');
    expect(md).toContain('- Agents installed (found on the PATH): claude, omp');
    for (const a of ACTIONS) expect(md).toContain(`- \`${a.id}\` — ${a.summary} — `);
    // The CLI's own (deleting, filing) are never in the chat's reach.
    for (const a of REGISTRY.filter(x => x.chat === false)) expect(md).not.toContain(`- \`${a.id}\` — `);
    for (const n of NEVER_PROPOSED) expect(md).toContain(`- ${n}`);
  });

  it('says what it does not know: a missing guide, version or agents', () => {
    const md = ledgeMd({ guide: null });
    expect(md).toContain('The Ledge guide is missing');
    expect(md).toContain('- Daemon version: unknown');
    expect(md).toContain('- Agents installed (found on the PATH): unknown');
    expect(ledgeMd({ guide: 'g', agents: [] })).toContain('none found');
  });

  it('finds the agents whose executable is on the PATH, executable only', async () => {
    const a = tmp(); const b = tmp();
    writeFileSync(join(a, 'claude'), ''); chmodSync(join(a, 'claude'), 0o755);
    writeFileSync(join(b, 'cursor-agent'), ''); chmodSync(join(b, 'cursor-agent'), 0o755);
    writeFileSync(join(b, 'codex'), ''); chmodSync(join(b, 'codex'), 0o644);
    expect(await installedAgents(`${a}:${b}`)).toEqual(['claude', 'cursor']);
    expect(await installedAgents(undefined)).toEqual([]);
  });
});

describe('projectsMd', () => {
  it('each project with its description and folders, then the filed folders; a newline forges no heading', () => {
    const md = projectsMd({ projects: [{ id: 'p1', name: 'Ledge\n# x', color: 'blue', description: 'Le notch.', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [{ machine: 'local', path: '/w/x', project: 'p1' }] } as never);
    expect(md).toBe('# Projects\n\n## Ledge # x\nLe notch.\n\n- local: /w/ledge\n\n## Filed folders\n\n- local: /w/x → Ledge # x\n');
    expect(projectsMd({ projects: [], rules: [] })).toBe('# Projects\n\nNo projects.\n');
  });
});
