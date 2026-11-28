import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Session } from '@ledge/protocol';
import { test, expect } from './fixtures';
import { fakeDaemon, session, T0 } from './daemon';

// Issue #28, the explorer under the « Atelier » skin, on the mockup's own scene (docs/mockups/ide-atelier/daemon.ts and main.tsx):
// ledge with Ida, Nova and Pim (who waits for an authorisation) on three branches, synapse with Tom (a question) and Echo;
// Pim in front of the focused group. The geometry asserted below is the mockup's, measured in docs/mockups/ledge-ide-atelier.html
// with the same window, fonts and data (spec §5). The test also leaves the zooms beside docs/mockups/ledge-ide-atelier-zoom-
// explorateur-*.png and -zoom-compteurs-*.png (same clips, 44 px higher: the mockup's page has its own bar above the window).

test.setTimeout(90_000);

/** Geist and Geist Mono as Desktop gets them from Google Fonts (index.html), from the mobile app's @fontsource copies: the
 *  fixtures answer Google Fonts with nothing, and a system font would change every width the comparison is about. */
const FONT = (pkg: string, file: string) => readFileSync(new URL(`../../mobile/node_modules/@fontsource-variable/${pkg}/files/${file}`, import.meta.url));
const GEIST = FONT('geist', 'geist-latin-wght-normal.woff2');
const GEIST_MONO = FONT('geist-mono', 'geist-mono-latin-wght-normal.woff2');
async function realFonts(page: Page): Promise<void> {
  await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body:
    "@font-face { font-family: 'Geist'; font-style: normal; font-weight: 100 900; src: url(https://fonts.gstatic.com/geist.woff2) format('woff2'); }\n" +
    "@font-face { font-family: 'Geist Mono'; font-style: normal; font-weight: 100 900; src: url(https://fonts.gstatic.com/geist-mono.woff2) format('woff2'); }" }));
  await page.route(/fonts\.gstatic\.com\/geist\.woff2/, r => r.fulfill({ status: 200, contentType: 'font/woff2', body: GEIST }));
  await page.route(/fonts\.gstatic\.com\/geist-mono\.woff2/, r => r.fulfill({ status: 200, contentType: 'font/woff2', body: GEIST_MONO }));
}

const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
const mk = (id: string, extra: Partial<Session>): Session =>
  session(id, { name: id, cwd: '/w/ledge', project: 'ledge', title: id, lastActivityAt: at(0), startedAt: at(-3600), ...extra });
const SESSIONS: Session[] = [
  mk('pim', { name: 'Pim', state: 'waiting_permission', branch: 'feat/ide-shell', context: { used: 124_000, window: 200_000, at: at(0) },
    pending: { kind: 'permission', text: 'pnpm --filter desktop exec playwright test e2e/workspace.spec.ts', tool: 'Bash', source: 'hook' } }),
  mk('nova', { name: 'Nova', tool: 'codex', state: 'working', branch: 'fix/term-webgl', context: { used: 168_000, window: 200_000, at: at(0) } }),
  mk('ida', { name: 'Ida', state: 'idle', branch: 'docs/ide-workspace-mockup', topic: 'Maquette de l\'espace de travail' }),
  mk('tom', { name: 'Tom', tool: 'omp', project: 'synapse', cwd: '/w/synapse', state: 'waiting_input', branch: 'main', pending: { kind: 'question', text: 'Quel port pour le relais ?', source: 'hook' } }),
  mk('echo', { name: 'Echo', project: 'synapse', cwd: '/w/synapse', state: 'working', branch: 'test/notifications' })
];
const PROJECTS = { projects: [
  { id: 'ledge', name: 'ledge', color: 'blue' as const, description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'synapse', name: 'synapse', color: 'green' as const, description: '', repos: [{ machine: 'local', path: '/w/synapse' }] }
], rules: [] };

