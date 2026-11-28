import type { DaemonInfo, OperatorNotice, Session } from '@ledge/protocol';
import { test, expect, surface, island, card, received, ready } from './fixtures';
import { fakeDaemon, session } from './daemon';

/** The island, in the real app with a real mouse and keyboard (issue #27, docs/mockups/ledge-dynamic-island.html). */

const DAEMON: DaemonInfo = { version: '0.64.0', install: 'npm', systemd: false, routines: true, routineGroups: true } as DaemonInfo;
const pim = (extra: Partial<Session> = {}) => session('b', { name: 'Pim', tool: 'codex', project: 'speos-api', branch: 'chore/deps', ...extra });
const asks = (extra: Partial<Session> = {}) => pim({ state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm up --latest && pnpm test', tool: 'Bash', source: 'hook' }, ...extra });
const question = pim({ state: 'waiting_input', pending: { kind: 'question', text: 'Which strategy?', options: ['Backfill', 'Shadow table'], source: 'hook' } });
/** Lets a CSS transition finish in real time (the page's clock may be frozen; transitions do not follow it). */
const settle = (page: import('@playwright/test').Page) => page.waitForTimeout(600);
const T0 = new Date('2026-11-27T09:00:00.000Z');
/** The page's timers stop: only `runFor` moves them (an `install` alone lets time flow). */
const freeze = (page: import('@playwright/test').Page) => page.clock.pauseAt(new Date(T0.getTime() + 60_000));

test('at rest nothing is on screen; a finished turn comes out as a 72 × 36 pill 8 px under the edge, opens to 420 px, holds under the pointer, then leaves', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  await expect(island(page)).toHaveCount(0);
  d.upsert(pim({ state: 'idle', lastReply: { text: 'All 14 tests pass, the PR is ready for review.', at: new Date().toISOString() } }));
  await page.clock.runFor(50);
  await expect(surface(page)).toHaveAttribute('data-phase', 'seed');
  await settle(page);
  expect(await island(page).boundingBox()).toEqual({ x: 960 - 36, y: 8, width: 72, height: 36 });
  await page.clock.runFor(260);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await settle(page);
  const open = (await island(page).boundingBox())!;
  expect(open.x).toBe(960 - 210); expect(open.y).toBe(8); expect(open.width).toBe(420);
  await expect(card(page)).toContainText('DonePim finished');
  await expect(card(page)).toContainText('All 14 tests pass, the PR is ready for review.');
  // The pointer holds the ring: six seconds pass, the island stays.
  await page.mouse.move(960, 30);
  await expect(page.locator('[data-ring]')).not.toHaveAttribute('data-running', 'true');
  await page.clock.runFor(7000);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.mouse.move(960, 600);
  await page.clock.runFor(6000);
  await expect(surface(page)).toHaveAttribute('data-closing', 'true');
  await page.clock.runFor(320 + 240);
  await expect(island(page)).toHaveCount(0);
});

test('a permission: Y allows it, « Sent, waiting for the terminal », then « Received » once the terminal took it, and the island leaves', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(card(page)).toContainText('ApprovalPim wants to run a command');
  await expect(card(page).locator('.di-command')).toHaveText('Bashpnpm up --latest && pnpm test');
  await page.keyboard.press('y');
  expect(await received(d.received, 'session.decide')).toEqual({ type: 'session.decide', id: 'b', decision: 'accept' });
  await expect(card(page)).toContainText('Sent, waiting for the terminal');
  d.upsert(pim({ state: 'working' }));
  await expect(card(page)).toContainText('Received');
  await expect(island(page)).toHaveCount(0);
});

test('a turn that ends while « Received » shows still gets its Done card (review 575f5fb8, 2)', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('y');
  await expect(card(page)).toContainText('Sent, waiting for the terminal');
  d.upsert(pim({ state: 'working' }));
  await expect(card(page)).toContainText('Received');
  d.upsert(pim({ state: 'idle', lastReply: { text: 'Tests pass.', at: new Date().toISOString() } }));
  await expect(card(page)).toContainText('Tests pass.', { timeout: 5000 });
  await expect(island(page)).toHaveAttribute('data-kind', 'finished');
});

