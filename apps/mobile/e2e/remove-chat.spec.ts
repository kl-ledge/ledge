// #40 PR 2b, the phone without « À toi » nor Ledge's chat (docs/mockups/ledge-remove-chat-d1-d3-d6.html, cards 3 and 7;
// ledge-remove-chat-p2.html, cards 1, 3, 8 and 10): Sessions is home under three tabs; OpenRig's requests head the Rigs tab; a
// decision a session put to Ledge is answered at the foot of its thread; a routine waiting for approval heads Routines; the
// notifications keep « Décision à prendre »; Réglages › Usage. Dark and light, French, iPhone 13.
// SHOTS=<dir> saves a capture of each screen there; compare with the mockups' cards.
import { devices, expect, test, type Page } from '@playwright/test';
import type { HumanAsk, PhoneHarnessUsage, PhoneRoutine, PhoneSession, PhoneTask } from '@ledge/protocol';
import { copyFor } from '../src/copy';
import { createDeviceCheck } from '../test/fakePc';
import { startHarness, waiting, type Harness } from './harness';
import { hasWebkit } from './webkit';

const { defaultBrowserType: _phone, ...iPhone13 } = devices['iPhone 13'];
test.skip(({ browserName }) => browserName === 'webkit' && !hasWebkit, 'WebKit is not installed');
test.describe.configure({ mode: 'serial' });

