# @paradow/ledge (WSL side)

The Ledge daemon and CLI: follow and answer your WSL agent sessions (Claude Code, Codex, Cursor Agent) from the Ledge island on Windows. See the [repository README](https://github.com/kl-ledge/ledge#readme) for the whole picture.

## Install

Node >= 22 is required.

```sh
npm i -g @paradow/ledge && ledge setup
```

## Update

From the Ledge island: the card in the list updates the connected servers' daemons, then the WSL daemon, then the Windows app. By hand, on each machine:

```sh
npm i -g @paradow/ledge@latest && systemctl --user restart ledge-daemon
```

A daemon started from a clone (see below) is not touched by the island's button.

## Install for development

Run from the repository root:

```sh
pnpm install
pnpm --filter @paradow/ledge build
chmod +x packages/ledge/dist/cli/index.js
mkdir -p ~/.local/bin
ln -sf "$PWD/packages/ledge/dist/cli/index.js" ~/.local/bin/ledge   # ~/.local/bin must be on the PATH Claude Code uses for hooks
ledge setup                         # the link becomes a script that runs the CLI with this node (a session Ledge launches may have no node on its PATH: nvm)
```

The daemon is spawned from the built CLI (`dist/cli/index.js`), so rebuild after changes (`pnpm --filter @paradow/ledge build`).

## Use

```sh
ledge claude            # start Claude Code in a tracked tmux session (tab renamed to the bot)
ledge claude --name max # pick the session's Ledge name
ledge status            # list bots and what they wait for
ledge attach <id>       # put this terminal on a running session (what the overlay opens a tab with)
ledge tui               # follow and answer every session (--notify bell|osc9|off); see below for Windows Terminal
ledge daemon            # run the daemon in the foreground (normally run by the systemd service)
ledge uninstall         # undo ledge setup: hooks, service and ~/.local/bin/ledge (--purge: ~/.ledge too)
```

From a WSL tab of Windows Terminal, `ledge tui` opens in a tab of its own with the Ledge mascot as its icon. A tab's
icon comes only from its profile, so Ledge installs a `Ledge` profile as a fragment under
`%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\Ledge` (no admin right needed). That profile runs
`~/.ledge/tui.sh`, which each `ledge tui` rewrites with its node and CLI. `ledge tui --here`, tmux, SSH and any other
terminal keep the TUI where it was started.

When a Claude it launched exits, Ledge appends a `custom-title` « name - topic » to its transcript, so `claude --resume` lists the conversation that way, unless the user named it (`claude -n`, `/rename`).

`ledge setup` installs `ledge-daemon.service` as a systemd user unit, starts it and enables linger, so the daemon runs from WSL boot and restarts after a crash. Rerun it after a node upgrade or a repository move: the unit is rewritten and the service restarted. Useful commands:

```sh
systemctl --user status ledge-daemon.service
journalctl --user -u ledge-daemon.service -f
systemctl --user restart ledge-daemon.service   # after pnpm --filter @paradow/ledge build
systemctl --user disable --now ledge-daemon.service   # back to on-demand start by ledge claude
```

## Where things live

```text
~/.ledge/tmux.conf      dedicated tmux server config (status off, mouse on)
~/.ledge/sessions.json  journal, reloaded when the daemon restarts
~/.ledge/daemon.log     dropped hooks, failed injections, poll errors
~/.ledge/*.bak-<date>   the removed chat's data and the operator's journal, set aside at start (#40), never deleted
~/.ledge/tui.json       ledge tui's settings (its language)
~/.ledge/daemon.pid     PID of the running daemon, removed when it stops cleanly
~/.config/systemd/user/ledge-daemon.service   user unit written by `ledge setup`
~/.ledge/exit-<id>      transient: the agent's exit code, written by the launcher's wrapper when the agent ends and read and deleted by `ledge claude`
```

Session names and tab titles: Ledge sets `set-titles` in `~/.ledge/tmux.conf`. A tmux server that is already running re-reads `tmux.conf` only after it restarts, so `set-titles` applies to new tmux servers. The tab string is `${name} · ${topic ?? project}`; `session.rename` from the overlay updates it.

## Tests

```sh
pnpm --filter @paradow/ledge test            # unit + tmux + end-to-end (needs tmux, no AI)
pnpm --filter @paradow/ledge test state      # only the transition table
```

## Refreshing pane fixtures

Run from `packages/ledge` (the output path is relative to it):

```sh
tmux -L ledge capture-pane -p -J -t ledge-<id> -S -30 > test/fixtures/panes/<name>.txt
```
