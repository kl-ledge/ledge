import { describe, it, expect } from 'vitest';
import { agyIsHelper, agyPromptStarts, agyReply, mapAgyHook } from '../src/cli/hook.js';
import { AGY_EVENTS, AGY_GROUP, guardedHook, mergeAgyHooks } from '../src/cli/setup.js';
import { removeAgyHooks } from '../src/cli/uninstall.js';
import { launchArgs, RESUME_ARGS } from '../src/daemon/server.js';
import { agentModeArgs } from '../src/spawn.js';
import { parseAgyModels } from '../src/daemon/models.js';

// Payloads as Antigravity CLI 1.5.17 sent them (probe of 2026-11-25), the folders shortened.
const PARENT = '98f332b7-46d8-463e-bffd-522c5e991e97';
const CHILD = 'be2569e0-0000-4000-8000-000000000000';
const transcript = (id: string) => `/home/dev/.gemini/antigravity-cli/brain/${id}/.system_generated/logs/transcript_full.jsonl`;
const common = (id: string, prompt: string) => ({
  artifactDirectoryPath: `/home/dev/.gemini/antigravity-cli/brain/${id}`, conversationId: id, cwd: '/home/dev/demo',
  lastUserInput: prompt, modelName: 'gemini-4-hydrogen-medium', transcriptPath: transcript(id), workspacePaths: ['/home/dev/demo']
});
const PROMPT = 'Add a function mul(a, b) to math.js.';
const main = (extra: Record<string, unknown>) => ({ ...common(PARENT, PROMPT), ...extra });
const child = (extra: Record<string, unknown>) => ({ ...common(CHILD, ''), ...extra });

// What the transcripts begin with: a person's prompt, or the message a parent sent its subagent.
const HEADS: Record<string, Array<Record<string, unknown>>> = {
  [transcript(PARENT)]: [{ step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: `<USER_REQUEST>\n${PROMPT}\n</USER_REQUEST>` }],
  [transcript(CHILD)]: [{ step_index: 0, source: 'SYSTEM', type: 'SYSTEM_MESSAGE', content: `<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-25T20:45:13Z sender=${PARENT} priority=MESSAGE_PRIORITY_HIGH content=Read math.js and count its lines.\n</SYSTEM_MESSAGE>` }]
};
const TAIL = [
  { step_index: 0, type: 'USER_INPUT', content: PROMPT },
  { step_index: 1, type: 'PLANNER_RESPONSE', content: '', tool_calls: [{ name: 'edit_file' }] },
  { step_index: 2, type: 'GENERIC', content: 'Made 1 replacement' },
  { step_index: 3, type: 'PLANNER_RESPONSE', content: 'Added `mul(a, b)` to math.js.' }
];
const read = { head: (p: string) => (HEADS[p] ?? []) as never[], tail: () => TAIL as never[] };
const env = { LEDGE_SESSION: 'a1b2' };
const at = '2026-11-25T20:14:32.000Z';
const map = (ev: string, p: unknown, e: NodeJS.ProcessEnv = env) => mapAgyHook(ev, p, at, e, read);