test('after a request answered with the mouse, the next finished turn still leaves on its clock: the island left under the pointer, which never said so', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  d.upsert(asks());
  await page.clock.runFor(260);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await settle(page);
  // A click on « Allow »: the pointer is over the island, the button takes the focus, and both stay there while it leaves.
  await page.getByRole('button', { name: /^Allow/ }).click();
  d.upsert(pim({ state: 'working' }));
  await expect(card(page)).toContainText('Received');
  await page.clock.runFor(900 + 320 + 240);
  await expect(island(page)).toHaveCount(0);
  // The pointer goes away once nothing is drawn: no element is left to hear it leave.
  await page.mouse.move(960, 600);
  d.upsert(pim({ state: 'idle', lastReply: { text: 'Tests pass.', at: new Date().toISOString() } }));
  await page.clock.runFor(260);
  await expect(island(page)).toHaveAttribute('data-kind', 'finished');
  await expect(page.locator('[data-ring]')).toHaveAttribute('data-running', 'true');
  await page.clock.runFor(6000);
  await expect(surface(page)).toHaveAttribute('data-closing', 'true');
  await page.clock.runFor(320 + 240);
  await expect(island(page)).toHaveCount(0);
});

test('a Done card clicked opens its session and leaves; the next Done card still leaves on its own (the owner clicked them away)', async ({ page }) => {
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  d.upsert(pim({ state: 'working' }));
  d.upsert(pim({ state: 'idle', lastReply: { text: 'First turn.', at: new Date().toISOString() } }));
  await page.clock.runFor(260);
  await expect(island(page)).toHaveAttribute('data-kind', 'finished');
  await settle(page);
  // The click lands on the card: it asks Ledge Desktop for the session and the island closes, the pointer still on it.
  await card(page).click();
  await expect(surface(page)).toHaveAttribute('data-closing', 'true');
  await page.clock.runFor(320 + 240);
  await expect(island(page)).toHaveCount(0);
  await page.mouse.move(960, 600);
  d.upsert(pim({ state: 'working' }));
  d.upsert(pim({ state: 'idle', lastReply: { text: 'Second turn.', at: new Date().toISOString() } }));
  await page.clock.runFor(260);
  await expect(card(page)).toContainText('Second turn.');
  await expect(page.locator('[data-ring]')).toHaveAttribute('data-running', 'true');
  await page.clock.runFor(6000);
  await expect(surface(page)).toHaveAttribute('data-closing', 'true');
  await page.clock.runFor(320 + 240);
  await expect(island(page)).toHaveCount(0);
});

test('a question with the mouse: Reply with nothing says so; a choice, then Reply, sends it', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  d.upsert(question);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose an answer or write one.');
  await page.getByRole('radio', { name: '2 Shadow table' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reply' }).click();
  expect(await received(d.received, 'session.reply')).toEqual({ type: 'session.reply', id: 'b', text: 'Shadow table' });
});

test('Esc sets a request aside and the island leaves; Ctrl+Alt+L brings it back; without one it opens nothing', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await page.keyboard.press('Control+Alt+L');
  await expect(island(page)).toHaveCount(0);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('Escape');
  await expect(island(page)).toHaveCount(0);
  await page.keyboard.press('Control+Alt+L');
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(card(page)).toContainText('Pim wants to run a command');
});

test('two at once: « +1 more », « Later, next », and the pill reopens on the next one', async ({ page }) => {
  const d = await fakeDaemon(page, [pim(), session('c', { name: 'Bix', tool: 'cursor', project: 'boutique', branch: 'feat/migration' })]);
  await ready(page);
  d.upsert(asks());
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  d.upsert(session('c', { name: 'Bix', tool: 'cursor', project: 'boutique', branch: 'feat/migration', state: 'waiting_input', pending: { kind: 'question', text: 'Gradual migration?', source: 'hook' } }));
  await expect(card(page).locator('.di-meta')).toHaveText('speos-api · chore/deps · +1 more');
  await page.getByRole('button', { name: 'Later, next Esc' }).click();
  await expect(card(page)).toContainText('Bix asks you a question');
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
});

