const USAGE = `ledge <claude|codex|cursor|agy> [--name <bot>] [-- args]     start an agent in a tracked session
ledge attach [--read-only] <id>                              put this terminal on a running session
ledge shell [--nonce <hex32>] <dir>                          print the line that starts your login shell in <dir> with Ledge's marks
ledge daemon                                                 run the daemon in the foreground
ledge hook [codex|cursor|agy] <Event>                        receive a hook (reads JSON on stdin)
ledge setup                                                  install hooks and ~/.ledge
ledge uninstall [--purge]                                    remove hooks, service and link (--purge: ~/.ledge too)
ledge status [--all] [--json]                                list the sessions with their ids (--all: the archived ones too)
ledge who [--json]                                           list the live sessions (name, tool, state, project, branch, topic)
ledge archive|unarchive|resume <session>… [--json]           archive (--close: close a running one first), restore, resume sessions
ledge rename <session> "<topic>" | move <session> <project>  change a session's topic, file it in a project
ledge delete <session>… --yes                                delete sessions for good (the user only, not an agent session)
ledge send <nom> "<message>" [--summary <texte>]             write to another Ledge session
ledge read <id>                                              print a long message whole (the id is in its pointer)
ledge brain [<nom>]                                          what Ledge knows of itself and of your environment (your notes)
ledge brain propose|flag …                                   a session proposes a fact for a note, or flags one; the user decides
ledge task <give|list|show|take|done|refuse|pass> …         give another session work, take it, close it (ledge task: details)
ledge routine <add|once|list|show|run|pause|resume|edit|rm> … wake a standing session at set times (ledge routine: details)
ledge report bug|feature "<titre>" "<détail>" | status <id> an agent reports a bug of Ledge or an idea; the user creates the issue
ledge decide [<id> "<réponse>"]                               the decisions sessions wait for from you; answer one
ledge handover "<bilan>" | show                              the relief brief, when Ledge asks for it; show: read your predecessor's
ledge close <session>… [--json]                              close sessions cleanly (their conversation stays resumable)
ledge tui [--notify bell|osc9|off] [--here]                  follow and answer the sessions (in a Ledge tab of Windows Terminal unless --here)
ledge bridge                                                 exchange Ledge messages over SSH stdio
ledge --version                                              print the installed version`;


async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon': { const { startDaemon } = await import('../daemon/index.js'); await startDaemon(); await new Promise(() => {}); return 0; }
    case '--version': case 'version': { const { LEDGE_VERSION } = await import('../version.js'); console.log(LEDGE_VERSION); return 0; }
    case 'setup': { const { runSetup } = await import('./setup.js'); for (const l of await runSetup()) console.log(l); return 0; }
    case 'uninstall': {
      const { runUninstall, uninstallArgs } = await import('./uninstall.js');
      const args = uninstallArgs(rest);
      if (!args) { console.log(USAGE); return rest.every(a => a === '--help' || a === '-h') ? 0 : 1; }
      const r = await runUninstall(args); for (const l of r.lines) console.log(l); return r.ok ? 0 : 1;
    }
    case 'status': { const { runStatus } = await import('./sessions.js'); const r = await runStatus(rest); console.log(r.line); return r.code; }
    case 'who': {
      if (rest.some(a => a !== '--json')) { console.log(USAGE); return 1; }
      const { printWho } = await import('./who.js'); console.log(await printWho({ json: rest.includes('--json') })); return 0;
    }
    case 'archive': case 'unarchive': case 'resume': case 'rename': case 'move': case 'delete': {
      const { runSessionCommand } = await import('./sessions.js'); const r = await runSessionCommand(cmd, rest); console.log(r.line); return r.code;
    }
    case 'send': { const { sendMessage } = await import('./send.js'); const r = await sendMessage(rest); console.log(r.line); return r.code; }
    case 'brain': {
      if (rest[0] === 'propose' || rest[0] === 'flag') { const { runBrainWrite } = await import('../brain/cli.js'); const r = await runBrainWrite(rest); console.log(r.line); return r.code; }
      const { runBrain } = await import('../brain/index.js'); const r = await runBrain(rest); console.log(r.line); return r.code;
    }
    case 'read': { const { readMessage } = await import('./send.js'); const r = await readMessage(rest); console.log(r.line); return r.code; }
    case 'routine': { const { runRoutine } = await import('./routine.js'); const r = await runRoutine(rest); console.log(r.line); return r.code; }
    case 'task': { const { runTask } = await import('./task.js'); const r = await runTask(rest); console.log(r.line); return r.code; }
    case 'report': { const { runReport } = await import('./report.js'); const r = await runReport(rest); console.log(r.line); return r.code; }
    case 'decide': { const { runDecide } = await import('./decide.js'); const r = await runDecide(rest); console.log(r.line); return r.code; }
    case 'handover': { const { runHandover } = await import('./handover.js'); const r = await runHandover(rest); console.log(r.line); return r.code; }
    case 'close': { const { runClose } = await import('./action.js'); const r = await runClose(rest); console.log(r.line); return r.code; }
    case 'tui': { const { runTui } = await import('../tui/index.js'); return runTui(rest); }
    case 'bridge': { const { bridge } = await import('./bridge.js'); await bridge(); return 0; }
    case 'claude': case 'codex': case 'cursor': case 'agy': { const { launch } = await import('./launch.js'); return launch(cmd, rest); }
    case 'shell': { const { shell } = await import('./shell.js'); return shell(rest); }
    case 'attach': { const { attach } = await import('./attach.js'); return attach(rest.find(a => !a.startsWith('--')) ?? '', { readOnly: rest.includes('--read-only') }); }
    default: console.log(USAGE); return cmd ? 1 : 0;
  }
}

/** Every command but `hook` (index.ts runs that one without loading this file): runs it, then exits with its code. */
export function runCli(argv: string[]): void {
  main(argv).then(code => process.exit(code), e => { console.error(`ledge: ${(e as Error).message}`); process.exit(1); });
}
