import { describe, expect, it } from 'vitest';
import { launchDefaults, launchMessage, MULTI_REPO_TOOLS, toggleRepo, withTool } from '@ledge/fleet/launch';

// The launch form the TUI and Desktop share: Antigravity CLI takes several folders, a model and an effort, like Claude Code.
describe('launch form: Antigravity CLI', () => {
  const base = { ...launchDefaults([], [], {}, 'agy'), prompt: 'fix it', machine: 'local', repos: ['/w/shop'] };
  it('keeps several folders and sends the others as dirs', () => {
    expect(MULTI_REPO_TOOLS.has('agy')).toBe(true);
    const two = toggleRepo(base, '/w/shared');
    expect(two.repos).toEqual(['/w/shop', '/w/shared']);
    expect(launchMessage({ ...two, model: 'gemini-4-neon-medium', effort: 'high' }, 'Nova')).toMatchObject({
      type: 'session.launch', tool: 'agy', cwd: '/w/shop', dirs: ['/w/shared'], model: 'gemini-4-neon-medium', effort: 'high', name: 'Nova'
    });
  });
  it('keeps the folders when switching to it from another multi-folder agent, and cuts them for a single-folder one', () => {
    const claude = { ...base, tool: 'claude' as const, repos: ['/w/shop', '/w/shared'] };
    expect(withTool(claude, 'agy').repos).toEqual(['/w/shop', '/w/shared']);
    expect(withTool(withTool(claude, 'agy'), 'codex').repos).toEqual(['/w/shop']);
  });
});
