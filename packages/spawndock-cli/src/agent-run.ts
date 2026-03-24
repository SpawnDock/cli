import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { findAvailablePort, waitForPort } from "./ports.js"
import type { CommandSpec } from "./core.js"

export type SpawnDockProjectConfig = {
  readonly localPort?: unknown
}

function readPreferredPort(projectDir: string): number {
  const configPath = resolve(projectDir, "spawndock.config.json")
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as SpawnDockProjectConfig
  return typeof raw.localPort === "number" && Number.isFinite(raw.localPort)
    ? raw.localPort
    : 3000
}

function assertSpawndockScripts(projectDir: string): void {
  const nextScript = resolve(projectDir, "spawndock/next.mjs")
  const tunnelScript = resolve(projectDir, "spawndock/tunnel.mjs")
  if (!existsSync(nextScript) || !existsSync(tunnelScript)) {
    throw new Error(
      "Missing spawndock/next.mjs or spawndock/tunnel.mjs. Use a SpawnDock-bootstrapped TMA project.",
    )
  }
}

/**
 * Starts Next dev server, then dev tunnel, then runs the agent process in the foreground.
 * Kills Next and tunnel when the agent exits or on SIGINT/SIGTERM.
 */
export async function runAgentWithDev(projectDir: string, agentSpec: CommandSpec): Promise<number> {
  assertSpawndockScripts(projectDir)

  const preferredPort = readPreferredPort(projectDir)
  const localPort = await findAvailablePort(preferredPort)
  const sharedEnv = {
    ...process.env,
    SPAWNDOCK_PORT: String(localPort),
  }

  const nextScript = resolve(projectDir, "spawndock/next.mjs")
  const tunnelScript = resolve(projectDir, "spawndock/tunnel.mjs")

  const children: ChildProcess[] = []
  let shuttingDown = false

  const killAll = (signal: NodeJS.Signals = "SIGTERM"): void => {
    shuttingDown = true
    for (const child of [...children].reverse()) {
      if (!child.killed) {
        child.kill(signal)
      }
    }
  }

  const onSignal = (signal: NodeJS.Signals): void => {
    killAll(signal)
    process.exit(signal === "SIGINT" ? 130 : 143)
  }

  process.once("SIGINT", () => onSignal("SIGINT"))
  process.once("SIGTERM", () => onSignal("SIGTERM"))

  const nextChild = spawn(process.execPath, [nextScript], {
    cwd: projectDir,
    env: sharedEnv,
    stdio: "inherit",
  })
  children.push(nextChild)

  nextChild.on("exit", (code) => {
    if (shuttingDown) {
      return
    }
    if (typeof code === "number" && code !== 0) {
      killAll()
      process.exit(code)
    }
  })

  try {
    await waitForPort(localPort, {
      isCancelled: () => nextChild.exitCode !== null,
    })
  } catch (err) {
    killAll()
    throw err
  }

  const tunnelChild = spawn(process.execPath, [tunnelScript], {
    cwd: projectDir,
    env: sharedEnv,
    stdio: "inherit",
  })
  children.push(tunnelChild)

  tunnelChild.on("exit", (code) => {
    if (shuttingDown) {
      return
    }
    if (typeof code === "number" && code !== 0) {
      killAll()
      process.exit(code)
    }
  })

  const agentEnv = {
    ...process.env,
    SPAWNDOCK_PORT: String(localPort),
  }

  const agentChild = spawn(agentSpec.command, [...agentSpec.args], {
    cwd: agentSpec.cwd,
    env: agentEnv,
    stdio: "inherit",
  })

  const exitCode: number = await new Promise((resolvePromise, reject) => {
    agentChild.once("error", reject)
    agentChild.once("exit", (code) => {
      resolvePromise(typeof code === "number" ? code : 1)
    })
  })

  killAll()
  return exitCode
}
