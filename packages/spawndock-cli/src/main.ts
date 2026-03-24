#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as Command from "@effect/platform/Command"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, pipe } from "effect"
import { runAgentWithDev } from "./agent-run.js"
import {
  buildRuntimeCommand,
  formatMissingProjectError,
  parseArgs,
  resolveProjectDir,
  resolveRuntime,
} from "./core.js"

function configExistsAt(path: string): boolean {
  try {
    readFileSync(path, "utf8")
    return true
  } catch {
    return false
  }
}

const sessionProgram = Effect.gen(function*(_) {
  const options = parseArgs(process.argv.slice(2))
  const projectDir = resolveProjectDir(
    resolve(process.cwd(), options.projectDirArg ?? "."),
    undefined,
    (path) => configExistsAt(path),
  )

  if (projectDir === null) {
    yield* _(Console.error(formatMissingProjectError()))
    return yield* _(Effect.fail(new Error("missing_project")))
  }

  const config = JSON.parse(readFileSync(resolve(projectDir, "spawndock.config.json"), "utf8")) as Record<string, unknown>
  const runtime = resolveRuntime(process.env, config, options.runtimeArg)
  const spec = buildRuntimeCommand(runtime, projectDir)

  yield* _(Console.log(`Launching ${runtime} in ${projectDir}`))
  yield* _(Console.log("Filesystem access is constrained to the project working directory on a best-effort basis."))
  yield* _(Command.exitCode(
    pipe(
      Command.make(spec.command, ...spec.args),
      Command.workingDirectory(spec.cwd),
      Command.stdin("inherit"),
      Command.stdout("inherit"),
      Command.stderr("inherit"),
    ),
  ))
})

async function runAgentCli(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const projectDir = resolveProjectDir(
    resolve(process.cwd(), options.projectDirArg ?? "."),
    undefined,
    (path) => configExistsAt(path),
  )

  if (projectDir === null) {
    console.error(formatMissingProjectError())
    process.exit(1)
  }

  const config = JSON.parse(readFileSync(resolve(projectDir, "spawndock.config.json"), "utf8")) as Record<string, unknown>
  const runtime = resolveRuntime(process.env, config, options.runtimeArg)
  const spec = buildRuntimeCommand(runtime, projectDir)

  console.log(`SpawnDock agent: Next.js + tunnel, then ${runtime} (${projectDir})`)
  const code = await runAgentWithDev(projectDir, spec)
  process.exit(code)
}

const argv = process.argv.slice(2)
if (argv[0] === "agent") {
  runAgentCli().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
} else {
  NodeRuntime.runMain(Effect.provide(sessionProgram, NodeContext.layer))
}
