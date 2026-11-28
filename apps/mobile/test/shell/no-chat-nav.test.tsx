// #40 D6 (docs/mockups/ledge-remove-chat-d1-d3-d6.html, cards 7, 8 and 10): without Ledge's chat, neither the phone nor the tablet
// has a Ledge page or pane. `#/`, `#/chat` and `#/atoi` open Sessions; the tablet's rail has no Ledge button.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/App';
import { copy } from '../../src/copy';
import { forgetTabs } from '../../src/shell/tabs';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { meStub } from '../screens/app-setup';
import { setup } from '../screens/setup';

const ON = { confirm: true };
const wide = (on: boolean) => { globalThis.matchMedia = ((q: string) => ({ matches: on && !q.includes('pointer'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia; };

afterEach(() => { wide(false); forgetTabs(); });

function open(hash: string, onTablet: boolean) {
  const t = setup();
  globalThis.history.replaceState(null, '', `/${hash}`);
  t.deliver(snapshot([session('a', { name: 'Bix', repo: 'ledge' })], 'WSL', undefined, ON));
  wide(onTablet);
  render(<App link={t.link} store={t.store} storage={t.storage} fetchImpl={meStub() as unknown as typeof fetch} />);
  return t;
}
const nav = () => screen.getByRole('navigation', { name: copy.nav.label });

describe('without the chat (#40 D6)', () => {
  it.each(['#/', '#/chat', '#/atoi'])('on a phone, %s opens Sessions, under three tabs and no Ledge tab', (hash) => {
    open(hash, false);
    expect(document.querySelector('[data-route]')).toHaveAttribute('data-route', 'sessions');
    expect(within(nav()).getAllByRole('link').map(a => a.textContent?.replace(/\d+$/, ''))).toEqual([copy.nav.sessions, copy.nav.prs, copy.nav.rigs]);
    expect(within(nav()).getByRole('link', { name: copy.nav.sessions })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByLabelText('Question pour Ledge')).toBeNull();
  });

  it.each(['#/', '#/chat'])('on a tablet, %s opens Sessions, the rail without Ledge and no pane', (hash) => {
    open(hash, true);
    expect(document.querySelector('[data-route]')).toHaveAttribute('data-route', 'sessions');
    expect(within(nav()).queryByRole('button', { name: 'Ledge' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Ledge' })).toBeNull();
    expect(screen.queryByLabelText('Question pour Ledge')).toBeNull();
  });
});
