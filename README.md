# spawn-dock

`spawn-dock` creates a separate Docker environment for each repository, issue, or PR.
By default, projects reside in `~/.spawn-dock`.

## Prerequisites

- Docker Engine or Docker Desktop
- Docker access without `sudo`
- Node.js and `npm`

## Installation

```bash
npm i -g @spawn-dock/cli
spawn-dock --help
```

## Authentication

```bash
spawn-dock auth github login --web
spawn-dock auth codex login --web
spawn-dock auth claude login --web
```

## Example

You can pass a link to a repository, branch (`/tree/...`), issue, or PR.

```bash
spawn-dock clone https://github.com/SpawnDock/cli/issues/122 --force --mcp-playwright
```

- `--force` recreates the environment and removes the project's volumes.
- `--mcp-playwright` enables Playwright MCP and the Chromium sidecar for browser automation.

Automatic agent launch:

```bash
spawn-dock clone https://github.com/SpawnDock/cli/issues/122 --force --auto
```

- `--auto` selects Claude or Codex based on available authentication. If both are available, the choice is random.
- `--auto=claude` or `--auto=codex` forces a specific agent.
- In auto mode the agent executes the task on its own, creates a PR, and the container is cleaned up after completion.

## Details

`spawn-dock --help`

## SpawnDock CLI

This workspace also includes a separate package `@spawn-dock/cli` for bootstrapped
SpawnDock TMA projects.

It runs inside a directory that already contains `spawndock.config.json` and
defaults to launching `opencode`. The runtime can be overridden via
`SPAWNDOCK_AGENT_RUNTIME=codex|claude|opencode` or via `agentRuntime` in
`spawndock.config.json`.

This is an intentionally minimal launcher. It locks the project root and launches
the agent only from it; `opencode` by default starts via
`codex sandbox linux`, and `codex` itself launches with `workspace-write` sandbox.
