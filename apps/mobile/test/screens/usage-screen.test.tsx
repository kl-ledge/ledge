// #40 D9 (docs/mockups/ledge-remove-chat-p2.html, card 10): the point's « LIMITES » become Réglages › Usage: a row in Réglages,
// with an amber dot while a usage alert is on (none on ⚙), and a screen with one block per harness and the alert at its head.
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneHarnessUsage, PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { forgetTabs } from '../../src/shell/tabs';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));
afterEach(() => { localStorage.clear(); forgetTabs(); });

const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const usage = (pct: number): PhoneHarnessUsage[] => [
  { harness: 'claude', status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct, resetsAt: at(60) }, { kind: 'seven_day', pct: 64, resetsAt: null }] },
  { harness: 'codex', status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 22, resetsAt: null }, { kind: 'seven_day', pct: 40, resetsAt: null }] }
];
function open(hash: string, pct: number | null, flag = true) {
  const t = app('ready', { hash });
  const snap = snapshot([], 'PC-Desan', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  act(() => t.deliver({ ...snap, daemon: { ...snap.daemon, ...(flag ? { usage: true } : {}) } } as PhoneServerMessage));
  if (pct !== null) act(() => t.deliver({ type: 'usage.state', harnesses: usage(pct), prefs: { alert: 0.8 } }));
  return t;
}
const row = () => screen.getByRole('link', { name: new RegExp(`^${copy.settings.usage}`) });

describe('Réglages › Usage (#40 D9)', () => {
  it('a row in Réglages leads to it; an amber dot on it while a limit is reached or past the alert, none on ⚙', () => {
    open('#/connection', 100);
    expect(row()).toHaveAttribute('href', '#/connection/usage');
    expect(row().querySelector('[data-usage-dot]')).not.toBeNull();
    expect(document.querySelector('[data-settings-dot]')).toBeNull();
  });

  it('no dot without an alert', () => {
    open('#/connection', 40);
    expect(row().querySelector('[data-usage-dot]')).toBeNull();
  });

  it('no row for a PC that gives no usage', () => {
    open('#/connection', null, false);
    expect(screen.queryByRole('link', { name: new RegExp(`^${copy.settings.usage}`) })).toBeNull();
  });

  it('the screen: the alert at its head, then one block per harness with today\'s words', async () => {
    open('#/connection/usage', 100);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.settings.usage));
    const main = screen.getByRole('main');
    const alert = within(main).getByRole('status');
    expect(alert).toHaveTextContent(/^Claude Code · 5 h atteinte · reprend à \d\d:\d\d$/);
    expect(within(main).getByText('Claude Code')).toBeInTheDocument();
    expect(within(main).getByText('Codex')).toBeInTheDocument();
    expect(within(main).getByText('64 %')).toBeInTheDocument();
    expect(within(main).queryByText(copy.limits.limits)).toBeNull();
    expect(document.querySelector('a[data-back]')).toHaveAttribute('data-back', 'connection');
  });

  it('reading: says so', () => {
    open('#/connection/usage', null);
    expect(screen.getByText(copy.limits.loading)).toBeInTheDocument();
  });
});
