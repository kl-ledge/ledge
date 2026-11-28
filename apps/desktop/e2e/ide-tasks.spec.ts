import type { Page } from '@playwright/test';
import type { HumanAsk, HumanChannel, Session, Task } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, session, twoProjects } from './daemon';

// Lot 12 (docs/mockups/ledge-ide-tasks-history.html): « Tâches », a view of the activity bar since #40 D3. « À toi » left with #40 PR 3,
// the chat and its « Historique » with PR 4.
test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(90_000);

const NOW = Date.now();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const task = (id: string, extra: Partial<Task>): Task => ({ id, title: `Tâche ${id}`, giver: 'ledge', giverName: 'Ledge', owner: 'otto', ownerName: 'Otto', state: 'open', at: iso(3_600_000), updatedAt: iso(3_000_000), log: [{ at: iso(3_600_000), by: 'Ledge', what: 'confiée' }], ...extra });
// Oldest first, as the daemon lists them.
const TASKS: Task[] = [
  task('t-9', { title: 'Migrer la file des toasts vers le nouveau store', owner: 'lu', ownerName: 'Lu', state: 'refused', result: 'Pas dans mon lot.' }),
  task('t-11', { title: 'Passer les captures du lot 10 en clair', giver: 'dev-front', giverName: 'dev-front', owner: 'ida', ownerName: 'Ida' }),
  task('t-12', { title: 'Écrire le test du refus d’un IBAN vide', owner: 'pim', ownerName: 'Pim', state: 'done', text: 'Le test doit échouer d’abord, puis passer avec le refus. Un commit par étape.', result: 'test ajouté, refus en place, 2 commits sur feat/iban.',
    log: [{ at: iso(3_600_000), by: 'Ledge', what: 'confiée à Pim' }, { at: iso(3_500_000), by: 'Pim', what: 'prise' }, { at: iso(600_000), by: 'Pim', what: 'finie' }] }),
  task('t-13', { title: 'Choisir le nom du dossier des captures', giver: 'nova', giverName: 'Nova', owner: 'ledge', ownerName: 'Ledge', text: 'captures/ ou docs/shots/ ? Les deux existent dans ledge-dev.' }),
  task('t-14', { title: 'Relire la PR #231 du lot 9 et dire si elle peut partir', state: 'taken' })
];
const sessions: Session[] = [
  session('otto', { name: 'Otto', project: 'ledge', cwd: '/w/ledge', branch: 'feat/lot-9', state: 'idle', context: { used: 164_000, window: 200_000, at: iso(0) } }),
  session('ida', { name: 'Ida', project: 'ledge', cwd: '/w/ledge', branch: 'feat/shots', state: 'working' })
];
const READY: HumanChannel = { state: 'ready', person: { address: 'ledge@external', name: 'Ledge' }, slack: false };
const ASKS: HumanAsk[] = [{
  id: 'qitem-merge', kind: 'decision', alert: false, priority: 'urgent', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: 'Fusionner le lot 10 maintenant ou attendre la relecture ?', body: 'review-qa a accepté le code mais n’a pas fini les captures.', bodyTruncated: false, detail: null, evidenceRef: null,
  questions: [{ id: 'q1', question: 'Fusionner ?', options: [{ id: 'now', label: 'Fusionner maintenant', recommended: true }, { id: 'wait', label: 'Attendre la relecture', recommended: false }], answer: null }],
  createdAt: iso(600_000), updatedAt: iso(600_000)
}];

