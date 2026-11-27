// #40 PR 4: Ledge's chat gone from Desktop. No right panel nor its toggle; Ctrl+/ shows the Tasks view; the empty group offers no
// « Ask Ledge ». French and English, dark and light. Captures in e2e/.results/kl40/ (or SHOTS=<dir>).
import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session } from './daemon';

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const OUT = process.env.SHOTS ?? 'e2e/.results/kl40';
const SESSIONS: Session[] = [
  session('otto', { name: 'Otto', cwd: '/w/ledge', project: 'ledge', state: 'working' }),
  session('nova', { name: 'Nova', cwd: '/w/ledge', project: 'ledge', state: 'idle' })
];

async function open(page: Page, theme: 'dark' | 'light', lang: 'fr' | 'en') {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem('desktop.lang', l!); localStorage.setItem('desktop.theme', t!); } catch { /* ignore */ } }, [theme, lang]);
  await fakeDaemon(page, SESSIONS, { daemon: { version: '0.68.0', install: 'npm', systemd: true } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
}

for (const lang of ['fr', 'en'] as const) for (const theme of ['dark', 'light'] as const) {
  const fr = lang === 'fr';
  test(`no chat: no right panel nor toggle; Ctrl+/ shows Tasks; « / » does nothing, ${theme}, ${lang}`, async ({ page }) => {
    await open(page, theme, lang);
    await expect(page.locator('.ide-right')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Chat Ledge' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: fr ? 'Panneau de droite' : 'Right panel' })).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/no-chat-${theme}-${lang}.png` });
    await page.keyboard.press('/');
    await expect(page.getByRole('complementary', { name: fr ? 'Tâches' : 'Tasks' })).toHaveCount(0);
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('complementary', { name: fr ? 'Tâches' : 'Tasks' })).toBeVisible();
    await page.locator('.ide-titlebar').screenshot({ path: `${OUT}/titlebar-${theme}-${lang}.png` });
  });
}
