import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';
import type { ServerMessage } from '@ledge/protocol';
import { agyArgs, agyInput, agySettings, parseAgyLine, runAgy } from '../src/chat/agy.js';
import { buildPersona } from '../src/chat/persona.js';
import { createChat } from '../src/chat/service.js';
import { Store } from '../src/daemon/store.js';

const opts = (extra = {}) => ({
  question: 'Où en sont les autres ?',
  cwd: process.cwd(),
  addDirs: ['/w/ledge'],
  sessionId: '369729d6-2586-4b9a-b344-78275a4cb86a',
  resume: false,
  env: { ...process.env },
  ...extra
});

/** In-process fake spawn that captures argv and stdin, then emits recorded NDJSON lines. */
function fakeSpawn(lines: string[], code = 0) {
  const calls: Array<{ file: string; args: string[]; cwd: string; stdin: string }> = [];
  const spawn = ((file: string, args: string[], o: { cwd: string }) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill: () => { child.emit('close', null); }
    });
    const rec = { file, args, cwd: o.cwd, stdin: '' };
    calls.push(rec);
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk: string) => { rec.stdin += chunk; });
    child.stdin.on('end', () => {
      setImmediate(() => {
        for (const l of lines) child.stdout.write(`${l}\n`);
        setImmediate(() => child.emit('close', code));
      });
    });
    return child;
  }) as unknown as typeof nodeSpawn;
  return { spawn, calls };
}