const c = copyFor('fr');
const at = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const T = at(-30);
const s = (id: string, name: string, project: string, extra: Partial<PhoneSession> = {}): PhoneSession => ({
  id, name, tool: 'claude', project, title: `${name} · ${project}`, state: 'working', helpers: [], startedAt: T, lastActivityAt: T, unread: false, ...extra
});
const SESSIONS: PhoneSession[] = [
  { ...waiting(), id: 'otto', title: 'Otto · ledge' },
  s('nova', 'Nova', 'ledge', { topic: 'Choisir le dossier…' }),
  s('tom', 'Tom', 'synapse', { state: 'idle' })
];
const ask = (id: string, summary: string, extra: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: null }, summary, body: '', bodyTruncated: false,
  detail: null, evidenceRef: null, createdAt: at(-20), updatedAt: at(-20),
  questions: [{ id: 'q', question: summary, options: [{ id: 'a', label: 'Fusionner #36', recommended: true }, { id: 'b', label: 'Attendre', recommended: false }], answer: null }], ...extra
});
const ASKS = [
  ask('qitem-36', 'Fusionner #36 avant #37 ?', { priority: 'urgent', body: '#36 change l’ordre des sessions ; #37 en dépend. review-qa a accepté les deux.' }),
  ask('qitem-44', 'Valider la maquette #44 ?', { from: { seat: 'operator', rig: 'kernel', role: null }, questions: [{ id: 'q', question: 'Valider la maquette #44 ?', options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B', recommended: false }, { id: 'c', label: 'C', recommended: false }], answer: null }] })
];
const DECISION: PhoneTask = {
  id: 't13', owner: 'ledge', ownerName: 'Ledge', giver: 'nova', giverName: 'Nova', title: 'Choisir le dossier des captures', text: 'captures/ ou docs/shots/ ? Les deux existent.',
  state: 'open', at: at(-5), updatedAt: at(-5)
};
const USAGE: PhoneHarnessUsage[] = [
  { harness: 'claude', status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 100, resetsAt: at(90) }, { kind: 'seven_day', pct: 64, resetsAt: null }] },
  { harness: 'codex', status: 'ok', readAt: at(-2), windows: [{ kind: 'five_hour', pct: 22, resetsAt: null }, { kind: 'seven_day', pct: 40, resetsAt: null }] }
];
const ROUTINE: PhoneRoutine = {
  id: 'r3f9a12', name: 'relire-prs', target: { name: 'Otto', cwd: '~/ledge', tool: 'claude' }, schedule: { kind: 'recurring', times: ['09:00'], days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  state: 'pending', catchUp: 'once', createdAt: T, createdBy: { kind: 'session', id: 'otto', name: 'Otto' }, key: 'k1'
};
const ROUTINE_ASK: PhoneTask = { id: 'tr1', title: 'Otto veut programmer « relire-prs »', owner: 'ledge', ownerName: 'Ledge', giver: 'ledge', giverName: 'Ledge', state: 'open', at: T, updatedAt: T, routine: { kind: 'approve', id: 'r3f9a12', name: 'relire-prs' } };

let h: Harness;
test.beforeEach(async () => {
  h = await startHarness();
  Object.assign(h.daemon, {
    sessions: SESSIONS, asks: ASKS, taskAnswer: true, tasks: [DECISION, ROUTINE_ASK], usage: USAGE,
    routines: { list: [ROUTINE], prompts: { r3f9a12: 'Relis les PR ouvertes du jour.' } }
  });
});
test.afterEach(async () => { await h?.close(); });

async function shot(page: Page, name: string) {
  if (!process.env.SHOTS) return;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${process.env.SHOTS}/remove-chat-${name}.png` });
}

/** Paired, then « Voir les sessions »: the end of pairing leads to Sessions (card 9). `passkey`: Chromium's virtual authenticator
 *  stands for Face ID, and the accepts are protected at pairing (as confirm.spec.ts does): the decision foot can then sign. */
async function paired(page: Page, theme: 'dark' | 'light', passkey = false) {
  if (passkey) {
    h.daemon.device = createDeviceCheck(h.url);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  }
  await page.addInitScript(t => { try { localStorage.setItem('ledge.theme', t); localStorage.setItem('mobile.lang', 'fr'); } catch { /* ignore */ } }, theme);
  await page.goto(h.url);
  await page.getByRole('link', { name: c.login.github }).click();
  await page.getByRole('button', { name: c.recover.code }).click();
  await h.pc.code();
  await page.getByRole('button', { name: c.compare.same }).click();
  h.pc.ok();
  if (passkey) {
    await page.getByRole('button', { name: c.enroll.go }).click();
    await expect(page.getByText(c.enroll.done)).toBeVisible();
  }
  await page.getByRole('link', { name: 'Voir les sessions' }).click();
}
const tabs = (page: Page) => page.getByRole('navigation', { name: c.nav.label });

for (const theme of ['dark', 'light'] as const) {
  test.describe(`on a phone, ${theme}`, () => {
    test.use(iPhone13);

    test('Sessions is home under three tabs, Sessions in red, Rigs in amber (card 7)', async ({ page }) => {
      await paired(page, theme);
      await expect(page.locator('[data-route]')).toHaveAttribute('data-route', 'sessions');
      await expect(tabs(page).getByRole('link')).toHaveCount(3);
      await expect(tabs(page).getByRole('link', { name: /^Sessions/ }).locator('[data-badge]')).toHaveAttribute('data-badge', 'red');
      await expect(tabs(page).getByRole('link', { name: /^Rigs/ }).locator('[data-badge]')).toHaveText('2');
      await shot(page, `home-${theme}`);
    });

    test('the Rigs tab: « Demandes » at its top, the urgent first (card 3)', async ({ page }) => {
      await paired(page, theme);
      await tabs(page).getByRole('link', { name: /^Rigs/ }).click();
      const block = page.getByRole('region', { name: c.rigs.requests });
      await expect(block.getByRole('article')).toHaveCount(2);
      await expect(block.getByRole('article').first()).toContainText('Fusionner #36 avant #37 ?');
      await shot(page, `rigs-${theme}`);
    });

    test('a decision at the foot of its session\'s thread (card 1)', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'The virtual authenticator is a Chromium DevTools feature');
      await paired(page, theme, true);
      await page.getByRole('link', { name: /Nova/ }).first().click();
      const foot = page.getByRole('contentinfo', { name: c.cards.decision });
      await expect(foot).toContainText('Choisir le dossier des captures');
      await expect(foot.getByRole('button', { name: 'Envoyer ma réponse' })).toBeDisabled();
      await shot(page, `decision-${theme}`);
      await foot.getByRole('textbox').fill('docs/shots/, et supprime captures/');
      await expect(foot.getByRole('button', { name: 'Envoyer ma réponse' })).toBeEnabled();
      await foot.getByRole('textbox').blur();
      await shot(page, `decision-written-${theme}`);
    });

    test('without a passkey, the decision foot says so and leads to Réglages (card 2)', async ({ page }) => {
      await paired(page, theme);
      await page.getByRole('link', { name: /Nova/ }).first().click();
      const foot = page.getByRole('contentinfo', { name: c.cards.decision });
      await expect(foot.getByRole('link', { name: 'Ouvrir les Réglages' })).toBeVisible();
      await shot(page, `decision-nokey-${theme}`);
    });

    test('a routine waiting for approval heads Routines, with Activer and Refuser (card 3)', async ({ page }) => {
      await paired(page, theme);
      await page.evaluate(() => { location.hash = '#/routines'; });
      const card = page.getByRole('article', { name: /relire-prs/ });
      await expect(card.getByRole('button', { name: 'Refuser' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Activer' })).toBeVisible();
      await shot(page, `routines-${theme}`);
    });

    test('Réglages: the Usage row with its dot; Usage: the alert, then the harnesses (card 10); Notifications keep one switch (card 8)', async ({ page }) => {
      await paired(page, theme);
      await page.evaluate(() => { location.hash = '#/connection'; });
      const row = page.getByRole('link', { name: /^Usage/ });
      await expect(row.locator('[data-usage-dot]')).toHaveCount(1);
      await shot(page, `settings-${theme}`);
      await row.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Usage');
      await expect(page.getByRole('main').getByRole('status').first()).toContainText('Claude Code · 5 h atteinte');
      await shot(page, `usage-${theme}`);
    });
  });
}
