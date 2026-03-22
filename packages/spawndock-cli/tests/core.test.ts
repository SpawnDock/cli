import { describe, expect, it } from "vitest"
import {
  buildRuntimeCommand,
  formatMissingProjectError,
  parseArgs,
  resolveProjectDir,
  resolveRuntime,
} from "../src/core.js"

describe("parseArgs", () => {
  it("reads runtime and project directory", () => {
    expect(parseArgs(["session", "--runtime", "codex", "/tmp/project"])).toEqual({
      runtimeArg: "codex",
      projectDirArg: "/tmp/project",
    })
  })
})

describe("resolveProjectDir", () => {
  it("finds the nearest bootstrapped project root", () => {
    const existing = new Set(["/tmp/project/spawndock.config.json"])
    const result = resolveProjectDir(
      "/tmp/project/src",
      undefined,
      (path) => existing.has(path),
    )

    expect(result).toBe("/tmp/project")
  })

  it("returns null when no SpawnDock config exists", () => {
    expect(resolveProjectDir("/tmp/project/src", undefined, () => false)).toBeNull()
    expect(formatMissingProjectError()).toContain("spawndock.config.json")
  })
})

describe("resolveRuntime", () => {
  it("prefers explicit runtime flag, then env, then config, then opencode", () => {
    expect(resolveRuntime({}, { agentRuntime: "claude" }, "codex")).toBe("codex")
    expect(resolveRuntime({ SPAWNDOCK_AGENT_RUNTIME: "claude" }, {}, undefined)).toBe("claude")
    expect(resolveRuntime({}, { agentRuntime: "codex" }, undefined)).toBe("codex")
    expect(resolveRuntime({}, {}, undefined)).toBe("opencode")
  })
})

describe("buildRuntimeCommand", () => {
  it("defaults opencode to the project directory", () => {
    expect(buildRuntimeCommand("opencode", "/tmp/project")).toEqual({
      command: "codex",
      args: ["sandbox", "linux", "opencode", "/tmp/project"],
      cwd: "/tmp/project",
    })
  })

  it("configures codex with workspace-write sandbox", () => {
    expect(buildRuntimeCommand("codex", "/tmp/project")).toEqual({
      command: "codex",
      args: ["-C", "/tmp/project", "-s", "workspace-write", "-a", "on-request"],
      cwd: "/tmp/project",
    })
  })
})
