import type { Pending } from '@ledge/protocol';
import { NO_ALWAYS, NO_NOTE, Refusal, UNCHECKED, assertDialogIs, bottomLines, flatten, type Adapter, type KeyPlan, type PanePromptMatch } from './types.js';

const rtrim = (l: string) => l.replace(/\s+$/, '');
const isBlank = (l: string) => l.trim() === '';
const toLines = (pane: string) => pane.split('\n').map(rtrim);

function lastNonBlank(lines: string[], from = lines.length - 1): number {
  let i = from;
  while (i >= 0 && isBlank(lines[i]!)) i--;
  return i;
}

// Antigravity CLI 1.5.17 ends its pane with a footer line: `? for shortcuts` at rest, `esc to cancel` while a turn runs
// or a dialog waits, the mode and model at its right edge. At rest the input line sits between two rules above it:
//
//   ──────────────────────────────────
//   > Auto mode: edits & safe commands auto-approved (shift+tab to cycle)    the mode's hint, a draft, or nothing
//   ──────────────────────────────────
//   ? for shortcuts                                        auto · Gemini 4 Hydrogen · medium
/** A rule; the terminal can cut its last cell (seen live: a stray `�` at its end). */
const RULE = /^─{10,}\uFFFD?$/;
const REST_FOOTER = /^\? for shortcuts\b/;
const BUSY_FOOTER = /^esc to cancel\b/;
/** The footer with a draft in the box: only the mode and model, pushed to the right edge. */
const DRAFT_FOOTER = /^\s{20,}\S/;

// A dialog replaces the input box: a title (`Command`, `Pending edit`, `Question`), one rule, its body, numbered
// options with `>` on the focused one, a hint line, then the `esc to cancel` footer:
//
//   Command
//   ──────────────────────────────────
//   Requesting permission for:
//      date +%Y
//   Run this command?
//   > 1. Yes, run command
//     2. Yes, and always allow in this conversation for commands that start with 'date'
//     3. Yes, and always allow for commands that start with 'date' (Persist to settings.json)
//     4. No, cancel
//     ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
//   esc to cancel
//
// A number key answers at once. Tab on the focused option opens a note under it (`4. No, and tell Antigravity CLI what
// to do differently`, hint `enter Submit`); Tab again closes it and puts the focus back on 1.
/** The hint under a dialog's options; the file-access dialog's is « ↑/↓ Navigate » alone. */
const HINT = /^↑\/↓ Navigate( · |$)/;
const NOTE_HINT = /^enter Submit$/;
const OPTION = /^(>\s*)?(\d+)\.\s+(.*)$/;
/** An option as the dialog draws it, at the pane's left edge: `> 1. …` focused, `  2. …` not. */
const DIALOG_OPTION = /^(>| ) (\d+)\.\s+(.*)$/;
const COMMAND_TITLE = 'Command';
const EDIT_TITLE = 'Pending edit';
/** agy 1.5.18 asks before reading some files in the asking mode: `Read: <path>`, `Allow access to this file?`, Yes / No. */
const FILE_TITLE = 'File access';
const QUESTION_TITLE = 'Question';
/** The titles of the dialogs Ledge reads: the line right above a dialog's rule. */
const TITLES: ReadonlySet<string> = new Set([COMMAND_TITLE, EDIT_TITLE, QUESTION_TITLE, FILE_TITLE]);
/** How far above the hint a dialog's rule can be: a long command or diff takes many lines. */
const DIALOG_MAX = 60;
/** A dialog's rule at the very top of the screen, its end possibly cut by the terminal (seen: a stray `�` after it). */
const TOP_RULE = /^─{10,}/;

type Dialog = { title: string; body: string[]; options: string[]; focus: number; hint: string; noteOpen: boolean };

