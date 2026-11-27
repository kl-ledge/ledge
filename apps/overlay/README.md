# Ledge overlay

The island's web app (issue #27, `docs/mockups/ledge-dynamic-island.html`). Nothing rests on the screen: when an agent has something to say, the island comes out of the top edge, opens on its notification, closes and leaves. It has no native shell of its own: Ledge Desktop builds it into `dist/notch/` and shows it in its second window, `notch` (`apps/desktop/src-tauri/src/notch.rs` holds the native side). The island talks to the Ledge daemon over `ws://127.0.0.1:47831`.

## The movement

1. **Rest**: nothing on screen.
2. **Out of the edge** (260 ms): a 72 × 36 pill, 8 px under the top edge, with the agent's provider logo and the event's sign.
3. **Open** (420 ms): 420 px wide, as tall as its card.
4. **Back to the pill** (320 ms); if another notification waits, the pill reopens on it at once.
5. **Gone** (240 ms).

Reduced motion (the OS's, or `VITE_LEDGE_MOTION=0` in the unit tests): no trip through the pill, a fade in already open and a fade out. The machine is `src/surface/machine.ts` (pure, its timers run by `controller.ts`); the card is `src/surface/Island.tsx` with `island.css`, in Atelier's skin (one base colour, coral for what waits on the person).

## The cards

- **A session's notice**, 6 s, a ring around the logo that empties (the pointer holds it): a finished turn (the start of its last reply, two lines at most), an error (its message, in mono). A click opens the session in Ledge Desktop.
- **A session's request**, open until answered or « Plus tard »: a permission (its command under its tool; Allow, Deny), a question (its proposed answers, a field, Reply), a plan or a diff (Review in Ledge). « Envoyé, en attente du terminal » until the terminal confirms a decision, then « Reçu » for 900 ms. A refusal says why and unlocks the buttons; offline or read only, only Open in Ledge and Later work. With the quick answers off in Desktop, a request only opens in Ledge or waits.
- **Ledge's own** (`src/surface/useLedgeNotices.ts`), with Ledge's mark for a logo: a rig's urgent question (its proposed answers, the suggested one first, answered through OpenRig with `openrig.answer`; Open shows it in the Rigs view's « Demandes » block), a decision put to the person (Open shows it in the Tasks view), a routine to activate or that could not run (through `routine.cmd`, an approval bound to the key it was shown with), and a machine that dropped (a 6 s notice). There is no « point » any more (#40).

One at a time, requests (a session's or Ledge's, in their order) before notices; « +2 autres » after the branch, and « Plus tard » becomes « Plus tard, suivante ». Do not disturb opens nothing (the requests wait set aside); Desktop's « hidden » shows nothing until it is shown again.

## Develop (WSL)

```
pnpm --filter overlay dev                        # http://localhost:1420
pnpm --filter overlay exec tsx test/devMock.ts   # a fake daemon on 47831 with five bots
pnpm --filter overlay test
pnpm --filter overlay test:e2e                   # Playwright, the real app in Chromium
```

The dev mock needs port 47831 free: stop the real daemon first.

The e2e suite (`e2e/*.spec.ts`) drives the real app with a real mouse and keyboard in Chromium; the daemon is simulated in the page (`e2e/daemon.ts`), so nothing needs to run on 47831. Any console error or page error fails the spec. `e2e/island-shots.spec.ts` takes zoomed captures of every card (French and English, dark and light) to hold against the mockup; they go to `LEDGE_SHOTS`, else `e2e/.results/shots/`. The first run may need `pnpm --filter overlay exec playwright install chromium`.

## Build (Windows PowerShell, Rust installed)

The island ships inside Ledge Desktop: build, run and install it from `apps/desktop` (`pnpm --filter desktop tauri dev`, `pnpm tauri build` there; see the root README). The icon, the tray, launch at login and updates are Ledge Desktop's.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+Alt+L | reopen the oldest request still waiting, set aside or not (global); without one it does nothing |
| Y N | allow / deny the permission shown |
| 1-9 | choose a proposed answer of the question shown |
| Enter | send the answer typed in the field |
| O | open the item shown in Ledge Desktop (a session, a rig's question in Rigs, a decision in Tasks, a routine's page) |
| Esc | « Plus tard » on a request; close a notice |
| Ctrl+Alt+N | ask Ledge Desktop for a new session (global) |
| Ctrl+Alt+T | toggle dark / light theme |

A Ledge notice takes no Y, N or digits: a routine is activated, a rig answered, with a click after reading.

## Screen, position and size

The island hangs from the top edge of one screen, the primary or the one chosen in Ledge Desktop › Settings › Island, on its axis there (centre, or a quarter from the left or the right), at the island's size (Auto: the work area's height divided by 1080, to the nearest quarter, between 100 % and 200 %). The shell lists the monitors (`list_monitors`) and moves the window to the chosen one (`set_monitor`); frames are in that screen's work-area coordinates, in logical px: the page itself is never zoomed, the island's layer carries a CSS `zoom`.

### The native window never moves

The native window covers the whole work area of that screen and is placed once (`set_frame` places it again only when the work area changes, for instance after a Screen change). What follows the island is the *drawn rectangle*: the bounding rectangle of everything the page draws, reported by `set_frame` on every change of shape, grown at once and shrunk only after the size transition has settled (`useNativeFrame`). At rest the island sends 0 × 0: no rectangle at all, every click goes through. The window takes the mouse only while the cursor is on that rectangle: the cursor poller toggles `set_ignore_cursor_events` (`WS_EX_TRANSPARENT`) on the way in and out, polling every 16 ms within 40 px of the rectangle and every 50 ms elsewhere, so clicks beside the island reach the windows beneath and clicks on it reach the page. The page draws in work-area coordinates and needs no offset. A press "outside" (`press_outside`) is one that misses that rectangle, not the window.

Why: moving or resizing the window while the surface animates was the blink between two shapes. `SetWindowPos` moved the window, wry resized the WebView2 controller on `WM_SIZE` (asynchronously for its child HWND), and the page was presented at its new offset: nothing ties those to the same compositor frame, so any frame where one had happened without the other showed the content displaced or clipped. A window that never moves cannot race. The rectangle is not a window region (`SetWindowRgn`, tried in 0.3.2): a region makes DWM stop compositing the window with its alpha channel, so every pixel of the region the page leaves clear (the corners beside the rounded island, the shoulders) showed white.

## Language

The island speaks French (the default) and English, and says « tu ». It follows Ledge Desktop's language (`desktop.lang`), live. Every visible string, aria-labels included, comes from one typed catalogue, `src/i18n/messages.ts`: `fr` and `en` have the same keys (the build fails otherwise). The unit tests and most e2e specs run in English (`setFallbackLang('en')` in `test/setup.ts`, the `lang` fixture option in `e2e/fixtures.ts`); the French ones opt in.

## Known limits

- The native window, its drawn rectangle and the clicks that go through it are only checked on Windows (CI's runner, or a Windows build): WSL runs the web app in Chromium.
