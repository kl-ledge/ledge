import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PREFS, type DevicePrefs } from '@ledge/protocol';
import { initMotion, readReduced, setReducedMotion } from '../../src/motion';
import { pauseEnd, shownUntil } from '../../src/screens/Settings';
import { MemoryStorage, snapshot } from '../state/helpers';
import { app } from './app-setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(async () => false), createCredential: vi.fn(), getAssertion: vi.fn() }));

// Réglages (the `connection` route): what this device sets for itself, the PC's shared threshold, and what stays on the PC.

type Daemon = { settings?: true; terminal?: true; terminalInput?: true };
const snap = (o: { daemon?: Daemon; prefs?: DevicePrefs | null; push?: 'on' | 'off'; chat?: true; contextNear?: number } = {}) => {
  const base = snapshot([], 'PC-Desan') as Extract<ReturnType<typeof snapshot>, { type: 'snapshot' }>;
  return {
    ...base,
    daemon: { ...base.daemon, ...(o.daemon ?? { settings: true }) },
    device: { confirm: true, push: o.push ?? 'on', ...(o.chat ? { chat: o.chat } : {}), contextNear: o.contextNear ?? 0.8, ...(o.prefs === null ? {} : { prefs: o.prefs ?? DEFAULT_DEVICE_PREFS }) }
  } as never;
};
const result = (op: string, status: 'applied' | 'rejected' | 'failed', reason?: string) => ({ type: 'operation.result', op, status, ...(reason ? { reason } : {}) }) as never;

afterEach(() => { vi.unstubAllGlobals(); setReducedMotion(false, new MemoryStorage()); });

describe('Réglages: the screen', () => {
  it('is titled Réglages, and says what only the PC sets', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap({ daemon: { settings: true, terminal: true } })));
    expect(screen.getByRole('banner')).toHaveTextContent('Réglages');
    expect(screen.getByRole('heading', { name: 'Réglés sur le PC' })).toBeInTheDocument();
    expect(screen.getByText('Taper dans les terminaux').nextElementSibling).toHaveTextContent('Non autorisé');
    expect(screen.getByText(/Un appareil ne peut pas élargir ses propres droits/)).toBeInTheDocument();
    // Nothing here changes the PC's mobile access, its machines or its projects: no control for them.
    expect(screen.queryByRole('switch', { name: 'Taper dans les terminaux' })).not.toBeInTheDocument();
  });

  it('a PC without the settings: no kinds, no pause, no « Ledge » section', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap({ daemon: {}, prefs: null, chat: true })));
    expect(screen.getByRole('switch', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Le point de Ledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ledge' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Contexte max' })).not.toBeInTheDocument();
  });
});

