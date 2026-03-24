# @spawn-dock/cli

Minimal SpawnDock runtime launcher for bootstrapped TMA projects.

- refuses to run outside a directory containing `spawndock.config.json`
- defaults to `opencode`
- runtime can be overridden via `SPAWNDOCK_AGENT_RUNTIME` or `agentRuntime` in
  `spawndock.config.json`
- defaults to project-scoped sandboxed launch behavior

## Commands

- `spawn-dock session` — start only the AI agent runtime (Codex sandbox / OpenCode path).
- `spawn-dock agent` — start Next.js dev server, then the dev tunnel, then the same agent session as `session` (use from `pnpm run agent` in the template).
