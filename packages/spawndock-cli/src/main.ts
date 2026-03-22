#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import * as Command from "@effect/platform/Command"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, pipe } from "effect"
import {
  buildRuntimeCommand,
  formatMissingProjectError,
  parseArgs,
  resolveProjectDir,
  resolveRuntime,
} from "./core.js"

const program = Effect.gen(function*(_) {
  const options = parseArgs(process.argv.slice(2))
  const projectDir = resolveProjectDir(
    resolve(process.cwd(), options.projectDirArg ?? "."),
    undefined,
    (path) => {
      try {
        readFileSync(path, "utf8")
        return true
      } catch {
        return false
      }
    },
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

NodeRuntime.runMain(Effect.provide(program, NodeContext.layer))
