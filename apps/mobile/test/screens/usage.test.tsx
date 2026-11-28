import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PhoneHarnessUsage, PhoneServerMessage } from '@ledge/protocol';
import { copy } from '../../src/copy';
import { indicators, modelName, overWindows, resetLabel, span, usageTone } from '../../src/model/usage';
import { Usage } from '../../src/screens/Usage';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

const NOW = Date.now();
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const claude = (o: Partial<PhoneHarnessUsage> = {}): PhoneHarnessUsage => ({
  harness: 'claude', status: 'ok', readAt: at(-1),
  windows: [{ kind: 'five_hour', pct: 84, resetsAt: at(60) }, { kind: 'seven_day', pct: 58, resetsAt: at(4 * 24 * 60) }, { kind: 'model', model: 'Opus', pct: 100, resetsAt: at(4 * 24 * 60) }],
  ...o
});

/** Réglages › Usage, the point's « LIMITES » since #40 D9: the same Limits, the alert of the moment at its head. */
function point(usage: PhoneHarnessUsage[], alert = 0.8) {
  const t = setup();
  const snap = snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'Atelier', undefined, { confirm: true }) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  t.deliver({ ...snap, daemon: { ...snap.daemon, usage: true } } as PhoneServerMessage);
  t.deliver({ type: 'usage.state', harnesses: usage, prefs: { alert } });
  render(<Usage store={t.store} />);
  return screen.getByRole('main');
}

describe('the model', () => {
  it('names models, spans; the windows past the PC\'s threshold, in their order; tones', () => {
    expect([modelName('claude-opus-5-5'), modelName('gpt-6.1')]).toEqual(['Opus 5.5', 'gpt-6.1']);
    expect([span(40_000), span(72 * 60_000)]).toEqual(['40 s', '1 h 12']);
    const over = overWindows([claude(), claude({ status: 'expired', windows: [{ kind: 'five_hour', pct: 100, resetsAt: null }] })], 0.8);
    expect(over.map(r => [r.window.kind, r.tone])).toEqual([['five_hour', 'amber'], ['model', 'red']]);
    // The threshold not known yet: a reached window alone.
    expect(overWindows([claude()], null).map(r => r.tone)).toEqual(['red']);
    expect([usageTone(79, 0.8), usageTone(80, 0.8), usageTone(100, 0.8), usageTone(90, null)]).toEqual(['', 'amber', 'red', '']);
  });

  it('a session\'s indicators: model, effort (N1: read from the transcript too), context, duration; nothing unknown', () => {
    const s = session('a', { model: 'claude-opus-5-5', effort: 'high', context: { used: 92_000, window: 200_000, at: at(0) }, startedAt: at(-72) });
    expect(indicators(s, NOW, 0.85)).toEqual({ model: 'Opus 5.5', effort: 'élevé', context: { pct: 46, near: false }, duration: '1 h 12' });
    expect(Object.keys(indicators(session('b', { startedAt: at(-5) }), NOW, 0.85))).toEqual(['duration']);
  });
});

describe('Réglages › Usage (#40 D9)', () => {
  it('per harness its logo and windows, amber past the threshold, red reached; the reached one heads the screen', () => {
    const region = point([claude()]);
    const limits = within(region).getByRole('group', { name: copy.limits.limitsLabel });
    expect(limits.textContent).toContain('Claude Code');
    expect(limits.textContent).toContain('84 %');
    expect(limits.textContent).toContain('Opus');
    expect(limits.querySelector('svg.harness-claude')).not.toBeNull();
    // The reached window before the one past the threshold.
    expect(within(region).getByRole('status')).toHaveTextContent(/^Claude Code · Opus atteinte/);
    const pcts = [...limits.querySelectorAll('b')].map(b => [b.textContent, b.className.includes('text-attention') ? 'amber' : b.className.includes('text-approval') ? 'red' : '']);
    expect(pcts).toEqual([['84 %', 'amber'], ['58 %', ''], ['100 %', 'red']]);
  });

  it('a higher threshold: 84 % stays neutral', () => {
    const limits = within(point([claude()], 0.9)).getByRole('group', { name: copy.limits.limitsLabel });
    expect([...limits.querySelectorAll('b')].find(b => b.textContent === '84 %')?.className).not.toContain('text-attention');
  });

  it('says reading, expired, old and unreachable as the mockup does; nothing without limits', () => {
    expect(within(point([claude({ status: 'loading', readAt: null, windows: [] })])).getByText(copy.limits.loading)).toBeTruthy();
  });

  it.each([
    ['expired', 'Lecture impossible : reconnecte Claude Code sur le PC.'],
    ['stale', copy.limits.stale('12 min')],
    ['unreachable', copy.limits.unreach('25 min')]
  ] as const)('%s', (status, text) => {
    const readAt = status === 'unreachable' ? at(-25) : at(-12);
    const region = point([claude({ status, readAt, ...(status === 'expired' ? { windows: [] } : {}) })]);
    expect(within(region).getByText(text)).toBeTruthy();
  });

  it('without limits from the PC, no LIMITES', () => {
    expect(within(point([])).queryByRole('group', { name: copy.limits.limitsLabel })).toBeNull();
  });
});

