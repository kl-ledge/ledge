import { expect, it } from 'vitest';
import { launchMessage, toggleRepo, withTool, type LaunchForm } from '../src/launch/model';
import { ompBlocked } from '../src/launch/send';

it('keeps and sends multiple folders, model and effort for Antigravity', () => {
  const form: LaunchForm = { tool: 'claude', prompt: 'Go', project: 'p', machine: 'local', repos: ['/a', '/b'], model: null, effort: null, approval: 'always-ask' };
  const agy = toggleRepo(withTool(form, 'agy', { model: 'gemini', effort: 'high' }), '/c');
  expect(launchMessage(agy, 'Nova')).toMatchObject({ tool: 'agy', cwd: '/a', dirs: ['/b', '/c'], model: 'gemini', effort: 'high' });
  expect(withTool(agy, 'cursor').repos).toEqual(['/a']);
});

it('blocks an Antigravity CLI launch on a daemon that does not announce it, or where agy cannot list its models', () => {
  const ready = { status: 'ready' as const, models: [] };
  expect(ompBlocked({ tool: 'agy' }, true, ready, { agy: false })).toBe('outdated');
  expect(ompBlocked({ tool: 'agy' }, true, ready, { agy: true })).toBeNull();
  expect(ompBlocked({ tool: 'agy' }, true, { ...ready, error: 'not installed' }, { agy: true })).toBe('not installed');
  // Offline, nothing is said: the machine's own state is shown instead.
  expect(ompBlocked({ tool: 'agy' }, false, ready, { agy: false })).toBeNull();
  expect(ompBlocked({ tool: 'claude' }, true, ready, { agy: false })).toBeNull();
});
