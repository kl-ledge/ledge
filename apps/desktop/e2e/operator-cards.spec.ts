// #54: the kernel operator's thread shows « Missions » then « Échanges » (docs/mockups/ledge-operator-rigs-panel.html, version C);
// another thread does not. With LEDGE_VISUAL=1, captures of both cards to hold against the mockup's .sc cards (nominal fr/en,
// dark/light; the validated q54 states; OpenRig stopped). Adapted from review-qa's capture spec.
// LEDGE_VISUAL=1 pnpm --filter desktop exec playwright test e2e/operator-cards.spec.ts
import type { Page, TestInfo } from '@playwright/test';
import type { Exchange, Mission, ThreadItem } from '@ledge/protocol';
import { test, expect, seedAtelier } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { at, fleet } from './thread';

test.setTimeout(90_000);
test.beforeEach(async ({ page }) => { await seedAtelier(page); });

const min = (m: number) => at(-m * 60);
const OP = 'operator-agent@kernel', LEAD = 'pilot-lead@ledge-dev';
const missions: Mission[] = [
  { qitemId: 'm40', rootQitemId: 'm40', rig: 'ledge-dev', state: 'pending', since: min(130), title: 'Commencer #40 : supprimer le chat Ledge et « À toi »',
    from: OP, to: LEAD, waitsOn: { kind: 'row', qitemId: 'q2b', title: 'la PR 2b', holder: 'dev-front2@ledge-dev', state: 'in-progress' },
    lastNote: { at: min(8), by: LEAD, text: '2a acceptée, envoyée à Max ; 2c = PR #52 ; PR 1 = #51. Attend la 2b.' },
    children: [
      { qitemId: 'q2b', title: 'PR 2b, téléphone', holder: 'dev-front2@ledge-dev', state: 'in-progress', since: min(91), by: 'blocked_on' },
      { qitemId: 'q3', title: 'PR 3, Desktop + île', holder: 'dev-front@ledge-dev', state: 'in-progress', since: min(34), by: 'cited' },
      { qitemId: 'q4', title: 'PR 4, back', holder: 'dev-back@ledge-dev', state: 'pending', since: min(12), by: 'cited' }
    ],
    closed: { count: 9, titles: ['inventaires', 'PR 1', '2a', '2c'] } },
  { qitemId: 'm68', rootQitemId: 'm68', rig: 'kl-site', state: 'in-progress', since: min(135), title: 'Page des nouveautés 0.68',
    from: OP, to: 'lead@kl-site', waitsOn: null, lastNote: { at: min(120), by: 'lead@kl-site', text: 'Captures demandées à Eve.' }, children: [], closed: { count: 0, titles: [] } }
];
const ev = (id: string, kind: Exchange['kind'], from: string, to: string[], text: string, m: number, o: Partial<Exchange> = {}): Exchange =>
  ({ id, at: min(m), kind, from, to, rigs: [...new Set([...to, from].map(s => s.split('@')[1]!))], text, ...o });
const exchanges: Exchange[] = [
  ev('e1', 'message', 'dev-front@ledge-dev', [OP], 'Tests verts, Sam relit. PR #48 ouverte.', 2, { delivery: 'delivered' }),
  ev('e2', 'message', OP, ['dev-front@ledge-dev'], 'Où en est fix/island-dnd-escape ?', 4, { delivery: 'delivered' }),
  ev('e3', 'given', OP, ['dev-back@ledge-dev'], '#40 PR 2 : Demandes dans Rigs', 5),
  ev('e4', 'done', 'review-qa@ledge-dev', [], 'Inventaire #40, téléphone', 19, { outcome: 'done' }),
  ev('e5', 'blocked', 'dev-front@ledge-dev', ['review-qa@ledge-dev'], '#44 : attend la relecture', 22),
  ev('e6', 'handed', 'design-ux@ledge-dev', ['dev-front@ledge-dev'], 'Maquette #44, choix A', 26),
  ev('e7', 'message', 'lead@kl-site', ['dev@kl-site'], 'Prends les captures sur la 0.68.', 28, { delivery: 'delivered' }),
  ev('e8', 'given', OP, ['lead@kl-site'], 'Page des nouveautés 0.68', 37)
];
// The states the mockup does not show (q54, validated): delivery not done, urgent, a failed end, a partial mission.
const states: Exchange[] = [
  ev('s1', 'message', OP, ['dev-front@ledge-dev', 'dev-back@ledge-dev', 'review-qa@ledge-dev', 'design-ux@ledge-dev'], 'Point à 18:00, tout le monde.', 1, { delivery: 'indeterminate', urgent: true }),
  ev('s2', 'message', OP, ['dev-back@ledge-dev'], 'Relance la PR 4.', 3, { delivery: 'failed' }),
  ev('s3', 'message', OP, ['design-ux@ledge-dev'], 'Maquette #56 ?', 4, { delivery: 'pending' }),
  ev('s4', 'done', 'dev-back@ledge-dev', [], 'PR 4, back', 6, { outcome: 'failed' }),
  ev('s5', 'blocked', 'dev-front@ledge-dev', [], 'attend une décision', 9)
];

