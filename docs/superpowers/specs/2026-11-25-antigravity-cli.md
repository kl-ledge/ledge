# Antigravity CLI (agy) in Ledge

Follows Antigravity CLI (`agy`, Google's Gemini 4 agents) as a fifth tool, the way Claude Code is followed: a tmux
pane read by an adapter, plus hooks. Based on probes of 2026-11-25 on agy 1.5.17 (Linux, WSL2), run interactively in
tmux; the panes are `packages/ledge/test/fixtures/panes/agy-*.txt`. agy's own docs ship with it:
`~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md`.

**Status.** Done on branch `feat/agy`: the daemon side (protocol, adapter, `ledge hook agy`, setup/uninstall, launch and
resume, models, slash-command guard, thread messages, context use and file diffs from the transcript, Ask Ledge
read-only) and the fronts, as approved in `docs/mockups/ledge-agy.html` (Gemini's mark, the « étincelle » mascot, the
agents' tiles in rows of three, « Modèles Gemini » on the phone). Not covered: the account's quota, a live end-to-end
run with the daemon, the Windows build.

## Verdict

agy can be followed the way Claude Code is: a tmux pane read by an adapter, plus hooks that report the session's life.
Every dialog Ledge answers was captured and answered by keys. The one thing no hook tells is "waiting for a
permission": the pane shows it plainly. Questions do come through a hook, structured.

## Launch and resume

- Binary `agy` (`~/.local/bin`). `--model gemini-4-<model>-<level>` (lower-cased, dashed form of the names an unknown
  `--model` prints; `agy models` printed a stale list once, so the list is better read from that error), `--effort`,
  `--add-dir <dir>` (repeat per folder), `--settings <json|path>` (session-only settings, never saved).
- Initial prompt: `-i "<prompt>"` submits it at start (checked). Resume: `--conversation <id>` (`-r`, `--resume`)
  shows the history and continues; it does **not** keep the model, which falls back to the settings default: pass
  `--model` again on resume. `--continue` resumes the last one.
- **Permission mode.** The default is `auto` (edits and "safe" commands approved without asking). `--mode` only takes
  `accept-edits|auto|plan`; the asking mode is `--settings '{"agentMode":""}'` (checked, footer then shows no mode).
  Ledge should launch in asking mode unless the user picks otherwise, as it forces `always-ask` on OMP.
- First start in an untrusted folder: a trust dialog (below). Folders under a trusted parent (`trustedWorkspaces` in
  `~/.gemini/antigravity-cli/settings.json`) skip it.
- Quit: `/exit` + Enter (checked). Interrupt: `Esc`. A key typed right after `Esc` is read as meta+key (`R` was eaten):
  wait after Esc.
- `SessionStart` fires with the first prompt, not at launch: a session quit before any prompt has no conversation id
  and cannot be resumed.

## Pane

Layout from the bottom: footer, `────` rule, input line `>`, `────` rule, then the transcript. An announcement box can
sit above the input (`┃ … ┃ esc to dismiss`), and `└ Tip: …` lines appear under a running step.

| State | How it reads |
|---|---|
| Rest | footer starts with `? for shortcuts`, both rules around the input line. The input line is **not** necessarily empty: it holds the mode hint (`> Auto mode: edits & safe commands auto-approved (shift+tab to cycle)`) or a draft. |
| Working | footer starts with `esc to cancel`, spinner line (`⣻  Generating...`, `Running command... 4s`) above the rules. |
| Dialog | a title line (`Command`, `Pending edit`, `Question`), one rule, the dialog, a hint line, then the footer `esc to cancel` — the same footer as Working, so a dialog is told by its title and hint, never by the footer. |
| Mode | right of the footer: `auto · <Model> · <level>`, `accept-edits · …`, `plan · …`, nothing in asking mode. |

Number keys answer every numbered dialog at once (no Enter): checked on the edit, command and question dialogs.

**Command permission**

```
Command
──────────
Requesting permission for:
   date +%Y
Run this command?
> 1. Yes, run command
  2. Yes, and always allow in this conversation for commands that start with 'date'
  3. Yes, and always allow for commands that start with 'date' (Persist to settings.json)
  4. No, cancel
  ↑/↓ Navigate · tab Amend · ctrl+g edit/expand command
esc to cancel
```

Ledge's `always` = option 2 (this conversation); option 3 writes the user's settings and is never picked by Ledge.
`4` refuses: the turn stops with `⎿ Interrupted · What should Antigravity CLI do instead?` and the pane rests.

**Refusal with a note** (checked): `Down` ×3 to option 4, `Tab`; the option becomes
`> 4. No, and tell Antigravity CLI what to do differently` with an input line under it and the hint `enter Submit`;
type the note, `Enter`. The agent reads it and changes course. `Tab` on option 1 gives
`Yes, and tell Antigravity CLI what to do next` the same way. `Tab` again closes the field and puts the cursor back
on 1, so the plan must start from a fresh dialog.

**File edit permission**

```
Pending edit
──────────
/home/…/work/math.js  +1
  1     export const add = (a, b) => a + b;
  2  +  export const sub = (a, b) => a - b;
  shift+tab to auto-approve file edits
Accept this file edit?
> 1. Yes, accept this change
  2. No, reject this change
  ↑/↓ Navigate · f full diff
esc to cancel
```

No "always" option in the dialog (only shift+tab, which switches the whole session to accept-edits). Reads
(`read_file`) never asked, even in asking mode.

**Question** (`ask_question` tool)

```
? Which name should the new function have?
Question
──────────
Question 1/1: Which name should the new function have?
> 1. minus
  2. subtract
  3. Write-in...
  ↑/↓ Navigate · enter Select · esc Skip
esc to cancel
```

Its `PreToolUse` hook carries it structured: `toolCall.name = "ask_question"`,
`args.questions[] = { question, options[], is_multi_select }`. Ledge can raise `waiting_input` from the hook as it does
for Claude's questions; answering is a number key (checked), or the last option for free text.

**Plan approval: there is none.** In plan mode agy writes `implementation_plan.md` in the conversation's
`artifactDirectoryPath` (`~/.gemini/antigravity-cli/brain/<id>/`), says so, and rests; the user approves by writing
back. Ledge can show that file as the plan and treat the session as at rest.

**Trust dialog** (first start in a folder): unnumbered, `> Yes, I trust this folder` / `No, exit`,
`↑/↓ Navigate · enter Confirm`, title `Do you trust the contents of this project?`. Enter accepts.

## Hooks

- Files: `~/.gemini/config/hooks.json` (global; what `/hooks` writes) and `<workspace>/.agents/hooks.json` (both
  loaded at start; `cli.log`: `loaded N named hooks from N hooks.json file(s)`). The global file is, per agy's docs,
  shared with Antigravity's app and IDE: Ledge's hook must ignore calls with no `LEDGE_SESSION` in its environment.
- Format: named groups, then events; tool events take matchers, the others a plain list. The `ledge` group is Ledge's
  own key, so setup and uninstall touch nothing else:

```json
{ "ledge": {
    "SessionStart":   [{ "type": "command", "command": "ledge hook agy SessionStart", "timeout": 5 }],
    "PreInvocation":  [{ "type": "command", "command": "ledge hook agy PreInvocation", "timeout": 5 }],
    "PostInvocation": [{ "type": "command", "command": "ledge hook agy PostInvocation", "timeout": 5 }],
    "Stop":           [{ "type": "command", "command": "ledge hook agy Stop", "timeout": 5 }],
    "PreToolUse":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "ledge hook agy PreToolUse", "timeout": 5 }] }],
    "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "ledge hook agy PostToolUse", "timeout": 5 }] }] } }
```

  A wrong shape is skipped with only a warning in `~/.gemini/antigravity-cli/cli.log` (`command hook must specify
  'command'`): setup must check its file parses. Hooks run synchronously and block the agent (default timeout 30 s).
- **Answers (stdout).** `PreToolUse` takes `{"decision": "allow|deny|ask|force_ask", "reason", …}`. Checked:
  answering `{}` **denies every tool** ("tool call denied by pre-tool hook"); answering **nothing** leaves agy's own
  permission flow untouched. Ledge's `PreToolUse` must print nothing (and never `allow`, which would skip agy's
  permissions). `PostToolUse` expects `{}`. `SessionStart` can inject context:
  `{"injectSteps":[{"systemMessage":{"systemMessage":"…"}}]}` (Ledge's identity, as `additionalContext` for Claude).
  `Stop` with `{"decision":"continue"}` would keep the agent going: Ledge answers `{}`.
- **Environment** reaches the hooks, subagents included (checked with a variable set on the tmux pane).
- **Payload** (stdin, camelCase), every event: `hookEventName`, `conversationId`, `cwd`, `workspacePaths`, `modelName`,
  `lastUserInput`, `transcriptPath`, `artifactDirectoryPath`. Tool events: `toolCall {name, id, args}`, `stepIdx`, and
  `error` after (non-empty when the tool failed: Ledge's `PostToolUseFailure`). Invocations: `invocationNum`,
  `initialNumSteps`. `Stop`: `fullyIdle`, `terminationReason` (`NO_TOOL_CALL`; the docs list `ERROR`,
  `USER_CANCELED`, `MAX_INVOCATIONS`, `MAX_TOKEN_BUDGET_EXCEEDED`…), `executionNum`, `error`, `continuationActive`.
  No `last_assistant_message` and no tool output: both come from the transcript.
- **Subagents** (`invoke_subagent`, checked): the child has its own `conversationId`, `transcriptPath` and its own
  `SessionStart`…`Stop`, and nothing names its parent. The parent also sends a `Stop` with `fullyIdle: false` while the
  child works, then a final `Stop` with `fullyIdle: true`. So: the pane's session is the first conversation id seen
  for its `LEDGE_SESSION`; other ids are its subagents (never stored as its id); "at rest" is the parent's `Stop` with
  `fullyIdle: true`.
- **Prompt submitted**: no event; `PreInvocation` with `invocationNum: 0` comes once per user turn (to confirm across
  Esc and Stop continuations before relying on it).
- Tool names: `run_command` (`CommandLine`), `read_file` (`Path`), `edit_file` (`Path`, `Target`, `Replacement`),
  `write_file`, `ask_question`, `invoke_subagent`, `send_message`…

## Transcript and usage

`transcriptPath` = `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript_full.jsonl`:
one JSON step per line (`step_index`, `source`, `type` USER_INPUT / PLANNER_RESPONSE / GENERIC, `status`,
`created_at`, `content`, `tool_calls`); model steps add `model`, `input_tokens`, `cache_read_tokens`,
`output_tokens`. Enough for the last reply, the history, and a session's context use (with a model → window table:
the transcript has no window size). The **subscription quota** was not found anywhere: Ledge's usage line
(`UsageHarnessSchema`, `daemon/usage/`) stays out of a first version.

## ACP

`agy acp` speaks the Agent Client Protocol on stdio: `initialize` answers protocol 1 with sessions
`load`/`resume`/`close`/`list` and images. Ledge already drives OMP without a terminal (`omp-rpc`), so a terminal is
not required. Still, a first version is better as a pane: it keeps the live terminal in Desktop and `ledge attach`,
sessions started outside Ledge, and plugs into the adapter machinery already there, where an ACP backend would be a
second OMP-sized stack. ACP stays an option for Ledge's chat or if the pane proves too unstable.

## What a first version touches

- `@ledge/protocol`: `ToolSchema`, `DECISION_OFFERS` (`always` = permission only, scope conversation; `note` on
  permission), `CapabilitiesByToolSchema` (compile-time checked against `Tool`).
- `packages/ledge`: `AGENT_BIN`, launch args (`CONTINUE/RESUME/MODEL/EFFORT/MULTI_DIR_ARGS`, `-i`, asking mode via
  `--settings`), `adapters/agy.ts` (dialogs above, trust, rest, preview without chrome, keys with a pause after Esc,
  `promptGone`), `ledge hook agy <Event>` (silent `PreToolUse`, subagent filter, last reply from the transcript,
  `injectSteps`), setup/uninstall of the `ledge` group, models. Questions are read from the pane, like every other
  dialog of agy's: one source for all of them (the hook's structured question is an option for later).
  Later: context use and thread messages from the transcript, file diffs for `edit_file`/`write_file`, a guard on the
  slash commands that open panels (`/hooks`, `/model`…), Ask Ledge on agy.
- Fronts: label, glyph/mascot, launch picker, FR/EN, in the TUI, Desktop, the island and the phone — mockup first.
- Size (agy's estimate, plausible against Cursor's 21 core files): ~35–45 files with tests and fronts, 4–5 days.