async function boot(page: Page, theme: 'dark' | 'light' = 'dark') {
  await page.addInitScript(t => { try { localStorage.setItem('desktop.lang', 'fr'); localStorage.setItem('desktop.theme', t); } catch { /* ignore */ } }, theme);
  await seedAtelier(page);
  const daemon = await fakeDaemon(page, sessions, { projects: twoProjects, daemon: { version: '0.54.1', install: 'npm', systemd: true, openrigAsks: true } as never, tasks: TASKS, asks: { channel: READY, asks: ASKS } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  return daemon;
}
/** « Tâches », a view of the activity bar since #40 D3 (Ctrl+/ opens it; the right panel keeps Conversation and Historique). */
const tasks = (page: Page) => page.getByRole('complementary', { name: 'Tâches' });
const rows = (page: Page) => tasks(page).locator('.rt-trow');
const openTasks = async (page: Page) => { await page.locator('body').click({ position: { x: 900, y: 500 } }); await page.keyboard.press('Control+/'); await expect(tasks(page)).toBeVisible(); };
const shot = async (page: Page, name: string, el: ReturnType<Page['locator']>) => {
  const b = (await el.boundingBox())!;
  await page.screenshot({ path: `e2e/.results/lot12-${name}.png`, clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
};

for (const theme of ['dark', 'light'] as const) {
  test(`(${theme}) the Tasks view (#40 D3): no chat panel; a task's detail in place of the list, « ‹ Tâches » and Échap back`, async ({ page }) => {
    await boot(page, theme);
    await expect(page.getByRole('complementary', { name: 'Chat Ledge' })).toHaveCount(0);
    await openTasks(page);
    // The open tasks counted: t-11, t-13, t-14.
    await expect(tasks(page).locator('.ide-tasks-h')).toContainText('3 ouvertes');
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).first()).toContainText('t-14 · de Ledge à Otto · prise');
    await expect(rows(page).nth(1).locator('.mk')).toHaveText('?');
    await expect(rows(page).nth(1)).toContainText('décision');
    await shot(page, `tasks-list-${theme}`, tasks(page));
    // The detail replaces the list.
    await rows(page).filter({ hasText: 't-12' }).click();
    const detail = tasks(page).getByRole('region', { name: 'Écrire le test du refus d’un IBAN vide' });
    await expect(detail).toContainText('de Ledge à Pim · finie');
    await expect(detail).toContainText('Résultat : test ajouté');
    await expect(detail.getByRole('listitem')).toHaveCount(3);
    await expect(rows(page)).toHaveCount(0);
    await shot(page, `tasks-detail-${theme}`, tasks(page));
    await detail.getByRole('button', { name: '‹ Tâches' }).click();
    await expect(rows(page)).toHaveCount(5);
    // Escape too, the filters kept.
    await tasks(page).getByRole('combobox', { name: 'Filtres' }).selectOption('closed');
    await expect(rows(page)).toHaveCount(2);
    await rows(page).filter({ hasText: 't-12' }).click();
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rows(page)).toHaveCount(2);
    await expect(tasks(page).getByRole('combobox', { name: 'Filtres' })).toHaveValue('closed');
    // A decision awaited: « Répondre » opens the existing answer form.
    await tasks(page).getByRole('combobox', { name: 'Filtres' }).selectOption('all');
    await rows(page).filter({ hasText: 't-13' }).click();
    await tasks(page).getByRole('button', { name: 'Répondre' }).click();
    await expect(tasks(page).getByRole('textbox')).toBeVisible();
    await shot(page, `tasks-decision-${theme}`, tasks(page));
  });
}

test('the local daemon goes away: the last list stays, dimmed under its banner; the rows still open, « Répondre » off', async ({ page }) => {
  const daemon = await boot(page);
  await openTasks(page);
  await expect(rows(page)).toHaveCount(5);
  daemon.close();
  await expect(tasks(page).locator('.rt-banner')).toHaveText('Daemon local hors ligne : la liste est celle du dernier relevé.');
  await expect(tasks(page).locator('.rt-list')).toHaveClass(/dim/);
  await shot(page, 'tasks-offline-dark', tasks(page));
  await rows(page).filter({ hasText: 't-13' }).click();
  await expect(tasks(page).getByRole('button', { name: 'Répondre' })).toBeDisabled();
});