/** The dialog that ends the pane, or null. */
function parseDialog(lines: string[]): Dialog | null {
  const end = lastNonBlank(lines);
  if (end < 0 || !BUSY_FOOTER.test(lines[end]!.trim())) return null;
  const h = lastNonBlank(lines, end - 1);
  if (h < 0) return null;
  const hint = lines[h]!.trim();
  const noteOpen = NOTE_HINT.test(hint);
  if (!HINT.test(hint) && !noteOpen) return null;
  // The dialog's own rule is the one under a title it draws, both at the pane's left edge: the lines of a command or a
  // diff are indented, so a rule or a title among them is not the dialog's.
  let rule = h - 1;
  const titled = (i: number) => RULE.test(lines[i]!) && TITLES.has(lines[lastNonBlank(lines, i - 1)] ?? '');
  while (rule > 0 && h - rule <= DIALOG_MAX && !titled(rule)) rule--;
  let title: string;
  if (rule > 0 && titled(rule)) title = lines[lastNonBlank(lines, rule - 1)]!.trim();
  else {
    // A dialog taller than the screen: agy draws full screen with no scrollback, so its title goes off the top and its rule,
    // cut, is the screen's first line. Its kind is then told by its own question, right above its options.
    const top = lines.findIndex(l => !isBlank(l));
    if (top < 0 || top >= h || !TOP_RULE.test(lines[top]!)) return null;
    rule = top;
    const asks = lines.slice(rule + 1, h).map(l => l.trim());
    title = asks.includes('Accept this file edit?') ? EDIT_TITLE : asks.includes('Run this command?') ? COMMAND_TITLE
      : asks.includes('Allow access to this file?') ? FILE_TITLE : asks.some(l => /^Question \d+\/\d+: /.test(l)) ? QUESTION_TITLE : '';
    if (!title) return null;
  }
  const inside = lines.slice(rule + 1, h);
  // The options are the block right above the hint, drawn at the dialog's own indent (`> 1.` focused, `  2.` the
  // others), read from the bottom up. Under one of them may sit its note field or the rest of a long option, indented
  // further. A line that reads as an option anywhere above that block (inside a command, a diff) is not the dialog's.
  let first = inside.length;
  for (let i = inside.length - 1; i >= 0; i--) {
    const l = inside[i]!;
    if (DIALOG_OPTION.test(l)) { first = i; continue; }
    if (isBlank(l) || /^ {4,}\S/.test(l)) continue;
    break;
  }
  while (first < inside.length && !DIALOG_OPTION.test(inside[first]!)) first++;
  if (first >= inside.length) return null;
  const options: string[] = []; let focus = -1;
  for (const l of inside.slice(first)) {
    const m = l.match(DIALOG_OPTION);
    if (m) {
      if (Number(m[2]) !== options.length + 1) return null; // numbered 1, 2, 3… or not the dialog's
      if (m[1] === '>') focus = options.length;
      options.push(m[3]!.trim());
    } else if (/^ {4,}\S/.test(l) && !/^\s*>/.test(l) && options.length) options[options.length - 1] += ` ${l.trim()}`; // a long option, wrapped
  }
  const body = inside.slice(0, first);
  if (body.some(l => OPTION.test(l.trim()) && !/^\s{3,}/.test(l))) return null; // an option-looking line at the dialog's own indent
  return { title, body, options, focus, hint, noteOpen };
}

/** The lines between two markers of the body, blank edges dropped. */
function between(body: string[], from: RegExp, to: RegExp): string[] {
  const a = body.findIndex(l => from.test(l.trim()));
  if (a < 0) return [];
  const b = body.findIndex((l, i) => i > a && to.test(l.trim()));
  const out = body.slice(a + 1, b < 0 ? body.length : b);
  while (out.length && isBlank(out[0]!)) out.shift();
  while (out.length && isBlank(out.at(-1)!)) out.pop();
  return out;
}

/** The question's last option opens a field to write the answer in: Ledge leaves it out of the options it offers. */
const WRITE_IN = /^Write-in\.\.\.$/;

const ASKS = /^Requesting permission for:$/;
const RUN = /^Run this command\?$/;
/**
 * The command a command dialog asks to run, its lines joined back (the dialog indents them): everything between its
 * one `Requesting permission for:` and its one `Run this command?`. A command whose own lines repeat a marker or draw a
 * rule cannot be told from the dialog around it: null, and the request is answered in the terminal, never on a
 * reading that could show only part of it.
 */
function commandText(d: Dialog): string | null {
  const body = d.body.map(l => l.trim());
  if (body.filter(l => ASKS.test(l)).length !== 1 || body.filter(l => RUN.test(l)).length !== 1 || body.some(l => RULE.test(l))) return null;
  const from = body.findIndex(l => ASKS.test(l)); const to = body.findIndex(l => RUN.test(l));
  if (to < from || body.slice(to + 1).some(l => l !== '')) return null; // the question ends the body, right above the options
  return between(d.body, ASKS, RUN).map(l => l.trim()).join('\n') || null;
}