describe('agy hooks', () => {
  it('follow only a session Ledge launched: the global hooks file also serves Antigravity\'s app and IDE', () => {
    expect(map('SessionStart', main({}), {})).toBeNull();
  });
  it('SessionStart starts the session and names the conversation a resume takes', () => {
    expect(map('SessionStart', main({}))).toEqual({ id: 'a1b2', agent: 'agy', cwd: '/home/dev/demo', event: { name: 'SessionStart', at, source: 'hook', transcriptPath: transcript(PARENT), agentSessionId: PARENT } });
  });
  it('the first model call after a prompt is the prompt; a later one, or a wake by a subagent\'s message, is not', () => {
    const first = map('PreInvocation', main({ invocationNum: 0, initialNumSteps: 1 }));
    expect(first?.event).toMatchObject({ name: 'UserPromptSubmit', text: PROMPT });
    expect(map('PreInvocation', main({ invocationNum: 1, initialNumSteps: 4 }))).toBeNull();
    expect(map('PreInvocation', main({ invocationNum: 0, initialNumSteps: 3 }))).toBeNull(); // step 2 is not a prompt
  });
  it('tool calls: the command or the file, the call id, the input; a failed one is a failure', () => {
    const run = { toolCall: { name: 'run_command', id: 'call_1', args: { CommandLine: 'date +%Y', WaitMsBeforeAsync: 5000 } }, stepIdx: 2 };
    expect(map('PreToolUse', main(run))?.event).toMatchObject({ name: 'PreToolUse', tool: 'run_command', text: 'date +%Y', toolUseId: 'call_1', toolInput: { CommandLine: 'date +%Y' } });
    expect(map('PostToolUse', main({ ...run, error: '' }))?.event).toMatchObject({ name: 'PostToolUse', tool: 'run_command', toolUseId: 'call_1' });
    expect(map('PostToolUse', main({ ...run, error: 'exit status 1' }))?.event).toMatchObject({ name: 'PostToolUseFailure', error: 'exit status 1' });
    const edit = { toolCall: { name: 'edit_file', id: 'call_2', args: { Path: '/home/dev/demo/math.js', Target: 'a', Replacement: 'b' } } };
    expect(map('PreToolUse', main(edit))?.event).toMatchObject({ text: '/home/dev/demo/math.js' });
  });
  it('the turn ends at each Stop of the session, its reply read from the transcript', () => {
    // fullyIdle false (a subagent still working) ends the turn too: agy may never send the final Stop (seen live).
    expect(map('Stop', main({ fullyIdle: false, terminationReason: 'NO_TOOL_CALL', error: '' }))?.event).toMatchObject({ name: 'Stop', text: 'Added `mul(a, b)` to math.js.' });
    expect(map('Stop', main({ fullyIdle: true, terminationReason: 'NO_TOOL_CALL', error: '' }))?.event).toEqual({ name: 'Stop', at, source: 'hook', text: 'Added `mul(a, b)` to math.js.', transcriptPath: transcript(PARENT), agentSessionId: PARENT });
    expect(map('Stop', main({ fullyIdle: true, terminationReason: 'ERROR', error: 'quota' }))?.event).toMatchObject({ name: 'StopFailure', text: 'quota' });
    expect(map('Stop', main({ fullyIdle: true, terminationReason: 'USER_CANCELED', error: '' }))?.event).toMatchObject({ name: 'PostToolUseFailure', interrupt: true });
  });
  it('a subagent is a helper of the session, named by its conversation, with the task its parent gave it', () => {
    expect(map('SessionStart', child({}))).toEqual({ id: 'a1b2', agent: 'agy', cwd: '/home/dev/demo', event: { name: 'SubagentStart', at, source: 'hook', helperId: CHILD, tool: 'subagent', text: 'Read math.js and count its lines.' } });
    expect(map('PreToolUse', child({ toolCall: { name: 'read_file', id: 'c', args: {} } }))?.event).toMatchObject({ name: 'PreToolUse', helperId: CHILD, tool: 'read_file' });
    expect(map('Stop', child({ fullyIdle: true, terminationReason: 'NO_TOOL_CALL' }))?.event).toEqual({ name: 'SubagentStop', at, source: 'hook', helperId: CHILD });
    expect(map('PreInvocation', child({ invocationNum: 0, initialNumSteps: 1 }))).toBeNull();
    // Its conversation is never taken for the session's own.
    expect(map('SessionStart', child({}))?.event).not.toHaveProperty('agentSessionId');
    expect(map('PreToolUse', child({ toolCall: { name: 'read_file' } }))?.event).not.toHaveProperty('transcriptPath');
    expect(map('PreToolUse', main({ toolCall: { name: 'read_file' } }))?.event).toHaveProperty('transcriptPath', transcript(PARENT));
  });
  it('tells a subagent by its transcript, else by its empty prompt', () => {
    expect(agyIsHelper(child({}), read.head)).toBe(true);
    expect(agyIsHelper(main({}), read.head)).toBe(false);
    expect(agyIsHelper(child({}), () => [])).toBe(true);
    expect(agyIsHelper(main({}), () => [])).toBe(false);
  });
  it('reads the reply since the prompt only', () => {
    expect(agyReply(TAIL as never[])).toBe('Added `mul(a, b)` to math.js.');
    expect(agyReply([{ type: 'USER_INPUT', content: 'x' }])).toBeUndefined();
    expect(agyPromptStarts(main({ invocationNum: 0 }), () => [])).toBe(true);
  });
});

