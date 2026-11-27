// review-qa's reproductions (review of 39e21fa2, P2-a and P2-b), kept as guards with the expected behaviour.
import { describe, expect, it } from 'vitest';
import { render, within } from '@testing-library/react';
import type { PhoneHarnessUsage, PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { overWindows, shownUsage } from '../../src/model/usage';
import { Usage } from '../../src/screens/Usage';
import { Limits } from '../../src/ui/Limits';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe('usage edges', () => {
  it('a first read that failed says it, without an age (a state the mockup did not draw)', () => {
    const { container } = render(<Limits usage={[{ harness: 'claude', status: 'unreachable', readAt: null, windows: [] }]} now={Date.now()} alert={0.8} />);
    expect(container.textContent).toBe(`LIMITESClaude Code${copy.limits.unreachNever}`);
  });

  it('values over an hour old: no window drawn, no alert (M9)', () => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'claude', status: 'ok', readAt: ago(120), windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] }];
    expect(overWindows(usage, 0.8)).toHaveLength(0);
    const { container } = render(<Limits usage={usage} now={Date.now()} alert={0.8} />);
    expect(container.textContent).not.toContain('100 %');
  });

  it('the link lost: « ok » reads as old, dimmed with its age; Réglages › Usage raises no alert from it', () => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'claude', status: 'ok', readAt: ago(12), windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] }];
    expect(shownUsage(usage, Date.now(), false)[0]!.status).toBe('stale');
    const t = setup();
    const snap = snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'Atelier', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...snap, daemon: { ...snap.daemon, usage: true } } as PhoneServerMessage);
    t.deliver({ type: 'usage.state', harnesses: usage, prefs: { alert: 0.8 } });
    t.set('pc_offline');
    const { getByRole } = render(<Usage store={t.store} />);
    const region = getByRole('main');
    const limits = within(region).getByRole('group', { name: copy.limits.limitsLabel });
    expect(limits.textContent).toContain(copy.limits.stale('12 min'));
    expect(limits.querySelector('.opacity-50')).not.toBeNull();
    expect(within(region).queryByRole('status')).toBeNull();
  });

  it.each([['stale', 12, copy.limits.stale('12 min')], ['unreachable', 25, copy.limits.unreach('25 min')]] as const)('Cursor %s: its rows dimmed, with the message', (status, min, text) => {
    const usage: PhoneHarnessUsage[] = [{ harness: 'cursor', status, readAt: ago(min), windows: [{ kind: 'month', pct: 40, resetsAt: null }, { kind: 'pool', pool: 'other', pct: 20, resetsAt: null }] }];
    const { container } = render(<Limits usage={usage} now={Date.now()} alert={0.8} />);
    expect(container.querySelector('.opacity-50')?.textContent).toContain('Autres');
    expect(container.textContent).toContain(text);
  });
});