const thread: ThreadItem[] = [{ kind: 'prompt', id: 'p1', at: min(140), turn: 1, text: 'Suis les missions des rigs.' } as ThreadItem];
const sessions = fleet.map(s => (s.id === 'otto' ? { ...s, name: 'Max', pending: undefined, state: 'idle' as const, rig: { seat: OP, name: 'kernel', role: 'operator.agent' } } : s));


async function openMax(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.setViewportSize({ width: 2400, height: 1400 });
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  const d = await fakeDaemon(page, sessions, { projects: twoProjects, threads: { otto: thread }, daemon: { version: '0.69.0', install: 'npm', systemd: true, openrigRows: true, openrigMissions: true } as never });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 60_000 });
  const open = async (name: string) => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: /Palette/ }).fill(name);
    await page.getByRole('dialog', { name: /Palette/ }).getByRole('option', { name: new RegExp(`^${name}\\b`) }).first().click();
  };
  await open('Max');
  await expect.poll(() => d.received.filter(m => m.type === 'openrig.missions').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  const answer = (read: Record<string, unknown>) => {
    const ask = d.received.filter((m): m is Extract<typeof m, { type: 'openrig.missions' }> => m.type === 'openrig.missions').at(-1)!;
    d.push({ type: 'openrig.missionsChanged', requestId: ask.requestId, openrig: 'ok', operator: OP, missions, exchanges, exchangesMore: true, ...read } as never);
  };
  const summary = page.locator('aside').filter({ has: page.locator('summary', { hasText: /Missions/ }) }).first();
  return { d, answer, summary, open };
}

test('#54: the operator\'s thread shows Missions then Échanges; « Voir plus ancien » asks for more; another thread has neither', async ({ page }) => {
  const { d, answer, summary, open } = await openMax(page, 'dark', 'fr');
  answer({});
  await expect(summary).toBeVisible({ timeout: 20_000 });
  const titles = await summary.locator('summary > span:first-child').allTextContents();
  expect(titles.slice(-2)).toEqual(['Missions', 'Échanges']);
  await expect(summary.getByText('Commencer #40 : supprimer le chat Ledge et « À toi »')).toBeVisible();
  await expect(summary.getByText('9 lignes fermées')).toBeVisible();
  await expect(summary.getByText('Tests verts, Sam relit. PR #48 ouverte.')).toBeVisible();
  const before = d.received.filter(m => m.type === 'openrig.missions').length;
  await summary.getByRole('button', { name: 'Voir plus ancien' }).click();
  await expect.poll(() => d.received.filter(m => m.type === 'openrig.missions').length).toBe(before + 1);
  expect((d.received.filter(m => m.type === 'openrig.missions').at(-1) as { exchanges?: number }).exchanges).toBe(100);
  // Another session's thread: no card.
  const other = fleet.find(s => s.id !== 'otto')!;
  await open(other.name);
  await expect(page.locator('summary', { hasText: /^Missions/ })).toHaveCount(0);
});

const shots = !!process.env.LEDGE_VISUAL;
async function shoot(page: Page, info: TestInfo, theme: 'dark' | 'light', lang: 'fr' | 'en', read: Record<string, unknown>, name: string) {
  const { answer, summary } = await openMax(page, theme, lang);
  answer(read);
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await summary.screenshot({ path: info.outputPath(`${name}-${theme}-${lang}.png`) });
}
for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  test(`#54 cards, nominal, ${theme}, ${lang}`, async ({ page }, info) => {
    test.skip(!shots, 'set LEDGE_VISUAL=1 to capture the cards');
    await shoot(page, info, theme, lang, {}, 'k54-nominal');
  });
}
test('#54 cards, q54 states (partial, deliveries, outcomes), dark, fr', async ({ page }, info) => {
  test.skip(!shots, 'set LEDGE_VISUAL=1 to capture the cards');
  await shoot(page, info, 'dark', 'fr', { partial: true, missions: [{ ...missions[0]!, state: 'blocked', partial: true, waitsOn: { kind: 'row', qitemId: 'x', title: null, holder: null, state: null } }], exchanges: states, exchangesMore: false }, 'k54-states');
});
test('#54 cards, OpenRig stopped, light, fr', async ({ page }, info) => {
  test.skip(!shots, 'set LEDGE_VISUAL=1 to capture the cards');
  await shoot(page, info, 'light', 'fr', { openrig: 'stopped', operator: null, missions: [], exchanges: [], exchangesMore: false }, 'k54-stopped');
});