describe('agy setup and uninstall', () => {
  const foreign = { mine: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: '/my/check.sh' }] }], Stop: null } };
  it('writes Ledge\'s own group, tool events with a matcher, the others as a plain list, guarded to print nothing', () => {
    const { settings, changed } = mergeAgyHooks(foreign);
    expect(changed).toBe(true);
    const s = settings as Record<string, Record<string, unknown>>;
    expect(s.mine).toEqual(foreign.mine);
    const cmd = (ev: string) => ({ type: 'command', command: guardedHook(`ledge hook agy ${ev}`, 'true'), timeout: 5 });
    expect(s[AGY_GROUP]!.PreToolUse).toEqual([{ matcher: '', hooks: [cmd('PreToolUse')] }]);
    expect(s[AGY_GROUP]!.Stop).toEqual([cmd('Stop')]);
    expect(Object.keys(s[AGY_GROUP]!)).toEqual([...AGY_EVENTS]);
    expect(mergeAgyHooks(settings)).toEqual({ settings, changed: false });
  });
  it('uninstall takes Ledge\'s group out and leaves the user\'s', () => {
    const { settings } = mergeAgyHooks(foreign);
    expect(removeAgyHooks(settings)).toEqual({ settings: foreign, removed: AGY_EVENTS.length });
    expect(removeAgyHooks(foreign)).toEqual({ settings: foreign, removed: 0 });
  });
});

describe('agy launch', () => {
  it('the first prompt goes with -i, folders one --add-dir each, model and effort as agy takes them', () => {
    expect(launchArgs({ tool: 'agy', prompt: 'fix the build', model: 'gemini-4-neon-medium', effort: 'high', dirs: ['/a', '/b'] }))
      .toEqual(['--model', 'gemini-4-neon-medium', '--effort', 'high', '--add-dir', '/a', '--add-dir', '/b', '-i', 'fix the build']);
    expect(launchArgs({ tool: 'agy', continue: true })).toEqual(['--continue']);
    expect(RESUME_ARGS.agy('abc')).toEqual(['--conversation', 'abc']);
  });
  it('starts in the mode that asks, unless the arguments choose a mode', () => {
    expect(agentModeArgs('agy', [])).toEqual(['--settings', '{"agentMode":""}']);
    expect(agentModeArgs('agy', ['--mode', 'auto'])).toEqual([]);
    expect(agentModeArgs('agy', ['--dangerously-skip-permissions'])).toEqual([]);
    expect(agentModeArgs('claude', [])).toEqual([]);
    // A value is not an option: a first prompt or a folder reading `--mode` picks no mode.
    expect(agentModeArgs('agy', ['-i', '--mode'])).toEqual(['--settings', '{"agentMode":""}']);
    expect(agentModeArgs('agy', ['--add-dir', '--dangerously-skip-permissions'])).toEqual(['--settings', '{"agentMode":""}']);
    expect(agentModeArgs('agy', launchArgs({ tool: 'agy', prompt: '--settings' }))).toEqual(['--settings', '{"agentMode":""}']);
    expect(agentModeArgs('agy', ['--mode=plan'])).toEqual([]);
  });
});

describe('agy models', () => {
  // The end of `agy -p … --model <unknown>` (1.5.17).
  const text = `Error: invalid model selection (--model "ledge-list-models" --effort ""): model ledge-list-models is not recognized
Available models:
  Gemini 4 Neon (High)
  Gemini 4 Neon (Medium)
  Gemini 4 Hydrogen (Medium)
  Orchestrator (Neon)
  Claude Opus 5.5 (High)
  GPT-OSS 120B (Medium)
{"conversation_id":"","status":"ERROR"}`;
  it('lists the Gemini models under the ids agy takes, the settings\' one as default', () => {
    expect(parseAgyModels(text, 'Gemini 4 Neon (High)')).toEqual([
      { id: 'gemini-4-neon-high', label: 'Gemini 4 Neon (High)', isDefault: true },
      { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)' },
      { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' }
    ]);
  });
  it('fails without a list', () => {
    expect(() => parseAgyModels('Error: not logged in')).toThrow(/no model list/);
  });
});