/** The mockup's window: French, the explorer 248 px wide on « Projets », Pim in front of the focused group, Nova and Ida beside. */
async function scene(page: Page, theme: 'dark' | 'light', sessions: Session[] = SESSIONS, sidebar?: { hideDone: boolean; dense: boolean; byBranch: boolean }, sideWidth = 248) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await realFonts(page);
  await page.addInitScript(([th, sb, sw]) => {
    const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
    set('desktop.lang', 'fr');
    set('desktop.theme', th!);
    if (sb) set('desktop.sidebar', sb);
    set('ledge.ide.layout', JSON.stringify({ sideOpen: true, sideWidth: Number(sw), sideView: 'projects', bottom: true, bottomHeight: 200, right: true }));
    set('ledge.ide.workspace', JSON.stringify(JSON.stringify({ version: 1, windows: ['main'], groups: [
      { id: 'g1', window: 'main', tabs: [{ kind: 'session', ref: 'local:pim' }], active: 0, link: 'violet' },
      { id: 'g2', window: 'main', tabs: [{ kind: 'session', ref: 'local:nova' }, { kind: 'session', ref: 'local:ida' }], active: 0, link: 'teal' }
    ], focus: 'g1', next: 3 })));
  }, [theme, sidebar ? JSON.stringify(sidebar) : '', String(sideWidth)]);
  await fakeDaemon(page, sessions, { projects: PROJECTS, daemon: { version: '0.63.0', install: 'npm', systemd: true } });
  await page.goto('/');
  await expect(page.locator('.ide')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('tree').getByRole('button', { name: /^Pim/ })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
}