describe('Réglages: notifications of this device', () => {
  it('only once they are on: « Décision à prendre » alone, and requests always said to notify (#40, card 8)', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap({ push: 'off' })));
    expect(screen.queryByRole('switch', { name: 'Décision à prendre' })).not.toBeInTheDocument();
    act(() => t.deliver(snap()));
    expect(screen.getByRole('switch', { name: 'Décision à prendre' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Décision à prendre' })).toHaveAccessibleDescription('Quand une session te demande de trancher.');
    // The point and Ledge's answers left with the chat.
    expect(screen.queryByRole('switch', { name: 'Le point de Ledge' })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Réponse de Ledge' })).toBeNull();
    expect(screen.getByText(/Les demandes d’accord et les questions des agents préviennent toujours/)).toBeInTheDocument();
    expect(screen.getByText('Aucune notification sur cet appareil pendant ce temps.')).toBeInTheDocument();
  });

  it('the switch sends the whole settings with that kind off, the hidden kinds kept as they were', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap()));
    fireEvent.click(screen.getByRole('switch', { name: 'Décision à prendre' }));
    const sent = t.of('device.prefs');
    expect(sent.map(m => m.prefs.notify)).toEqual([{ finished: true, chat: true, decision: false }]);
    act(() => t.deliver(result(sent[0]!.op, 'applied')));
    act(() => t.deliver(snap({ prefs: { ...DEFAULT_DEVICE_PREFS, notify: { finished: true, chat: true, decision: false } } })));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Décision à prendre' })).not.toBeChecked());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a change the PC refuses is said, and the switch shows the PC\'s value again', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap()));
    fireEvent.click(screen.getByRole('switch', { name: 'Décision à prendre' }));
    act(() => t.deliver(result(t.of('device.prefs')[0]!.op, 'rejected', 'invalid')));
    expect(await screen.findByText('Le PC n’a pas pris ce réglage. Réessaie.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Décision à prendre' })).toBeChecked();
  });

  it('« 1 h » pauses them until an hour from now; a pause under way shows its end and « Reprendre » lifts it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00'));
    try {
      const t = app('ready', { hash: '#/connection' });
      act(() => t.deliver(snap()));
      fireEvent.click(screen.getByRole('button', { name: 'Pause d’une heure' }));
      expect(t.of('device.prefs')[0]!.prefs.quietUntil).toBe(new Date('2026-11-05T11:00:00').toISOString());
      act(() => t.deliver(snap({ prefs: { ...DEFAULT_DEVICE_PREFS, quietUntil: new Date('2026-11-05T11:00:00').toISOString() } })));
      expect(screen.getByText('En pause jusqu’à 11:00')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
      expect(t.of('device.prefs').at(-1)!.prefs.quietUntil).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('pauseEnd and shownUntil: an hour, four, tomorrow at 8:00, read as a time or « demain »', () => {
    const at = new Date('2026-11-05T22:30:00');
    expect(pauseEnd('hour', at)).toEqual(new Date('2026-11-05T23:30:00'));
    expect(pauseEnd('four', at)).toEqual(new Date('2026-11-06T02:30:00'));
    expect(pauseEnd('morning', at)).toEqual(new Date('2026-11-06T08:00:00'));
    expect(shownUntil(new Date('2026-11-05T23:30:00'), at)).toBe('23:30');
    expect(shownUntil(new Date('2026-11-06T08:00:00'), at)).toBe('demain 08:00');
  });
});

describe('Réglages: Ledge', () => {
  it('« Contexte max » shows the PC\'s threshold and sends a new one as context.set', async () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap({ contextNear: 0.75 })));
    const select = screen.getByRole('combobox', { name: 'Contexte max' });
    expect(select).toHaveValue('75');
    expect(screen.getByText(/Partagé avec le PC/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '60' } });
    expect(t.of('context.set').map(m => m.near)).toEqual([0.6]);
    expect(select).toBeDisabled();
    act(() => t.deliver(result(t.of('context.set')[0]!.op, 'applied')));
    act(() => t.deliver(snap({ contextNear: 0.6 })));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Contexte max' })).toHaveValue('60'));
  });

  it('no « Agent du chat » any more: the chat left the phone (#40 PR 4)', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap()));
    expect(screen.queryByRole('radiogroup', { name: 'Agent du chat' })).toBeNull();
    expect(screen.queryByText('Agent du chat')).toBeNull();
  });


  it('no chat on this PC: no choice of agent', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap()));
    expect(screen.queryByRole('radiogroup', { name: 'Agent du chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Codex' })).not.toBeInTheDocument();
  });
});

describe('Réglages: reduced motion', () => {
  it('kept in the browser, put on the root, and read again at the next start', () => {
    const storage = new MemoryStorage();
    initMotion(storage);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    setReducedMotion(true, storage);
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(readReduced(storage)).toBe(true);
    setReducedMotion(false, storage);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(readReduced(storage)).toBe(false);
  });

  it('the switch of the screen turns it on', () => {
    const t = app('ready', { hash: '#/connection' });
    act(() => t.deliver(snap()));
    fireEvent.click(screen.getByRole('switch', { name: 'Réduire les animations' }));
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });
});