describe('agyArgs', () => {
  it('runs stream-json on stdin and stdout, sandboxed, read-only via session settings, and adds repos as extra roots', () => {
    const a = agyArgs(opts());
    expect(a).toContain('--input-format'); expect(a[a.indexOf('--input-format') + 1]).toBe('stream-json');
    expect(a).toContain('--output-format'); expect(a[a.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(a).toContain('--sandbox');
    expect(a).toContain('--disable-slash-commands');
    expect(a).toContain('--add-dir'); expect(a[a.indexOf('--add-dir') + 1]).toBe('/w/ledge');
    expect(a).not.toContain('--dangerously-skip-permissions');
    expect(a).not.toContain('--mode');
    expect(a).not.toContain('-p');
    expect(a).not.toContain('--conversation');

    const settings = JSON.parse(a[a.indexOf('--settings') + 1]!) as ReturnType<typeof agySettings>;
    expect(settings).toMatchObject({ agentMode: '', toolPermission: 'request-review', allowNonWorkspaceAccess: false });
    const perms = settings.permissions as { allow: string[]; deny: string[] };
    // Nothing allowed: agy holds its reads to the workspace by itself, and a path rule would also cover a sibling named alike.
    expect(perms.allow).toEqual([]);
    // No shell at all: a shell read or listing is not held to the workspace.
    expect(perms.deny).toEqual(expect.arrayContaining(['command(*)', 'write_file(*)', 'edit_file(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)']));
    // The repositories are the workspace's other roots.
    expect(a.filter((x, i) => a[i - 1] === '--add-dir')).toEqual(['/w/ledge']);

    const resumed = agyArgs(opts({ resume: true }));
    expect(resumed).toContain('--conversation');
    expect(resumed[resumed.indexOf('--conversation') + 1]).toBe(opts().sessionId);
  });
});

describe('parseAgyLine', () => {
  it('maps recorded init, reads, shell searches, text deltas and final result; ignores the rest', () => {
    // Lines captured from Antigravity CLI 1.5.18 (`--output-format stream-json`).
    expect(parseAgyLine(JSON.stringify({
      event: 'init', conversation_id: '369729d6-2586-4b9a-b344-78275a4cb86a',
      init: { cwd: '/tmp/test-agy-chat', tools: ['run_command'], permission_mode: 'request-review' }
    }))).toEqual([{ type: 'init', sessionId: '369729d6-2586-4b9a-b344-78275a4cb86a' }]);

    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: '369729d6-2586-4b9a-b344-78275a4cb86a', step_index: 2, state: 'ACTIVE', step_type: 'tool',
        tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/tmp/test-agy-chat/sessions.md' } }
      }
    }))).toEqual([{ type: 'tool', tool: 'read_file', path: '/tmp/test-agy-chat/sessions.md' }]);

    // Tool DONE/ERROR updates do not emit a duplicate tool step.
    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: '369729d6-2586-4b9a-b344-78275a4cb86a', step_index: 2, state: 'DONE', step_type: 'tool',
        tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: '/tmp/test-agy-chat/sessions.md' }, output: '1 lines, 30 bytes' }
      }
    }))).toEqual([]);

    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'd6abf2f9-1001-4856-9ae9-f367e71701e5', step_index: 3, state: 'ACTIVE', step_type: 'tool',
        tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'grep -rn needle /w/ledge/src' } }
      }
    }))).toEqual([{ type: 'tool', tool: 'run_command', path: '/w/ledge/src' }]);

    // Both ACTIVE and DONE agent_response steps carry text_delta.
    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: { conversation_id: 'S', step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Deux ' }
    }))).toEqual([{ type: 'delta', text: 'Deux ' }]);

    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: { conversation_id: 'S', step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: 'compagnons.\n' }
    }))).toEqual([{ type: 'delta', text: 'compagnons.\n' }]);

    // Thinking-only agent_response before a tool call has no text_delta.
    expect(parseAgyLine(JSON.stringify({
      event: 'step_update',
      step_update: { conversation_id: 'S', step_index: 1, state: 'DONE', step_type: 'agent_response', duration_seconds: 3.9 }
    }))).toEqual([]);

    expect(parseAgyLine(JSON.stringify({
      event: 'result',
      result: { conversation_id: 'S', status: 'SUCCESS', response: 'Deux compagnons.\n', num_turns: 1 }
    }))).toEqual([{ type: 'result', text: 'Deux compagnons.\n', isError: false }]);

    expect(parseAgyLine(JSON.stringify({
      event: 'result',
      result: { conversation_id: 'S', status: 'ERROR', response: '', error: 'stream input message is missing the "event" field' }
    }))).toEqual([{ type: 'result', text: 'stream input message is missing the "event" field', isError: true }]);

    // Headless auto-deny returns SUCCESS with an empty response and denied_actions.
    expect(parseAgyLine(JSON.stringify({
      event: 'result',
      result: { conversation_id: 'S', status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'Bash' }] }
    }))).toEqual([{ type: 'result', text: 'Permission denied for Bash', isError: true }]);

    expect(parseAgyLine('warning: conversation "x" not found')).toEqual([]);
  });
});

describe('runAgy', () => {
  it('writes AGENTS.md, sends the NDJSON user message on stdin, and streams agy events', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ledge-agy-'));
    const recorded = [
      JSON.stringify({ event: 'init', conversation_id: 'conv-1', init: { cwd, permission_mode: 'request-review' } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: join(cwd, 'sessions.md') } } } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 2, state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: join(cwd, 'sessions.md') } } } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Deux ' } }),
      JSON.stringify({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'agent_response', text_delta: 'compagnons travaillent.' } }),
      JSON.stringify({ event: 'result', result: { conversation_id: 'conv-1', status: 'SUCCESS', response: 'Deux compagnons travaillent.' } })
    ];
    const { spawn, calls } = fakeSpawn(recorded);
    const events: unknown[] = [];
    const r = await runAgy(opts({ cwd, persona: 'Tu es Ledge.' }), e => events.push(e), spawn).done;

    expect(r.code).toBe(0);
    expect(calls[0]?.file).toBe('agy');
    expect(calls[0]?.stdin).toBe(agyInput('Où en sont les autres ?'));
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe('Tu es Ledge.\n');
    expect(events).toEqual([
      { type: 'init', sessionId: 'conv-1' },
      { type: 'tool', tool: 'read_file', path: join(cwd, 'sessions.md') },
      { type: 'delta', text: 'Deux ' },
      { type: 'delta', text: 'compagnons travaillent.' },
      { type: 'result', text: 'Deux compagnons travaillent.', isError: false }
    ]);
  });

  it('uses the agy persona (describing read_file and read-only sandboxed shell) when none is given', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ledge-agy-persona-'));
    const { spawn } = fakeSpawn([JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'ok' } })]);
    await runAgy(opts({ cwd }), () => {}, spawn).done;
    const written = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(written).toBe(`${buildPersona('agy')}\n`);
    expect(written).toContain('read_file');
  });
});