type Box = { x: number; y: number; w: number; h: number };
/** Every row of the projects' tree: its kind, its label, its box and those of its parts, the explorer card's left edge. */
async function rows(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return [...document.querySelectorAll('.st-tree .st-row')].map(r => ({
      kind: r.classList.contains('st-project') ? 'project' : r.classList.contains('st-branch') ? 'branch' : 'session',
      // A session's name is its strong's first text (its context gauge and tags follow); a branch's, its span.
      label: (r.querySelector('.st-main strong')?.childNodes[0] ?? r.querySelector('.st-main > span'))?.textContent?.trim() ?? '',
      row: box(r)!, padding: parseFloat(getComputedStyle(r).paddingLeft), strong: box(r.querySelector('.st-main strong')),
      label2: r.querySelector('.st-main > span') as HTMLElement | null ? { scroll: (r.querySelector('.st-main > span') as HTMLElement).scrollWidth, client: (r.querySelector('.st-main > span') as HTMLElement).clientWidth } : null,
      time: box(r.querySelector(':scope > .st-time')), tag: box(r.querySelector('.at-tag')), tagText: r.querySelector('.at-tag')?.textContent ?? null,
      bubbles: [...r.querySelectorAll('.st-count, .st-tally > span')].map(box),
      weight: r.querySelector('.st-main strong') ? getComputedStyle(r.querySelector('.st-main strong')!).fontWeight : null,
      bg: getComputedStyle(r).backgroundColor, sel: r.classList.contains('sel')
    }));
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`the explorer under the skin, ${theme}: the mockup's tree, row by row`, async ({ page }) => {
    await scene(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'atelier');
    // One heading: the list's own line, « Projets » with its tools; the view's title gives way.
    await expect(page.locator('.sidebar > .ide-ex-h')).toBeHidden();
    const head = await page.locator('.st-scroll > section:first-child > .st-label').boundingBox();
    expect(head).toMatchObject({ x: 63, y: 41, width: 228, height: 26 });

    const r = await rows(page);
    // The mockup's order and rhythm: project 30 px, branch 30 px, session 49 px (two lines), one row after the other.
    expect(r.map(x => `${x.kind}:${x.label}`)).toEqual([
      'project:ledge', 'branch:docs/ide-workspace-mockup', 'session:Ida', 'branch:fix/term-webgl', 'session:Nova', 'branch:feat/ide-shell', 'session:Pim',
      'project:synapse', 'branch:test/notifications', 'session:Echo', 'branch:main', 'session:Tom'
    ]);
    expect(r.map(x => x.row.y)).toEqual([71, 102, 133, 183, 214, 264, 295, 345, 376, 407, 457, 488]);
    for (const x of r) {
      expect(x.row, x.label).toMatchObject({ x: 63, w: 228, h: x.kind === 'session' ? 49 : 30 });
      // Flatter: a project at 4 px, a branch at 12, a session at 28 (its sub-agents' chevron in the gutter).
      expect(x.padding, x.label).toBe(x.kind === 'project' ? 4 : x.kind === 'branch' ? 12 : 28);
    }
    // A branch's name takes its whole line: a short one is not cut (today it gets half of it), a long one stops at its count.
    for (const x of r.filter(x => x.kind === 'branch' && x.label !== 'docs/ide-workspace-mockup')) expect(x.label2!.scroll, x.label).toBeLessThanOrEqual(x.label2!.client);
    const sessions = Object.fromEntries(r.filter(x => x.kind === 'session').map(x => [x.label, x]));
    // The time moves to the right of the second line, 8 px from the row's edge; the name keeps the first.
    for (const name of ['Ida', 'Nova', 'Echo']) {
      const s = sessions[name]!;
      expect(s.tag, name).toBeNull();
      expect(s.time!.y, name).toBeGreaterThanOrEqual(s.strong!.y + s.strong!.h);
      expect(s.row.x + s.row.w - (s.time!.x + s.time!.w), name).toBe(8);
    }
    // What a waiting session waits for (#40 PR 3, design-ux: « Accord », « Question »), on its first line in place of its time:
    // 18 px high, its right edge 6 px from the row's (its width follows the font; the edge does not).
    for (const [name, text] of [['Pim', 'Accord'], ['Tom', 'Question']] as const) {
      const s = sessions[name]!;
      expect(s.tagText, name).toBe(text);
      expect(s.tag!.h, name).toBe(18);
      expect(s.row.x + s.row.w - (s.tag!.x + s.tag!.w), name).toBe(6);
      expect(s.tag!.y, name).toBeLessThan(s.strong!.y + s.strong!.h);
    }
    // The session one is in (Pim, in front of the focused group): a raised row, its name semi-bold; the others are not.
    expect(sessions.Pim!.sel).toBe(true);
    expect(sessions.Pim!.weight).toBe('600');
    expect(sessions.Pim!.bg).not.toBe('rgba(0, 0, 0, 0)');
    for (const name of ['Ida', 'Nova', 'Echo', 'Tom']) { expect(sessions[name]!.sel, name).toBe(false); expect(sessions[name]!.weight, name).toBe('500'); }
    // Count bubbles: 16 px square pills, right-aligned at the same column.
    const bubbles = r.flatMap(x => x.bubbles);
    expect(bubbles.length).toBe(9);  // two tallies per project, one count per branch
    for (const b of bubbles) expect(b).toMatchObject({ w: 16, h: 16 });
    expect(new Set(r.filter(x => x.kind === 'branch').map(x => x.bubbles[0]!.x))).toEqual(new Set([269]));
    // The activity bar's badge: 16 px, solid coral.
    expect(await page.locator('.ide-badge').first().boundingBox()).toMatchObject({ width: 16, height: 16 });
  });

  // Not in the mockup's scene: a session in error says « Erreur » (#40 PR 3), outlined in the error colour (the owner's choice A, 2026-11-26).
  test(`the explorer under the skin, ${theme}: a session in error says « Erreur » outlined, as high as a filled pill`, async ({ page }) => {
    await scene(page, theme, [...SESSIONS, mk('zed', { name: 'Zed', state: 'error', branch: 'feat/ide-shell' })]);
    const tag = (name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) }).locator('.at-tag');
    await expect(tag('Zed')).toHaveText('Erreur');
    const [zed, pim] = await Promise.all([tag('Zed').boundingBox(), tag('Pim').boundingBox()]);
    expect(zed).toMatchObject({ height: pim!.height });
    expect(zed!.height).toBe(18);
    const style = await tag('Zed').evaluate(el => {
      const c = getComputedStyle(el); const probe = document.createElement('i'); probe.style.color = 'var(--danger-text)'; el.append(probe);
      const danger = getComputedStyle(probe).color; probe.remove();
      return { bg: c.backgroundColor, line: c.boxShadow, color: c.color, danger };
    });
    expect(style).toEqual({ bg: 'rgba(0, 0, 0, 0)', line: `${style.danger} 0px 0px 0px 1.5px inset`, color: style.danger, danger: style.danger });
    // Neither coral nor amber: Pim's (an authorisation) and Tom's (a question) stay filled.
    expect(await tag('Pim').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });

  for (const [name, scale, clip] of [['explorateur', 3, { x: 0, y: 0, width: 520, height: 420 }], ['compteurs', 4, { x: 0, y: 40, width: 310, height: 130 }]] as const) {
    test.describe(() => {
      test.use({ deviceScaleFactor: scale });
      test(`the explorer under the skin, ${theme}: the zoom « ${name} », to hold against the mockup's`, async ({ page }, info) => {
        await scene(page, theme);
        await page.screenshot({ path: info.outputPath(`zoom-${name}-${theme}.png`), clip });
      });
    });
  }
}