test('Do not disturb: nothing opens, a finish is dropped; leaving it, the island comes out on the oldest request, then the next (owner’s choice A)', async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('dnd.set')) { localStorage.setItem('desktop.dnd', '1'); sessionStorage.setItem('dnd.set', '1'); } } catch { /* ignore */ } });
  const bix = (extra: Partial<Session> = {}) => session('c', { name: 'Bix', tool: 'cursor', project: 'boutique', branch: 'feat/migration', ...extra });
  const d = await fakeDaemon(page, [pim(), bix(), session('o', { name: 'Otto' })]);
  await ready(page);
  d.upsert(asks());
  d.upsert(bix({ state: 'waiting_input', pending: { kind: 'question', text: 'Gradual migration?', source: 'hook' } }));
  d.upsert(session('o', { name: 'Otto', state: 'idle' }));
  await page.waitForTimeout(500);
  await expect(island(page)).toHaveCount(0);
  // Desktop turns Do not disturb off (its key, heard as a `storage` event).
  await page.evaluate(() => { localStorage.setItem('desktop.dnd', '0'); window.dispatchEvent(new StorageEvent('storage', { key: 'desktop.dnd', newValue: '0' })); });
  await expect(card(page)).toContainText('Pim wants to run a command');
  await expect(card(page).locator('.di-meta')).toHaveText('speos-api · chore/deps · +1 more');
  // The card's text is there (inert) while the island is still opening; the island's keys wait for it to be open.
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await page.keyboard.press('Escape');
  await expect(card(page)).toContainText('Bix asks you a question');
  await expect(card(page).locator('.di-meta')).toHaveText('boutique · feat/migration');
});

test('reduced motion: the island fades in already open, without the pill', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: T0 });
  const d = await fakeDaemon(page, [pim()]);
  await ready(page);
  await freeze(page);
  d.upsert(asks());
  await page.clock.runFor(1);
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
  await expect(island(page)).toHaveAttribute('data-reduced', 'true');
});

test('a rig’s question from Ledge: its mark, the suggested answer first; a click answers through OpenRig (openrig.answer, #40)', async ({ page }) => {
  const d = await fakeDaemon(page, [pim()], { daemon: DAEMON });
  await ready(page);
  const ask: OperatorNotice = { id: 'rig.ask:q1', kind: 'rig.ask', qitem: 'q1', questionId: 'q', text: 'Merge #309 now?', who: 'pilot-lead', rig: 'ledge-dev', options: [{ id: 'merge', label: 'Merge' }, { id: 'wait', label: 'Wait for qa' }], priority: 'urgent', at: new Date().toISOString() };
  d.notices([ask]);
  await expect(island(page)).toHaveAttribute('data-kind', 'rig');
  await expect(card(page).locator('[data-ledge-mark]')).toHaveCount(1);
  await expect(card(page).locator('.di-sentence')).toHaveText('pilot-lead: “Merge #309 now?”');
  await page.getByRole('button', { name: 'Merge' }).click();
  expect(await received(d.received, 'openrig.answer')).toEqual({ type: 'openrig.answer', requestId: expect.any(String), qitemId: 'q1', answer: { kind: 'choice', questionId: 'q', optionId: 'merge' } });
  await expect(island(page)).toHaveCount(0);
});

test('hidden from Desktop: nothing opens; shown again, the waiting request does', async ({ page }) => {
  const prefs = { visible: false, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto', shows: { quick: true, finished: true, say: true, helpers: true }, shortcut: 'Ctrl Alt L' } as const;
  const d = await fakeDaemon(page, [pim()], { island: prefs });
  await page.goto('/');
  await expect(surface(page)).toHaveCount(0);
  d.upsert(asks());
  await page.waitForTimeout(400);
  await expect(surface(page)).toHaveCount(0);
  d.island({ ...prefs, visible: true });
  await expect(island(page)).toHaveAttribute('data-phase', 'open');
});

test.describe('in French', () => {
  test.use({ lang: 'fr' });
  test('the island says « tu »', async ({ page }) => {
    const d = await fakeDaemon(page, [pim()]);
    await ready(page);
    d.upsert(asks());
    await expect(card(page)).toContainText('Ton accordPim veut exécuter une commande');
    await expect(page.getByRole('button', { name: 'Plus tard Esc' })).toBeVisible();
    d.upsert(pim({ state: 'working' }));
    d.upsert(question);
    await expect(card(page)).toContainText('Pim te pose une question');
  });
});
