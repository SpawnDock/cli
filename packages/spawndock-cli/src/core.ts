export type AgentRuntime = "opencode" | "codex" | "claude"

export type SpawnDockCliOptions = {
  readonly projectDirArg?: string
  readonly runtimeArg?: AgentRuntime
}

export type SpawnDockRuntimeConfig = {
  readonly projectDir: string
  readonly runtime: AgentRuntime
}

export type CommandSpec = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
}

const DEFAULT_RUNTIME: AgentRuntime = "opencode"

export const parseArgs = (argv: ReadonlyArray<string>): SpawnDockCliOptions => {
  let projectDirArg: string | undefined
  let runtimeArg: AgentRuntime | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === undefined) {
      continue
    }

    if (value === "session") {
      continue
    }

    if (value === "--runtime") {
      runtimeArg = parseRuntime(argv[index + 1])
      index += 1
      continue
    }

    if (value.startsWith("--runtime=")) {
      runtimeArg = parseRuntime(value.slice("--runtime=".length))
      continue
    }

    if (!value.startsWith("--") && projectDirArg === undefined) {
      projectDirArg = value
    }
  }

  return {
    ...(projectDirArg ? { projectDirArg } : {}),
    ...(runtimeArg ? { runtimeArg } : {}),
  }
}

export const resolveProjectDir = (
  cwd: string,
  projectDirArg: string | undefined,
  exists: (path: string) => boolean,
): string | null => {
  const startDir = normalizePath(projectDirArg ?? cwd)
  const parts = startDir.split("/").filter(Boolean)

  for (let length = parts.length; length >= 0; length -= 1) {
    const candidate = `/${parts.slice(0, length).join("/")}` || "/"
    if (exists(`${candidate}/spawndock.config.json`)) {
      return candidate
    }
  }

  return null
}

export const resolveRuntime = (
  env: NodeJS.ProcessEnv,
  config: Record<string, unknown>,
  runtimeArg?: AgentRuntime,
): AgentRuntime =>
  runtimeArg ??
  parseRuntime(env["SPAWNDOCK_AGENT_RUNTIME"]) ??
  parseRuntime(readString(config["agentRuntime"])) ??
  DEFAULT_RUNTIME

export const buildRuntimeCommand = (
  runtime: AgentRuntime,
  projectDir: string,
): CommandSpec => {
  if (runtime === "codex") {
    return {
      command: "codex",
      args: ["-C", projectDir, "-s", "workspace-write", "-a", "on-request"],
      cwd: projectDir,
    }
  }

  if (runtime === "claude") {
    return {
      command: "claude",
      args: [],
      cwd: projectDir,
    }
  }

  return {
    command: "codex",
    args: ["sandbox", "linux", "opencode", projectDir],
    cwd: projectDir,
  }
}

export const formatMissingProjectError = () =>
  "SpawnDock CLI must be run inside a bootstrapped project directory containing spawndock.config.json."

function parseRuntime(value: string | undefined): AgentRuntime | undefined {
  return value === "opencode" || value === "codex" || value === "claude"
    ? value
    : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`
}