// Issues #31 and #32 (state/pr/kl28-known-defects.md): a session row keeps its parts apart when room runs short. The name gives way
// before the time or the waiting tag (#31, compact); the branch tag gives way before the name, and the sub-agents' count stays (#32, not
// grouped by branch). Long names and a long branch, Léa with a folded sub-agent; no mouse over the tree (its tools would cover the time).
const LONG: Session[] = [
  mk('pim', { name: 'Pim', state: 'idle', branch: 'main', topic: 'Relire' }),
  mk('kit', { name: 'Kit-avec-un-nom-tres-long', state: 'waiting_input', branch: 'main', topic: 'Une tâche', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } }),
  mk('max', { name: 'Max-avec-un-nom-tres-long', state: 'working', branch: 'main', topic: 'Une autre tâche' }),
  mk('lea', { name: 'Léa', state: 'idle', branch: 'feat/ide-shell-with-a-long-name', topic: 'Relire le fil', helpers: [{ id: 'h1', kind: 'Explore', task: 'Chercher', state: 'working' }] }),
  mk('zed', { name: 'Zed', state: 'working', branch: 'main', topic: 'Corriger le build' })
];
/** A session row's parts: the row, its name (the text alone), its branch tag, the sub-agents' count, its time or pill. */
async function parts(page: Page, name: string) {
  // By the name's own span: a row with sub-agents has its chevron's label first in its accessible name.
  return page.locator('[role=treeitem]').filter({ has: page.locator('.st-aname', { hasText: new RegExp(`^${name}`) }) }).evaluate(r => {
    const box = (el: Element | null) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right }; };
    const name = r.querySelector<HTMLElement>('.st-aname');
    const tag = r.querySelector<HTMLElement>('.st-btag');
    const tagText = r.querySelector<HTMLElement>('.st-btag .st-btag-name');
    return { row: box(r)!, name: box(name), nameCut: !!name && name.scrollWidth > name.clientWidth, tag: box(tag), tagCut: !!tagText && tagText.scrollWidth > tagText.clientWidth,
      // The tag's name is shown when it sits on the tag's one line, not on the hidden second one.
      // The tag's name is shown unless the tag is its icon alone (data-fit="icon", the name folded to nothing).
      tagNameShown: !!tagText && tagText.getBoundingClientRect().width > 1,
      iconOnly: tag?.dataset.fit === 'icon',
      // The name's font: the topic's look (.st-main span) must not reach it.
      nameFont: name ? getComputedStyle(name).fontSize + ' ' + getComputedStyle(name).fontWeight : '', lineFont: name ? getComputedStyle(name.parentElement!).fontSize + ' ' + getComputedStyle(name.parentElement!).fontWeight : '',
      tagNameW: tagText?.getBoundingClientRect().width ?? 0,
      ch: (() => { if (!tagText) return 0; const m = document.createElement('span'); m.textContent = '0'; tagText.append(m); const w = m.getBoundingClientRect().width; m.remove(); return w; })(),
      kids: box(r.querySelector(':scope > .st-kids')), time: box(r.querySelector(':scope > .st-time')), timeText: r.querySelector(':scope > .st-time')?.textContent ?? '' };
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`#31, compact, ${theme}: a long name ends with « … » before its time or its tag, which stay whole`, async ({ page }) => {
    await scene(page, theme, LONG, { hideDone: true, dense: true, byBranch: true });
    await page.mouse.move(900, 900);
    for (const name of ['Kit', 'Max']) {
      const p = await parts(page, name);
      expect(p.nameCut, name).toBe(true);
      expect(p.name!.right, name).toBeLessThanOrEqual(p.time!.x);
      expect(p.time!.right, name).toBeLessThanOrEqual(p.row.right);
    }
    expect((await parts(page, 'Kit')).timeText).toBe('Question');
    // A short name is not cut.
    expect((await parts(page, 'Zed')).nameCut).toBe(false);
  });

  test(`#32, not grouped by branch, ${theme}: the name whole, then the branch tag shortened, then the sub-agents' count`, async ({ page }) => {
    await scene(page, theme, LONG, { hideDone: true, dense: false, byBranch: false });
    await page.mouse.move(900, 900);
    const lea = await parts(page, 'Léa');
    expect(lea.nameCut).toBe(false);
    expect(lea.tag).not.toBeNull();
    expect(lea.tag!.w).toBeGreaterThan(20);
    expect(lea.tagCut).toBe(true);
    expect(lea.tag!.x).toBeGreaterThanOrEqual(lea.name!.right);
    expect(lea.tag!.right).toBeLessThanOrEqual(lea.kids!.x);
    // A short branch is whole beside a short name.
    const zed = await parts(page, 'Zed');
    expect(zed.nameCut).toBe(false);
    expect(zed.tagCut).toBe(false);
    // A name longer than the line: the tag first, then the name gives way; both stay inside the row.
    const kit = await parts(page, 'Kit');
    expect(kit.nameCut).toBe(true);
    expect(kit.tag!.right).toBeLessThanOrEqual(kit.time!.x);
    // Too little room for three characters and « … »: the tag is its icon alone, in its smallest frame.
    expect(kit.iconOnly).toBe(true);
    expect(kit.tag!.w).toBeLessThanOrEqual(21);
    expect(kit.tag!.w).toBeGreaterThanOrEqual(19);
    expect(kit.tagNameShown).toBe(false);
    // The name keeps the line's font.
    expect(lea.nameFont).toBe(lea.lineFont);
    // Léa's tag shows at least three characters before « … ».
    expect(lea.tagNameShown).toBe(true);
    expect(lea.tagNameW).toBeGreaterThanOrEqual(lea.ch * 4 - 1);
  });
}

