import { test, expect, seedAtelier } from './fixtures';
import { eight, fakeDaemon, twoProjects } from './daemon';

// Settings › General › Default agent wears each harness's provider logo, as the launch dialog's agent cards do, not the
// robot mascots: one 16 px mark per choice, centred on its label, in both themes. The zoomed captures land in e2e/.results/.
test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3, reducedMotion: 'reduce' });

const PROVIDERS = [['Claude Code', 'Anthropic'], ['Codex', 'OpenAI'], ['Cursor Agent', 'Cursor'], ['Antigravity CLI', 'Google'], ['OMP', 'omp']] as const;

for (const theme of ['light', 'dark'] as const) {
  test(`Default agent: the provider logos, centred on their labels (${theme})`, async ({ page }, info) => {
    await seedAtelier(page);
    await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } }, [theme]);
    await fakeDaemon(page, eight, { projects: twoProjects });
    await page.goto('/');
    await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Control+Comma');
    const group = page.getByRole('radiogroup', { name: 'Default agent' });
    await expect(group).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(group.locator('.logo-bot')).toHaveCount(0);
    const labels = group.locator('label');
    await expect(labels).toHaveCount(PROVIDERS.length);
    for (const [i, [name, provider]] of PROVIDERS.entries()) {
      const label = labels.nth(i);
      await expect(label).toContainText(name);
      const logo = label.locator('.logo');
      await expect(logo).toHaveAttribute('title', provider);
      const mark = (await logo.locator('svg').boundingBox())!;
      expect(mark.width).toBe(16); expect(mark.height).toBe(16);
      // The label's text box, read from its text node: its middle and the mark's sit on the same line.
      const text = await label.evaluate(el => {
        const node = [...el.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())!;
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect(); return { top: r.top, height: r.height, left: r.left };
      });
      const box = (await label.boundingBox())!;
      expect(Math.abs((mark.y + mark.height / 2) - (text.top + text.height / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs((mark.y + mark.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
      // The mark comes before its name, 6 px apart (the segment's gap).
      expect(Math.round(text.left - (mark.x + mark.width))).toBe(6);
    }
    const row = page.locator('.set-row').filter({ has: group });
    await row.scrollIntoViewIfNeeded();
    await row.screenshot({ path: info.outputPath(`default-agent-${theme}.png`) });
    await group.screenshot({ path: info.outputPath(`default-agent-choices-${theme}.png`) });
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`Appearance › Theme: Claude's provider logo in each swatch, centred (${theme})`, async ({ page }, info) => {
    await seedAtelier(page);
    await page.addInitScript(([t]) => { try { localStorage.setItem('desktop.theme', t!); localStorage.setItem('desktop.lang', 'en'); } catch { /* ignore */ } }, [theme]);
    await fakeDaemon(page, eight, { projects: twoProjects });
    await page.goto('/');
    await expect(page.locator('.ide')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Control+Comma');
    await page.locator('.settings-nav').getByRole('button', { name: 'Appearance', exact: true }).click();
    const group = page.getByRole('radiogroup', { name: 'Theme' });
    await expect(group).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(group.locator('.logo-bot')).toHaveCount(0);
    const swatches = group.locator('.theme-swatch');
    await expect(swatches).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const swatch = swatches.nth(i);
      await expect(swatch.locator('.logo')).toHaveAttribute('title', 'Anthropic');
      const box = (await swatch.boundingBox())!;
      const mark = (await swatch.locator('.logo svg').boundingBox())!;
      expect(mark.width).toBe(22); expect(mark.height).toBe(22);
      // The mark sits in the middle of its swatch, both ways.
      expect(Math.abs((mark.x + mark.width / 2) - (box.x + box.width / 2))).toBeLessThanOrEqual(0.5);
      expect(Math.abs((mark.y + mark.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(0.5);
    }
    await group.screenshot({ path: info.outputPath(`theme-swatches-${theme}.png`) });
  });
}
