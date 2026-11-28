import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../../src/copy';
import type { InboxItem } from '../../src/model/requests';
import { LinkStrip, Rail, ShellProvider, TabBar, TabPage, hostName, lookOf, type ShellLink } from '../../src/shell/Shell';
import { forgetTabs, remember, rigsBadge, sessionsBadge, tabHref, tabOf } from '../../src/shell/tabs';

const link = (over: Partial<ShellLink> = {}): ShellLink => ({ pc: 'WSL', look: 'online', reach: 'pc_online', since: '14:02', retry: () => {}, ...over });
const items = (perm: number, ask: number) => [
  ...Array.from({ length: perm }, () => ({ filter: 'permission' }) as InboxItem),
  ...Array.from({ length: ask }, () => ({ filter: 'question' }) as InboxItem)
];

afterEach(() => forgetTabs());

describe('the shell (m0-socle.html)', () => {
  it('tells how the PC looks from the link', () => {
    expect(lookOf(true, true, 'pc_offline')).toBe('online');
    expect(lookOf(false, true, 'pc_offline')).toBe('offline');
    expect(lookOf(false, false, 'relay_unreachable')).toBe('offline');
    expect(lookOf(false, true, 'connecting')).toBe('reconnecting');
    expect(lookOf(false, false, 'connecting')).toBe('loading');
  });

  it('cuts a long PC name at 14 characters', () => {
    expect(hostName('WSL')).toBe('WSL');
    expect(hostName('DESKTOP-7H2K9QXLM')).toBe('DESKTOP-7H2K9…');
    expect(hostName('DESKTOP-7H2K9QXLM')).toHaveLength(14);
    expect(hostName(null)).toBe(copy.host.unknown);
  });

  it('badges Sessions with its permissions in red, else its questions and decisions in amber; Rigs with its open asks (#40 D7, card 6)', () => {
    expect(sessionsBadge([])).toBeNull();
    expect(sessionsBadge(items(2, 3), 4)).toEqual({ text: '2', tone: 'red' });
    expect(sessionsBadge(items(0, 3), 2)).toEqual({ text: '5', tone: 'amber' });
    expect(sessionsBadge([], 1)).toEqual({ text: '1', tone: 'amber' });
    expect(sessionsBadge(items(120, 0))).toEqual({ text: '99+', tone: 'red' });
    expect(rigsBadge([])).toBeNull();
    expect(rigsBadge([{ kind: 'decision' }, { kind: 'parked' }, { kind: 'update' }])).toEqual({ text: '2', tone: 'amber' });
  });

  it('shows the three tabs in order, the one given lit, with its badge (#40 D6, card 7)', () => {
    render(<TabBar route={{ name: 'sessions' }} active="sessions" badges={{ sessions: { text: '2', tone: 'red' }, rigs: { text: '1', tone: 'amber' } }} />);
    const nav = screen.getByRole('navigation', { name: copy.nav.label });
    const tabs = within(nav).getAllByRole('link');
    expect(tabs.map(t => t.textContent?.replace(/\d+$/, ''))).toEqual([copy.nav.sessions, copy.nav.prs, copy.nav.rigs]);
    expect(tabs[0]).toHaveAttribute('aria-current', 'page');
    expect(within(tabs[0]!).getByText('2')).toHaveAttribute('data-badge', 'red');
    expect(within(tabs[2]!).getByText('1')).toHaveAttribute('data-badge', 'amber');
    expect(tabs[1]).not.toHaveAttribute('aria-current');
  });

  it('leads each tab back to the screen it was left on', () => {
    expect(tabHref('sessions')).toBe('#/sessions');
    remember({ name: 'thread', sessionId: 's1' });
    expect(tabOf({ name: 'thread', sessionId: 's1' })).toBe('sessions');
    expect(tabHref('sessions')).toBe('#/thread/s1');
    expect(tabOf({ name: 'request', sessionId: 's1', key: 'k' })).toBe('sessions');
    expect(tabOf({ name: 'ask', id: 'q1' })).toBe('rigs');
    expect(tabHref('rigs')).toBe('#/rigs');
  });

  it('puts the Atelier in the rail only when the PC sends its projects, Réglages alone at the bottom (#40 D6, card 10)', () => {
    const { rerender } = render(<Rail route={{ name: 'rigs' }} active="rigs" badges={{}} atelier={false} />);
    const names = () => within(screen.getByRole('navigation')).getAllByRole('link').map(a => a.textContent);
    expect(names()).toEqual([copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.settings]);
    rerender(<Rail route={{ name: 'rigs' }} active="rigs" badges={{}} atelier />);
    expect(names()).toEqual([copy.nav.sessions, copy.nav.prs, copy.nav.rigs, copy.nav.atelier, copy.nav.settings]);
    expect(screen.getByRole('link', { name: copy.nav.rigs })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Ledge' })).toBeNull();
  });


  it('shows no banner while the PC answers', () => {
    render(<ShellProvider value={link()}><LinkStrip /></ShellProvider>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says the PC does not answer, since when, and retries at once', () => {
    let asked = 0;
    render(<ShellProvider value={link({ look: 'offline', reach: 'pc_offline', retry: () => { asked++; } })}><LinkStrip /></ShellProvider>);
    const strip = screen.getByRole('status');
    expect(strip).toHaveAttribute('data-strip', 'pc');
    expect(within(strip).getByText(copy.offline.title('WSL'))).toBeInTheDocument();
    expect(within(strip).getByText(copy.offline.body('14:02'))).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole('button', { name: copy.offline.retry }));
    expect(asked).toBe(1);
  });

  it('says the relay is out of reach when the phone cannot reach it', () => {
    render(<ShellProvider value={link({ look: 'offline', reach: 'relay_unreachable' })}><LinkStrip /></ShellProvider>);
    expect(screen.getByRole('status')).toHaveAttribute('data-strip', 'relay');
    expect(screen.getByText(copy.compare.relayTitle)).toBeInTheDocument();
  });

  it('outlines the content while the PC\'s first state comes', () => {
    const { container } = render(<ShellProvider value={link({ look: 'loading', reach: 'connecting' })}><TabPage title="À toi"><p>contenu</p></TabPage></ShellProvider>);
    expect(screen.getByText(copy.link.connecting('WSL'))).toBeInTheDocument();
    expect(screen.queryByText('contenu')).not.toBeInTheDocument();
    expect(container.querySelector('[data-loading]')).not.toBeNull();
  });
});
