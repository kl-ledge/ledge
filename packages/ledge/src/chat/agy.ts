import { spawn as nodeSpawn } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { withImages } from '../attachmentText.js';
import type { ClaudeEvent, RunHandle, RunOptions } from './claude.js';
import { buildPersona } from './persona.js';
import { runJsonl } from './run.js';

/**
 * Session-only settings for a read-only Antigravity CLI run. Reading needs no rule: agy reads its workspace (the context
 * folder and the repositories, its `--add-dir`) by itself and refuses the rest (seen on agy 1.5.18: a token two folders
 * above the context folder, `~/.bashrc`, `/var/tmp` and a sibling `repo-secret` of a `repo` given were refused; only
 * `/tmp` stays readable, where Ledge keeps nothing). So no `read_file(<dir>)` rule, which would also cover a sibling
 * whose name starts with it. Every shell command is denied: a shell `cat` or `ls` is not held to the workspace and would
 * send any file, or any file's name, to Google. Writes, edits, MCP and URLs are denied, and the asking mode overrides
 * an auto mode the user's own settings may set.
 */
export function agySettings(_o: Pick<RunOptions, 'cwd' | 'addDirs'>): Record<string, unknown> {
  return {
    agentMode: '',
    toolPermission: 'request-review',
    allowNonWorkspaceAccess: false,
    permissions: { allow: [], deny: ['command(*)', 'write_file(*)', 'edit_file(*)', 'mcp(*)', 'read_url(*)', 'execute_url(*)'] }
  };
}

/** Headless `agy` arguments: NDJSON on stdin and stdout, terminal sandbox on, slash commands off, session-only read-only settings, repos as extra workspace roots. */
export function agyArgs(o: RunOptions): string[] {
  return [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--sandbox',
    '--disable-slash-commands',
    '--settings', JSON.stringify(agySettings(o)),
    ...o.addDirs.flatMap(d => ['--add-dir', d]),
    ...(o.resume ? ['--conversation', o.sessionId] : [])
  ];
}

/** One NDJSON user message for `agy --input-format stream-json`, keeping the prompt out of argv. */
export function agyInput(question: string): string {
  return JSON.stringify({ event: 'user', message: { content: question } }) + '\n';
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const pathIn = (s: string) => s.match(/(\/\S+)/)?.[1];

/** One `agy --output-format stream-json` line as Ledge events; ignores non-JSON warnings and steps Ledge does not surface. */
export function parseAgyLine(line: string): ClaudeEvent[] {
  let m: Json; try { m = obj(JSON.parse(line)); } catch { return []; }
  if (m.event === 'init' && str(m.conversation_id)) return [{ type: 'init', sessionId: str(m.conversation_id)! }];
  if (m.event === 'step_update') {
    const su = obj(m.step_update);
    if (su.step_type === 'tool' && su.state === 'ACTIVE') {
      const info = obj(su.tool_info);
      const params = obj(info.parameters);
      const cmd = str(params.CommandLine);
      const path = str(params.Path) ?? str(params.path) ?? str(params.file_path) ?? (cmd ? pathIn(cmd) : undefined);
      const tool = str(info.name) ?? str(su.tool_name) ?? 'tool';
      return [{ type: 'tool', tool, ...(path ? { path } : {}) }];
    }
    if (su.step_type === 'agent_response') {
      // Both ACTIVE and DONE updates carry `text_delta` (the last chunk arrives on DONE).
      const delta = str(su.text_delta);
      return delta ? [{ type: 'delta', text: delta }] : [];
    }
    return [];
  }
  if (m.event === 'result') {
    const r = obj(m.result);
    const response = str(r.response) ?? '';
    const denied = Array.isArray(r.denied_actions)
      ? r.denied_actions.map(a => str(obj(a).display_name) ?? str(obj(a).action)).filter((x): x is string => Boolean(x))
      : [];
    const statusError = r.status !== undefined && r.status !== 'SUCCESS';
    // Headless mode exits SUCCESS with an empty response when an unallowed tool is auto-denied: surface it as an error instead of a blank answer.
    const deniedEmpty = !response && denied.length > 0;
    const isError = statusError || deniedEmpty;
    const text = statusError ? (str(r.error) ?? response) : deniedEmpty ? `Permission denied for ${denied.join(', ')}` : response;
    return [{ type: 'result', text, isError }];
  }
  return [];
}

/** Runs Antigravity CLI headless in the context folder, feeding the persona through `AGENTS.md` and the question through NDJSON stdin. */
export function runAgy(o: RunOptions, onEvent: (e: ClaudeEvent) => void, spawnImpl: typeof nodeSpawn = nodeSpawn): RunHandle {
  const [file = 'agy', ...pre] = o.bin ?? ['agy'];
  writeFileSync(join(o.cwd, 'AGENTS.md'), `${o.persona ?? buildPersona('agy')}\n`);
  // Antigravity CLI has no image CLI flag, but `read_file` reads images natively: copy them into the context folder (removed after the turn) and name them in the text.
  const copies = (o.images ?? []).map((img, n) => { const to = join(o.cwd, `image-${n + 1}${extname(img.path)}`); copyFileSync(img.path, to); return to; });
  const prompt = withImages(o.question, copies);
  return runJsonl(file, [...pre, ...agyArgs(o)], { cwd: o.cwd, env: o.env, question: prompt, stdin: agyInput(prompt) }, parseAgyLine, onEvent, spawnImpl);
}
