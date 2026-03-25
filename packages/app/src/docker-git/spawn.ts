import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect, pipe, Schedule } from "effect"

import {
  type CreateCommand,
  defaultTemplateConfig,
  deriveRepoSlug,
  type TemplateConfig
} from "@effect-template/lib/core/domain"
import type { SpawnCommand } from "@effect-template/lib/core/spawn-domain"
import {
  runCommandCapture,
  runCommandExitCode,
  runCommandWithExitCodes
} from "@effect-template/lib/shell/command-runner"
import { readProjectConfig } from "@effect-template/lib/shell/config"
import { CommandFailedError, SpawnProjectDirError, SpawnSetupError } from "@effect-template/lib/shell/errors"
import { createProject } from "@effect-template/lib/usecases/actions"
import { findSshPrivateKey } from "@effect-template/lib/usecases/path-helpers"
import { getContainerIpIfInsideContainer } from "@effect-template/lib/usecases/projects-core"

const SPAWNDOCK_REPO_URL = "https://github.com/SpawnDock/tma-project"
const SPAWNDOCK_REPO_REF = "main"

// remoteCommand = undefined → probe mode (ssh -T BatchMode + "true"), string → execute mode
const buildSshArgs = (
  template: TemplateConfig,
  sshKey: string | null,
  ipAddress: string | undefined,
  remoteCommand?: string
): ReadonlyArray<string> => {
  const host = ipAddress ?? "localhost"
  const port = ipAddress ? 22 : template.sshPort
  const args: Array<string> = []
  if (sshKey !== null) {
    args.push("-i", sshKey)
  }
  if (remoteCommand === undefined) {
    args.push("-T", "-o", "ConnectTimeout=2", "-o", "ConnectionAttempts=1")
  }
  args.push(
    "-o",
    "BatchMode=yes",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(port),
    `${template.sshUser}@${host}`,
    remoteCommand ?? "true"
  )
  return args
}

const waitForSshReady = (
  template: TemplateConfig,
  sshKey: string | null,
  ipAddress?: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> => {
  const host = ipAddress ?? "localhost"
  const port = ipAddress ? 22 : template.sshPort
  const probe = Effect.gen(function*(_) {
    const exitCode = yield* _(
      runCommandExitCode({
        cwd: process.cwd(),
        command: "ssh",
        args: buildSshArgs(template, sshKey, ipAddress)
      })
    )
    if (exitCode !== 0) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "ssh wait", exitCode })))
    }
  })

  return pipe(
    Effect.log(`Waiting for SSH on ${host}:${port} ...`),
    Effect.zipRight(
      Effect.retry(
        probe,
        pipe(
          Schedule.spaced(Duration.seconds(2)),
          Schedule.intersect(Schedule.recurs(30))
        )
      )
    ),
    Effect.tap(() => Effect.log("SSH is ready."))
  )
}

const parseProjectDir = (output: string): string | null => {
  const match = /SpawnDock project created at (.+)/.exec(output)
  return match?.[1]?.trim() ?? null
}

const buildSpawnCreateCommand = (outDir: string, force: boolean): CreateCommand => {
  const repoSlug = deriveRepoSlug(SPAWNDOCK_REPO_URL)
  const containerName = `dg-${repoSlug}`
  const serviceName = `dg-${repoSlug}`
  const volumeName = `dg-${repoSlug}-home`

  return {
    _tag: "Create",
    config: {
      ...defaultTemplateConfig,
      repoUrl: SPAWNDOCK_REPO_URL,
      repoRef: SPAWNDOCK_REPO_REF,
      containerName,
      serviceName,
      volumeName
    },
    outDir,
    runUp: true,
    force,
    forceEnv: false,
    waitForClone: true,
    openSsh: false
  }
}

const spawnAttachDirect = (
  template: TemplateConfig,
  projectDir: string,
  sshKey: string | null,
  ipAddress: string | undefined
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log("Starting opencode directly via SSH..."))
    yield* _(
      runCommandWithExitCodes(
        {
          cwd: process.cwd(),
          command: "ssh",
          args: [
            "-tt", // Force TTY allocation for interactive opencode session
            ...buildSshArgs(
              template,
              sshKey,
              ipAddress,
              `cd '${projectDir}' && spawn-dock agent`
            ).filter((arg) =>
              arg !== "-T" && arg !== "-o" && arg !== "BatchMode=yes" && arg !== "ConnectTimeout=2" &&
              arg !== "ConnectionAttempts=1"
            )
          ]
        },
        [0, 255], // SSH frequently exits with 255 on user disconnect, which is normal
        (exitCode) => new CommandFailedError({ command: "ssh agent", exitCode })
      )
    )
  })

// CHANGE: orchestrate spawn-dock spawn — creates container, runs @spawn-dock/create, opens tmux+opencode
// WHY: provide one-command bootstrap from a Telegram bot pairing token
// REF: spawn-command
// PURITY: SHELL
// EFFECT: Effect<void, SpawnProjectDirError | SpawnSetupError | ..., CommandExecutor | FileSystem | Path>
// INVARIANT: container is started before SSH connection; tmux session opens after successful bootstrap
// COMPLEXITY: O(1) + docker + ssh
export const spawnProject = (command: SpawnCommand) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)

    yield* _(Effect.log("Creating SpawnDock container..."))
    const syntheticCreate = buildSpawnCreateCommand(command.outDir, command.force)
    yield* _(createProject(syntheticCreate))

    const resolvedOutDir = path.resolve(command.outDir)
    const projectConfig = yield* _(readProjectConfig(resolvedOutDir))
    const template = projectConfig.template

    const containerIpRaw = yield* _(
      getContainerIpIfInsideContainer(fs, process.cwd(), template.containerName).pipe(
        Effect.map((ip) => ip ?? ""),
        Effect.orElse(() => Effect.succeed(""))
      )
    )
    const ipAddress: string | undefined = containerIpRaw.length > 0 ? containerIpRaw : undefined

    const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))

    yield* _(waitForSshReady(template, sshKey, ipAddress))

    const createCmd = `npx -y @spawn-dock/create@beta --token ${command.token}`
    yield* _(Effect.log("Running @spawn-dock/create inside container..."))

    const output = yield* _(
      runCommandCapture(
        {
          cwd: process.cwd(),
          command: "ssh",
          args: buildSshArgs(template, sshKey, ipAddress, createCmd)
        },
        [0],
        (exitCode) => new SpawnSetupError({ exitCode })
      )
    )

    const projectDir = parseProjectDir(output)
    if (projectDir === null) {
      return yield* _(Effect.fail(new SpawnProjectDirError({ output })))
    }

    yield* _(Effect.log(`Project bootstrapped at ${projectDir}`))

    yield* _(spawnAttachDirect(template, projectDir, sshKey, ipAddress))
  })