/** The file an edit dialog shows (`/home/dev/demo/math.js  +1`), and its diff. */
function editOf(d: Dialog): { path: string; diff: string } {
  const lines = between(d.body, /^$/, /^Accept this file edit\?$/);
  const head = lines.findIndex(l => !isBlank(l));
  const path = head < 0 ? '' : lines[head]!.trim().replace(/\s+[+-]\d+(\s+-\d+)?$/, '');
  const diff = lines.slice(head + 1).filter(l => !/^\s*shift\+tab to auto-approve file edits$/.test(l)).join('\n').replace(/\n+$/, '');
  return { path, diff };
}

const questionText = (d: Dialog) => d.body.map(l => l.trim()).find(l => /^Question \d+\/\d+: /.test(l))?.replace(/^Question \d+\/\d+: /, '') ?? '';

// The trust dialog, shown before anything else in a folder agy does not trust yet: no title nor rule, an unnumbered menu.
//
//   Do you trust the contents of this project?
//   Antigravity CLI requires permission to read, edit, and execute files here.
//   > Yes, I trust this folder
//     No, exit
//     ↑/↓ Navigate · enter Confirm
const TRUST_ASK = /^Do you trust the contents of this project\?$/;
const TRUST_YES = /^(>\s*)?Yes, I trust this folder$/;
const TRUST_NO = /^(>\s*)?No, exit$/;
const TRUST_HINT = /^↑\/↓ Navigate · enter Confirm$/;

/** The last index whose line passes `test` (the phone app's TypeScript library has no findLastIndex). */
function lastWhere(lines: string[], test: (l: string, i: number) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) if (test(lines[i]!, i)) return i;
  return -1;
}

function parseTrust(lines: string[]): { path: string; onYes: boolean } | null {
  const h = lastWhere(lines, l => TRUST_HINT.test(l.trim()));
  if (h < 0 || lastNonBlank(lines) - h > 1) return null; // the hint, then the footer at most
  const ask = lastWhere(lines, (l, i) => i < h && TRUST_ASK.test(l.trim()));
  if (ask < 0) return null;
  const yes = lines.findIndex((l, i) => i > ask && i < h && TRUST_YES.test(l.trim()));
  const no = lines.findIndex((l, i) => i > ask && i < h && TRUST_NO.test(l.trim()));
  if (yes < 0 || no < 0) return null;
  const at = lastWhere(lines, (l, i) => i < ask && /^Accessing workspace:$/.test(l.trim()));
  const path = at < 0 ? '' : lines.slice(at + 1, ask).map(l => l.trim()).filter(Boolean)[0] ?? '';
  return { path, onYes: lines[yes]!.trim().startsWith('>') };
}

function detectPrompt(pane: string): PanePromptMatch | null {
  const lines = toLines(pane);
  const t = parseTrust(lines);
  if (t) return { kind: 'permission', text: `Trust this folder? ${t.path}`.trim(), options: ['Yes, I trust this folder', 'No, exit'] };
  const sub = parseSubagentAsk(lines);
  if (sub) return { kind: 'permission', text: `${sub.who}: ${sub.call}` };
  const d = parseDialog(lines);
  if (!d) return null;
  if (d.title === QUESTION_TITLE) return { kind: 'question', text: questionText(d), options: d.options.filter(o => !WRITE_IN.test(o)) };
  if (d.title === EDIT_TITLE) {
    const e = editOf(d);
    return { kind: 'diff', text: `Edit ${e.path}`, ...(e.diff ? { body: e.diff } : {}) };
  }
  if (d.title === COMMAND_TITLE) { const text = commandText(d); return text ? { kind: 'permission', text } : null; }
  if (d.title === FILE_TITLE) {
    // What it asks to do with which file (`Read: /path`), the lines above its question.
    const text = between(['', ...d.body], /^$/, /^Allow access to this file\?$/).map(l => l.trim()).filter(Boolean).join(' ');
    return text ? { kind: 'permission', text } : null;
  }
  return null;
}

