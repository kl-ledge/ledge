import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fakeDaemon, twoProjects } from './daemon';
import { fleet, ottoThread } from './thread';

// Issue #28: the « Atelier » skin of the IDE (docs/superpowers/specs/2026-11-26-ide-atelier-skin.md; mockup
// docs/mockups/ledge-ide-atelier.html and its captures). The IDE as the mockup frames it (two groups, the bottom panel, the chat),
// in French and English, dark and light: the frame, the cards, the focused group's cue (docs/mockups/ledge-ide-atelier-focus.html),
// then a repaint without a reload, the shapes, one group alone. Captures in e2e/.results/atelier/.
test.use({ viewport: { width: 1600, height: 1000 } });
test.setTimeout(90_000);

const OUT = 'e2e/.results/atelier';
const box = async (l: Locator) => (await l.boundingBox())!;
const css = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
/** A token as the browser resolves it to a colour. */
const colour = (page: Page, token: string) => page.evaluate(t => { const i = document.createElement('i'); i.style.color = `var(${t})`; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; }, token);
const groups = (page: Page) => page.locator('.ide-dockview .dv-groupview');

async function boot(page: Page, o: { theme?: 'dark' | 'light'; lang?: 'fr' | 'en'; two?: boolean } = {}): Promise<void> {
  const { theme = 'dark', lang = 'en', two = true } = o;
  const workspace = JSON.stringify(JSON.stringify({ version: 1, windows: ['main'], groups: two
    ? [{ id: 'g1', window: 'main', tabs: [{ kind: 'session', ref: 'local:otto' }], active: 0, link: null },
       { id: 'g2', window: 'main', tabs: [{ kind: 'session', ref: 'local:nova' }, { kind: 'atelier', ref: 'main' }], active: 0, link: null }]
    : [{ id: 'g1', window: 'main', tabs: [{ kind: 'session', ref: 'local:otto' }], active: 0, link: null }], focus: 'g1', next: 3 }));
  await page.addInitScript(([t, l, w]) => {
    try {
      localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', l!);
      localStorage.setItem('ledge.ide.workspace', w!);
      localStorage.setItem('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: 248, sideView: 'projects', bottom: true, bottomHeight: 200, right: true }));
    } catch { /* ignore */ }
    (window as unknown as { __ledgeShells: unknown }).__ledgeShells = { wsl: 'Ubuntu', powershell: false, cmd: false, gitBash: false };
  }, [theme, lang, workspace]);
  await fakeDaemon(page, fleet, { projects: twoProjects, threads: { otto: ottoThread } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ide-explorer .st-agent').first()).toBeVisible();
  await expect(groups(page)).toHaveCount(two ? 2 : 1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

for (const theme of ['dark', 'light'] as const) for (const lang of ['fr', 'en'] as const) {
  test(`the IDE under the skin (${theme}, ${lang}): the frame on the bench, panels as cards 6 px apart, the focused group's cue`, async ({ page }) => {
    await boot(page, { theme, lang });
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-skin', 'atelier');
    await expect(root).toHaveAttribute('data-theme', theme);
    // One coral, palette « Établi », for the primary button and the tab in front's token.
    expect(await colour(page, '--primary')).toBe(theme === 'dark' ? 'rgb(242, 122, 99)' : 'rgb(214, 84, 61)');
    // The frame (spec §4): 38 px title bar and 30 px status bar on the bench, no border.
    expect((await box(page.locator('.ide-titlebar'))).height).toBe(38);
    expect((await box(page.locator('.ide-status'))).height).toBe(30);
    expect(await css(page.locator('.ide'), 'background-color')).toBe(await colour(page, '--at-bench'));
    expect(await css(page.locator('.ide-titlebar'), 'border-bottom-width')).toBe('0px');
    // The cards: the explorer, each group, the bottom panel, 12 px round with a 1 px line border (the chat's panel left, #40 PR 4).
    for (const card of [page.locator('.ide-explorer'), groups(page).nth(0), groups(page).nth(1), page.locator('.ide-bottom')]) {
      expect(await css(card, 'border-top-left-radius')).toBe('12px');
      expect(await css(card, 'border-top-width')).toBe('1px');
    }
    // 6 px apart: the explorer and the first group, the two groups, the editing area and the bottom panel.
    const ex = await box(page.locator('.ide-explorer')), g1 = await box(groups(page).nth(0)), g2 = await box(groups(page).nth(1));
    const bottom = await box(page.locator('.ide-bottom'));
    expect(Math.round(g1.x - (ex.x + ex.width))).toBe(6);
    expect(Math.round(g2.x - (g1.x + g1.width))).toBe(6);
    expect(Math.round(bottom.y - (g1.y + g1.height))).toBe(6);
    // The focused group's cue (option A): its card's border the ink at 32/38 %, its tab in front's title in full ink; the other
    // group's border the plain line, its tab in front in the secondary ink.
    const [line, line3, ink, ink2] = await Promise.all(['--at-line', '--at-line3', '--at-ink', '--at-ink2'].map(t => colour(page, t)));
    const title = (g: Locator) => css(g.locator('.dv-tab.dv-active-tab .tab-name'), 'color');
    await expect(groups(page).nth(0)).toHaveClass(/dv-active-group/);
    expect(await css(groups(page).nth(0), 'border-top-color')).toBe(line3);
    expect(await title(groups(page).nth(0))).toBe(ink);
    expect(await css(groups(page).nth(1), 'border-top-color')).toBe(line);
    expect(await title(groups(page).nth(1))).toBe(ink2);
    await page.screenshot({ path: `${OUT}/ide-${theme}-${lang}.png` });
    // The focus moves: the cue follows it at once.
    await groups(page).nth(1).locator('.dv-content-container').click({ position: { x: 60, y: 160 } });
    await expect(groups(page).nth(1)).toHaveClass(/dv-active-group/);
    expect(await css(groups(page).nth(1), 'border-top-color')).toBe(line3);
    expect(await title(groups(page).nth(1))).toBe(ink);
    expect(await css(groups(page).nth(0), 'border-top-color')).toBe(line);
    expect(await title(groups(page).nth(0))).toBe(ink2);
    // The mockup's zooms (ledge-ide-atelier-zoom-*.png): the explorer, the tabs, the status bar.
    await page.screenshot({ path: `${OUT}/zoom-explorer-${theme}-${lang}.png`, clip: { x: 0, y: 0, width: 520, height: 420 }, scale: 'device' });
    await page.screenshot({ path: `${OUT}/zoom-tabs-${theme}-${lang}.png`, clip: { x: 300, y: 38, width: 990, height: 44 } });
    await page.screenshot({ path: `${OUT}/zoom-status-${theme}-${lang}.png`, clip: { x: 0, y: 740, width: 1600, height: 260 } });
  });
}

test('one group alone shows no focus cue: nothing to tell apart', async ({ page }) => {
  await boot(page, { two: false });
  expect(await css(groups(page).nth(0), 'border-top-color')).toBe(await colour(page, '--at-line'));
});

test('a theme changed in Settings repaints every surface, the terminal included, with no reload', async ({ page }) => {
  await boot(page);
  const term = page.locator('.ide-bottom .xterm-viewport').first();
  await expect(term).toBeVisible();
  const before = { bench: await css(page.locator('.ide'), 'background-color'), term: await css(term, 'background-color'), pane: await css(groups(page).nth(0), 'background-color') };
  expect(before.term).toBe(await colour(page, '--at-well'));
  // Nothing reloads: a mark on the window survives the change.
  await page.evaluate(() => { (window as unknown as { ledgeMark: number }).ledgeMark = 28; });
  // The activity bar's Settings (the bottom panel's terminal has the keyboard, so not Ctrl+,).
  await page.getByRole('navigation', { name: 'Activity bar' }).getByRole('button', { name: 'Settings (tab)' }).click();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: /^Appearance/ }).click();
  await page.getByRole('radiogroup', { name: 'Theme' }).getByText('Light', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => css(page.locator('.ide'), 'background-color')).toBe(await colour(page, '--at-bench'));
  expect(await css(page.locator('.ide'), 'background-color')).not.toBe(before.bench);
  await expect.poll(() => css(term, 'background-color')).toBe(await colour(page, '--at-well'));
  expect(await css(term, 'background-color')).not.toBe(before.term);
  expect(await page.evaluate(() => (window as unknown as { ledgeMark?: number }).ledgeMark)).toBe(28);
  await page.screenshot({ path: `${OUT}/repaint-light.png` });
});

test('nothing painted in the IDE keeps a corner under 6 px (spec §9), except the link swatches and the stop glyph', async ({ page }) => {
  await boot(page);
  const tight = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.ide *')) {
      const s = getComputedStyle(el);
      const r = parseFloat(s.borderTopLeftRadius);
      if (!(r > 0 && r < 6)) continue;
      const painted = (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') || parseFloat(s.borderTopWidth) > 0;
      if (!painted || !el.getClientRects().length) continue;
      // The link swatches and the stop glyph (3 px, spec §9; the reply field's round button carries it since #41), the terminal's own drawing, and dockview's 4 px scrollbar (a pill already).
      if (el.closest('.ide-lk, .ide-bar-stop, .cw-send.stop, .xterm, .dv-scrollbar')) continue;
      const corners = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius];
      // A shape with one tight corner on purpose (the thread's bubble, 5/16/16/16) is not a tight shape.
      if (corners.some(c => parseFloat(c) >= 6)) continue;
      out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} in ${el.parentElement?.className ?? ''} ${corners.join('/')} ${s.width}×${s.height}`);
    }
    return [...new Set(out)];
  });
  expect(tight).toEqual([]);
});