describe('Cursor Agent in Réglages › Usage', () => {
  const reset = new Date(NOW + 24 * 86_400_000).toISOString();
  const cursor = (o: Partial<PhoneHarnessUsage> = {}): PhoneHarnessUsage => ({
    harness: 'cursor', status: 'ok', readAt: at(-1),
    windows: [{ kind: 'month', pct: 81, resetsAt: reset }, { kind: 'pool', pool: 'cursor', pct: 41, resetsAt: reset }, { kind: 'pool', pool: 'other', pct: 100, resetsAt: reset }],
    ...o
  });
  const date = resetLabel(reset, NOW);

  it('a reset a week or more away is a date', () => {
    expect(date).toMatch(/^\d{1,2} \S+\.?( \d{2}:\d{2})?$/);
    expect(resetLabel(reset, NOW, true)).toMatch(/^\d{1,2} [^\d:]+$/);
    const six = new Date(NOW + 6 * 86_400_000);
    const wd = six.toLocaleDateString('fr-FR', { weekday: 'short' });
    expect(resetLabel(six.toISOString(), NOW, true)).toBe(wd);
    expect(resetLabel(six.toISOString(), NOW)).toBe(`${wd} ${String(six.getHours()).padStart(2, '0')}:${String(six.getMinutes()).padStart(2, '0')}`);
  });

  it('Mois, Cursor, Autres with their % and « reprend »; the reached pool heads the screen', () => {
    const region = point([claude({ windows: [] }), cursor()]);
    const limits = within(region).getByRole('group', { name: copy.limits.limitsLabel });
    const c = limits.querySelector('[data-harness="cursor"]')!;
    expect(c.textContent).toContain('Cursor Agent');
    expect(c.querySelector('svg.harness-cursor')).not.toBeNull();
    expect(c.textContent).toContain('Mois');
    expect(c.textContent).toContain('81 %');
    expect(c.textContent).toContain('Cursor41 %');
    expect(c.textContent).toContain('Autres');
    expect(c.textContent).toContain(copy.limits.resumesOn(date));
    expect(c.textContent).toContain(`reprend le ${date}`);
    expect(within(region).getByRole('status')).toHaveTextContent(/^Cursor Agent · Autres atteinte/);
  });

  it('weekly plans say Semaine', () => {
    const week = within(point([cursor({ windows: [{ kind: 'seven_day', pct: 30, resetsAt: reset }] })])).getByRole('group', { name: copy.limits.limitsLabel });
    expect(week.textContent).toContain('Semaine');
  });

  it('unread says so', () => {
    expect(within(point([cursor({ windows: [] })])).getByText(copy.limits.unread)).toBeTruthy();
  });

  it('expired says Codex', () => {
    expect(within(point([claude({ harness: 'codex', status: 'expired', windows: [] })])).getByText('Lecture impossible : reconnecte Codex sur le PC.')).toBeTruthy();
  });

  it('expired says Cursor Agent', () => {
    expect(within(point([cursor({ status: 'expired', windows: [] })])).getByText('Lecture impossible : reconnecte Cursor Agent sur le PC.')).toBeTruthy();
  });
});