/** The kind of request on screen, the open note field being still its dialog's. */
function shownKind(lines: string[]): PanePromptMatch['kind'] | null {
  return detectPrompt(lines.join('\n'))?.kind ?? null;
}

/** A dialog Ledge reads ends the pane: its hint (or the open note's) then the `esc to cancel` footer, or the trust menu. */
function promptStillVisible(lastLines: string): boolean {
  const lines = bottomLines(lastLines).split('\n').map(l => l.trim());
  const end = lines.length - 1;
  if (end >= 0 && TRUST_HINT.test(lines[end]!)) return true;
  if (end >= 1 && TRUST_HINT.test(lines[end - 1]!) && !BUSY_FOOTER.test(lines[end]!)) return true;
  return end >= 1 && BUSY_FOOTER.test(lines[end]!) && (HINT.test(lines[end - 1]!) || NOTE_HINT.test(lines[end - 1]!));
}

/** After keys were sent: the request answered is no longer the one on screen (an open note field is still it). */
function promptGone(pane: string, pending: Pending): boolean {
  const lines = toLines(pane);
  const d = parseDialog(lines);
  if (d?.noteOpen) return false;
  const m = detectPrompt(pane);
  return !m || m.kind !== pending.kind || m.text !== pending.text;
}

/** The index of the input box's top rule, when the pane ends with the input box and a footer; else -1. */
function inputTop(lines: string[]): number {
  const end = lastNonBlank(lines);
  if (end < 0) return -1;
  // While a draft is typed the footer loses its left part (seen live: `> alive ?`, then only `Gemini 4 Hydrogen · medium`
  // at the right edge); with no mode or model shown it can be blank, and the box's bottom rule ends the pane.
  const footer = REST_FOOTER.test(lines[end]!.trim()) || BUSY_FOOTER.test(lines[end]!.trim()) || DRAFT_FOOTER.test(lines[end]!);
  if (!footer && !RULE.test(lines[end]!.trim())) return -1;
  const bottom = footer ? lastNonBlank(lines, end - 1) : end;
  if (bottom < 0 || !RULE.test(lines[bottom]!.trim())) return -1;
  // Under the input box, while subagents run, sits a panel of their states between rules (seen live:
  // `● Agent(research: Month Runner) · Gemini 4 Hydrogen  Blocked · Bash`): the box is the pair of rules around `>`.
  let lower = bottom;
  for (let tries = 0; tries < 4; tries++) {
    let top = lower - 1;
    while (top >= 0 && !RULE.test(lines[top]!.trim())) top--;
    if (top < 0) return -1;
    if (lines.slice(top + 1, lower).some(l => /^>/.test(l))) return top;
    lower = top;
  }
  return -1;
}

// A subagent asking for a tool does not open a dialog: a box over the input box says so, and the footer stays at rest.
//
//    ┃ research needs approval for Bash
//    ┃ ─────────────────────────────
//    ┃
//    ┃ ● Bash(date +%m)
//    ┃
//    ┃ ctrl+k approve · alt+j manage
//   ──────────────────────────────── the input box
//
// Ctrl-K approves. Alt-J opens the subagent's panel, whose « ⚠ Approval Required » offers `1. Yes, approve` and
// `2. No, deny` (a number answers at once); Esc closes the panel.
const SUB_ASK = /^ ┃ (.+) needs approval for (\S+)$/;
const SUB_KEYS = /^ ┃ ctrl\+k approve\b/;
const SUB_CALL = /^ ┃ ● (.+)$/;

/** The subagent request right over the input box: who asks, and the call (`Bash(date +%m)`), or null. */
function parseSubagentAsk(lines: string[]): { who: string; call: string } | null {
  const top = inputTop(lines);
  if (top < 0) return null;
  const keys = lastNonBlank(lines, top - 1);
  if (keys < 0 || !SUB_KEYS.test(lines[keys]!)) return null;
  let head = keys - 1;
  while (head >= 0 && keys - head < 40 && lines[head]!.startsWith(' ┃') && !SUB_ASK.test(lines[head]!)) head--;
  const ask = head >= 0 ? lines[head]!.match(SUB_ASK) : null;
  if (!ask) return null;
  // The box is one block of ` ┃` lines: a line of the transcript between would make it something else.
  if (lines.slice(head, keys + 1).some(l => !l.startsWith(' ┃'))) return null;
  const call = lines.slice(head + 1, keys).map(l => l.match(SUB_CALL)?.[1]).find(Boolean);
  return call ? { who: ask[1]!, call: call.trim() } : null;
}