describe('runAgy images', () => {
  it('copies each image into cwd as image-N.<ext> and names them in the NDJSON user message', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ledge-agy-img-'));
    const src = join(cwd, '..', `src-${Date.now()}.png`);
    writeFileSync(src, 'x'); writeFileSync(`${src}.jpg`, 'y');
    const { spawn, calls } = fakeSpawn([JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'vu' } })]);

    await runAgy(opts({ cwd, images: [{ path: src, mime: 'image/png' }, { path: `${src}.jpg`, mime: 'image/jpeg' }] }), () => {}, spawn).done;

    expect(readFileSync(join(cwd, 'image-1.png'), 'utf8')).toBe('x');
    expect(readFileSync(join(cwd, 'image-2.jpg'), 'utf8')).toBe('y');
    expect(JSON.parse(calls[0]!.stdin)).toEqual({
      event: 'user',
      message: { content: `Où en sont les autres ? [Image attached: ${cwd}/image-1.png] [Image attached: ${cwd}/image-2.jpg]` }
    });
  });
});

describe('chat service with agy', () => {
  it('runs Ask Ledge on agy, persists its conversation id from init, and resumes it on the next question', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-agy-svc-'));
    const seenArgs: string[][] = [];
    const spawn = ((_file: string, args: string[], o: { cwd: string }) => {
      seenArgs.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
        kill: () => { child.emit('close', null); }
      });
      child.stdin.on('end', () => {
        setImmediate(() => {
          child.stdout.write(JSON.stringify({ event: 'init', conversation_id: 'agy-conv-real' }) + '\n');
          child.stdout.write(JSON.stringify({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'tool', tool_name: 'read_file', tool_info: { name: 'read_file', parameters: { Path: join(o.cwd, 'sessions.md') } } } }) + '\n');
          child.stdout.write(JSON.stringify({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Tout va bien.' } }) + '\n');
          child.stdout.write(JSON.stringify({ event: 'result', result: { conversation_id: 'agy-conv-real', status: 'SUCCESS', response: 'Tout va bien.' } }) + '\n');
          setImmediate(() => child.emit('close', 0));
        });
      });
      child.stdin.resume();
      return child;
    }) as unknown as typeof nodeSpawn;

    const chat = createChat({
      store: new Store({ journalPath: join(home, 'j.json') }),
      tmux: { async capture() { return null; } },
      home,
      today: () => '2026-11-27',
      env: async () => ({ ...process.env }),
      spawn
    });

    const out: ServerMessage[] = [];
    await chat.ask('q1', 'Où en sont les autres ?', m => out.push(m), 'agy');
    expect(out.some(m => m.type === 'chat.step')).toBe(true);
    expect(out.some(m => m.type === 'chat.delta')).toBe(true);
    expect(out.at(-1)).toMatchObject({ type: 'chat.done', text: 'Tout va bien.' });
    expect(seenArgs[0]).not.toContain('--conversation');
    expect(JSON.parse(readFileSync(join(home, 'chat.json'), 'utf8'))).toEqual({ day: '2026-11-27', sessionId: 'agy-conv-real', tool: 'agy' });

    await chat.ask('q2', 'Et maintenant ?', () => {}, 'agy');
    expect(seenArgs[1]).toContain('--conversation');
    expect(seenArgs[1]![seenArgs[1]!.indexOf('--conversation') + 1]).toBe('agy-conv-real');
  });
});