// #32 review (review-qa3, 2026-11-26): across explorer widths, compact and not, a branch tag is either its name with three characters
// and « … » at least, or its icon alone in its smallest frame — never an empty frame beside a name cut for it.
const SWEEP: Session[] = [...LONG, mk('wanda', { name: 'Wanda', state: 'working', branch: 'feat/ide-shell', worktree: true, topic: 'Un arbre à part' })];
for (const dense of [true, false]) {
  test(`#32, the branch tag across explorer widths, ${dense ? 'compact' : 'two lines'}`, async ({ page }) => {
    for (const width of [180, 200, 220, 248, 320]) {
      await page.context().clearCookies();
      await scene(page, 'dark', SWEEP, { hideDone: true, dense, byBranch: false }, width);
      await page.mouse.move(900, 900);
      for (const name of ['Kit', 'Max', 'Léa', 'Wanda', 'Zed', 'Pim']) {
        const p = await parts(page, name);
        const at = `${name} at ${width} px`;
        if (!p.tag) continue;
        // The icon alone in its whole frame: neither wider (an empty frame) nor narrower (the icon cut).
        if (p.iconOnly) { expect(p.tag.w, at).toBeLessThanOrEqual(21); expect(p.tag.w, at).toBeGreaterThanOrEqual(19); }
        else { expect(p.tagNameShown, at).toBe(true); expect(p.tagNameW, at).toBeGreaterThanOrEqual(p.ch * 4 - 1); }
        // The session's name is cut only once its tag is its icon alone.
        if (p.nameCut) expect(p.iconOnly, at).toBe(true);
        // Nothing past the row's edge, and the tag before whatever follows it on the line.
        expect(p.tag.right, at).toBeLessThanOrEqual(p.row.right);
        if (p.kids) expect(p.tag.right, at).toBeLessThanOrEqual(p.kids.x);
        if (dense && p.time) expect(p.tag.right, at).toBeLessThanOrEqual(p.time.x);
      }
    }
  });
}