/**
 * The subagent's panel (Alt-J) with its approval open, told by its bottom hint: the panel fills the screen and the
 * approval itself sits above the last lines the daemon reads between keys (seen live). Answered, the hint becomes the
 * panel's scrolling one, ending in `esc back`.
 */
const PANEL_ASKS = /^↑\/↓ navigate · \/ select · enter confirm · esc cancel$/;
const panelAsks = (lastLines: string) => toLines(lastLines).some(l => PANEL_ASKS.test(l.trim()));
const panelAnswered = (lastLines: string) => !panelAsks(lastLines);

/** At rest: the input box and `? for shortcuts` end the pane, with no dialog on it. */
function atRest(pane: string): boolean {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines) || parseSubagentAsk(lines)) return false;
  const end = lastNonBlank(lines);
  // `? for shortcuts` under the box, or no footer at all (a draft typed): a turn running always says `esc to cancel`.
  return end >= 0 && !BUSY_FOOTER.test(lines[end]!.trim()) && inputTop(lines) >= 0;
}

/** The conversation without the input box and footer under it; a dialog is shown whole. */
function previewLines(pane: string): string[] {
  const lines = toLines(pane);
  if (parseDialog(lines) || parseTrust(lines)) return lines;
  const top = inputTop(lines);
  return top < 0 ? lines : lines.slice(0, top);
}

const compact = (s: string) => s.replace(/\s+/g, '');

/** The input box holds exactly `text` (wrapped as it takes): not the mode's hint it shows when empty, nor an older draft. */
const typed = (text: string) => (lastLines: string) => {
  const lines = toLines(lastLines);
  const top = inputTop(lines);
  if (top < 0) return false;
  // The box ends at its bottom rule, the first one under its top (the footer under it may be blank).
  let bottom = top + 1;
  while (bottom < lines.length && !RULE.test(lines[bottom]!.trim())) bottom++;
  const box = lines.slice(top + 1, bottom).join('');
  return compact(box) === compact(`> ${text}`);
};

/** The open note field holds `text`: it sits under the focused option. */
const noted = (text: string) => (lastLines: string) => {
  const d = parseDialog(toLines(lastLines));
  if (!d?.noteOpen) return false;
  const lines = toLines(lastLines);
  return compact(lines.join('')).includes(compact(`> ${text}`));
};

const focusOn = (i: number) => (lastLines: string) => parseDialog(toLines(lastLines))?.focus === i;
const noteOpen = (lastLines: string) => !!parseDialog(toLines(lastLines))?.noteOpen;

/** The option whose text starts with `start`, as its number key; a refusal when the dialog has none. */
function optionKey(d: Dialog, start: RegExp, missing: string): string {
  const i = d.options.findIndex(o => start.test(o));
  if (i < 0) throw new Refusal(missing, 'not_offered');
  return String(i + 1);
}

/**
 * Refuses with a note: the focus goes down to « No, … » (number keys would answer at once), Tab opens its note, the
 * note goes in once the field is there and Enter once the field holds it.
 */
function notePlan(d: Dialog, note: string): KeyPlan {
  if (d.title !== COMMAND_TITLE) throw new Refusal(NO_NOTE, 'not_offered');
  if (d.noteOpen) throw new Refusal(NO_NOTE, 'not_offered'); // a note already open in the terminal: answered there
  const no = d.options.findIndex(o => /^No\b/.test(o));
  if (no < 0) throw new Refusal(NO_NOTE, 'not_offered');
  const from = d.focus < 0 ? 0 : d.focus;
  const moves = Array<string>(Math.abs(no - from)).fill(no > from ? 'Down' : 'Up');
  const text = flatten(note);
  return [
    ...(moves.length ? [{ keys: moves }, { until: focusOn(no) }] : []),
    { keys: ['Tab'] }, { until: noteOpen },
    { text }, { until: noted(text) }, { keys: ['Enter'] }
  ];
}

