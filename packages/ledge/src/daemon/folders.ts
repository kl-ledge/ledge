import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { ServerMessage } from '@ledge/protocol';
import { headBranch, inspectRepos } from './repos.js';

type Git = (cwd: string, args: string[]) => Promise<string | null>;
type Listing = Extract<ServerMessage, { type: 'folder.listing' }>;

/** `raw` taken as given (a folder name may start or end with spaces): `~` expanded, absolute, an existing directory. */
async function resolveExact(raw: string, home: string): Promise<string> {
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? resolve(home, raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) throw new Error(`not an absolute path: ${raw}`);
  const path = resolve(expanded);
  let s;
  try { s = await stat(path); } catch { throw new Error(`no such folder: ${path}`); }
  if (!s.isDirectory()) throw new Error(`not a folder: ${path}`);
  return path;
}

/** A folder the user typed (a launch `cwd`): trimmed, `~` expanded, absolute, and an existing directory. Throws the reason otherwise. */
export async function resolveFolder(input: string, home = homedir()): Promise<string> {
  return resolveExact(input.trim(), home);
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The subfolders of `path`, hidden ones left out; a link counts when it leads to a folder. */
async function subfolders(path: string): Promise<string[]> {
  const found = await Promise.all((await readdir(path, { withFileTypes: true })).map(async d => {
    if (d.name.startsWith('.')) return null;
    if (d.isDirectory()) return d.name;
    if (!d.isSymbolicLink()) return null;
    try { return (await stat(join(path, d.name))).isDirectory() ? d.name : null; } catch { return null; }
  }));
  return found.filter((n): n is string => n !== null).sort(byName.compare);
}

/** The branch of the Git repository at `dir` (the short commit when HEAD is detached), read from `.git/HEAD` without running git;
 *  a `.git` that is a file (worktree, submodule) goes through `inspectRepos`. Null when `dir` is not a repository. */
export async function gitBranchOf(dir: string, git?: Git): Promise<string | null> {
  const dot = join(dir, '.git');
  let s;
  try { s = await stat(dot); } catch { return null; }
  if (s.isFile()) return (await inspectRepos([dir], { git }))[0]?.branch ?? null;
  return s.isDirectory() ? headBranch(dot) : null;
}

/**
 * The browser's answer for `input` (home when absent or empty): its subfolders, or the reason it cannot be listed.
 * The path is never trimmed: the browser asks for paths it took from a listing, and a name may end with a space;
 * a refusal echoes the asked path byte for byte. Trimming typed input is the client's job.
 */
export async function listFolder(input: string | undefined, home = homedir(), requestId?: string, git?: Git): Promise<Listing> {
  const tag = requestId === undefined ? {} : { requestId };
  const asked = input || '~';
  try {
    const path = await resolveExact(asked, home);
    const parent = dirname(path);
    const entries = await subfolders(path);
    const branches = await Promise.all(entries.map(name => gitBranchOf(join(path, name), git)));
    const repos = entries.flatMap((name, i) => (branches[i] === null ? [] : [{ name, branch: branches[i]! }]));
    return { type: 'folder.listing', path, parent: parent === path ? null : parent, entries, repos, ...tag };
  } catch (e) {
    return { type: 'folder.listing', path: asked, parent: null, entries: [], error: (e as Error).message, ...tag };
  }
}

/** Makes `name` inside `parent` and lists it; a refusal lists `parent` with the reason, so the browser stays put. */
export async function createFolder(parent: string, name: string, home = homedir(), requestId?: string): Promise<Listing> {
  const at = await listFolder(parent, home, requestId);
  if (at.error) return at;
  const clean = name.trim();
  if (!clean || clean === '.' || clean === '..' || /[/\0]/.test(clean)) return { ...at, error: `invalid folder name: ${name}` };
  try { await mkdir(join(at.path, clean)); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ...at, error: code === 'EEXIST' ? `already exists: ${clean}` : `cannot create ${clean}: ${(e as Error).message}` };
  }
  return listFolder(join(at.path, clean), home, requestId);
}

/** A home folder (`/root`, `/home/<user>`, `/Users/<user>`): never a project's repository (the fleet's proposals.ts rule). */
const HOME = /^\/(?:root|home\/[^/]+|Users\/[^/]+|mnt\/[^/]+\/Users\/[^/]+)$/;
/** Where homes live: `/home`, `/Users`, a WSL drive (`/mnt/c`) and its `Users`. */
const HOMES = /^\/(?:home|Users|mnt\/[^/]+(?:\/Users)?)$/;

/** Why a folder is too wide to start an agent in (it would swallow every repository below it), or null: the root, a home (anyone's,
 *  WSL's Windows ones included, or the user's), a folder of homes, a folder that holds the user's home, a top-level folder. */
export function tooWide(path: string, userHome: string): string | null {
  if (path === '/') return 'the root';
  if (HOME.test(path) || path === userHome) return 'a home folder';
  if (HOMES.test(path)) return 'a folder of homes';
  if (userHome.startsWith(`${path}/`)) return 'a folder holding the home';
  if (/^\/[^/]+$/.test(path)) return 'a top-level folder';
  return null;
}

/**
 * `tooWide` for a folder as named and for where it really leads: a link to the home folder or the root starts its agent there, so it is
 * refused as they are. A folder that cannot be resolved is judged by its name alone; the launch then fails on its own.
 */
export async function folderTooWide(path: string, userHome: string): Promise<string | null> {
  const named = tooWide(path, userHome);
  if (named) return named;
  const real = await realpath(path).catch(() => null);
  return real === null ? null : tooWide(real, await realpath(userHome).catch(() => userHome));
}