/** Pause between a subagent's panel showing and the key that answers in it. */
const PANEL_READY_MS = 400;
/** Pause between Esc and the next key: a key read right after Esc is taken as Alt+key (the `R` of a prompt was lost). */
const AFTER_ESC_MS = 300;
/** Pause between the typed `/exit` and its Enter, so the Enter is not taken as part of a paste. */
const EXIT_ENTER_DELAY_MS = 300;

export const agyAdapter: Adapter = {
  tool: 'agy',
  detectPrompt,
  promptStillVisible,
  // A subagent's request sits above the input box, its footer and the subagents' panel: the whole capture is read.
  promptVisible: pane => detectPrompt(pane) !== null,
  promptGone,
  previewLines,
  atRest,
  keysFor(decision, pending, pane, note) {
    const lines = pane ? toLines(pane) : [];
    if (pane) assertDialogIs(pending, shownKind(lines));
    const t = parseTrust(lines);
    if (t) {
      if (decision === 'always') throw new Refusal(NO_ALWAYS, 'not_offered');
      if (note) throw new Refusal(NO_NOTE, 'not_offered');
      // Enter takes the focused choice: Yes is focused when the dialog opens.
      if (decision === 'accept') return t.onYes ? [{ keys: ['Enter'] }] : [{ keys: ['Up'] }, { until: p => !!parseTrust(toLines(p))?.onYes }, { keys: ['Enter'] }];
      return t.onYes ? [{ keys: ['Down'] }, { until: p => parseTrust(toLines(p))?.onYes === false }, { keys: ['Enter'] }] : [{ keys: ['Enter'] }];
    }
    if (parseSubagentAsk(lines)) {
      // A subagent's request: Ctrl-K approves it; refusing goes through its panel (Alt-J), « 2 » once the approval is
      // shown there, then Esc closes the panel once it is answered. Neither offers « always » nor a note.
      if (decision === 'always' || note) throw new Refusal(decision === 'always' ? NO_ALWAYS : NO_NOTE, 'not_offered');
      if (decision === 'accept') return [{ keys: ['C-k'] }];
      // The panel draws before it takes keys (seen live: a « 2 » sent as it appeared was lost): a pause after it shows.
      return [{ keys: ['M-j'] }, { until: panelAsks }, { waitMs: PANEL_READY_MS }, { text: '2' }, { until: panelAnswered }, { keys: ['Escape'] }];
    }
    const d = parseDialog(lines);
    if (!d) {
      // No dialog read: a number typed now would land in the input box (seen in a live test, a « 4 » in the draft), so
      // nothing is typed and the request is answered in the terminal.
      throw new Refusal(UNCHECKED, 'no_prompt');
    }
    if (decision === 'deny' && note) return notePlan(d, note);
    if (d.title === QUESTION_TITLE) return decision === 'accept' ? [{ text: '1' }] : [{ keys: ['Escape'] }];
    if (decision === 'always') {
      // « always allow in this conversation »; the next option would write the user's own settings: never picked.
      if (d.title !== COMMAND_TITLE) throw new Refusal(NO_ALWAYS, 'not_offered');
      return [{ text: optionKey(d, /^Yes, and always allow in this conversation\b/, NO_ALWAYS) }];
    }
    if (decision === 'accept') return [{ text: '1' }];
    return [{ text: optionKey(d, /^No\b/, 'no refusal in this dialog, answer in the terminal') }];
  },
  replyPlan(text: string, pending?: Pending, pane?: string): KeyPlan {
    // A question's option by its number: the key answers at once.
    if (pending?.kind === 'question' && /^[1-9]$/.test(text.trim()) && pane && parseDialog(toLines(pane))?.title === QUESTION_TITLE) return [{ text: text.trim() }];
    // An Enter that comes with the text in one read is taken as part of a paste: it waits for the text in the input box.
    const flat = flatten(text);
    return [{ text: flat }, { until: typed(flat) }, { keys: ['Enter'] }];
  },
  // Esc stops a running turn (the footer says `esc to cancel`).
  interruptKeys: () => ['Escape'],
  exitText: () => '/exit',
  // Esc first (a turn running or a menu open), a pause so `/` is not read as Alt+/, then the command and its Enter.
  exitPlan: () => [{ keys: ['Escape'] }, { waitMs: AFTER_ESC_MS }, { text: '/exit' }, { waitMs: EXIT_ENTER_DELAY_MS }, { keys: ['Enter'] }]
};
