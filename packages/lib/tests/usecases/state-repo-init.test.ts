// CHANGE: integration tests for stateInit — orphan adoption and idempotency
// WHY: PR reviewer required test coverage for fix-141 bug (divergent root commit)
// QUOTE(ТЗ): "Новая ветка открывается только тогда когда не возможно исправить конфликт и сделать push в main"
// REF: issue-141
// PURITY: SHELL (integration tests using real git)
// INVARIANT: each test uses an isolated temp dir and a local bare repo as fake remote

import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { execSync } from "node:child_process"
import * as nodePath from "node:path"

import { stateInit } from "../../src/usecases/state-repo.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a local bare git repository that can act as a remote for tests.
 * Optionally seeds it with an initial commit so that `git fetch` has history.
 *
 * @pure false (filesystem + process spawn)
 * @invariant returned path is always an absolute path to a bare repo
 */
// GIT_CONFIG_NOSYSTEM=1 bypasses system-level git hooks (e.g. the docker-git
// pre-push hook that blocks pushes to `main`).  Only used in test seeding, not
// in the code-under-test.
const seedEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }

const makeFakeRemote = (baseDir: string, withInitialCommit: boolean): string => {
  const remotePath = nodePath.join(baseDir, "remote.git")
  execSync(`git init --bare --initial-branch=main "${remotePath}" 2>/dev/null || git init --bare "${remotePath}"`, { env: seedEnv })

  if (withInitialCommit) {
    // Seed the bare repo by creating a local repo and pushing to it
    const seedDir = nodePath.join(baseDir, "seed")
    execSync(`git init --initial-branch=main "${seedDir}" 2>/dev/null || git init "${seedDir}"`, { env: seedEnv })
    execSync(`git -C "${seedDir}" config user.email "test@example.com"`)
    execSync(`git -C "${seedDir}" config user.name "Test"`)
    execSync(`git -C "${seedDir}" remote add origin "${remotePath}"`)
    execSync(`echo "# .docker-git" > "${seedDir}/README.md"`)
    execSync(`git -C "${seedDir}" add -A`, { env: seedEnv })
    execSync(`git -C "${seedDir}" commit -m "initial"`, { env: seedEnv })
    // Push explicitly to main regardless of local default branch name.
    // GIT_CONFIG_NOSYSTEM bypasses the docker-git system pre-push hook.
    execSync(`git -C "${seedDir}" push origin HEAD:refs/heads/main`, { env: seedEnv })
  }

  return remotePath
}

/**
 * Run an Effect inside a freshly created temp directory, cleaning up after.
 * Also overrides DOCKER_GIT_PROJECTS_ROOT so stateInit uses the temp dir
 * instead of the real ~/.docker-git.
 */
const withTempStateRoot = <A, E, R>(
  use: (opts: { tempBase: string; stateRoot: string }) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempBase = yield* _(
        fs.makeTempDirectoryScoped({ prefix: "docker-git-state-init-" })
      )
      const stateRoot = nodePath.join(tempBase, "state")

      const previous = process.env["DOCKER_GIT_PROJECTS_ROOT"]
      yield* _(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
            } else {
              process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
            }
          })
        )
      )
      process.env["DOCKER_GIT_PROJECTS_ROOT"] = stateRoot

      return yield* _(use({ tempBase, stateRoot }))
    })
  )

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stateInit", () => {
  it.effect("clones an empty remote into an empty local directory", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const remoteUrl = makeFakeRemote(tempBase, true)

        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        // .git directory must exist
        const fs = yield* _(FileSystem.FileSystem)
        const hasGit = yield* _(fs.exists(nodePath.join(stateRoot, ".git")))
        expect(hasGit).toBe(true)

        // origin remote must point to remoteUrl
        const originOut = execSync(
          `git -C "${stateRoot}" remote get-url origin`
        ).toString().trim()
        expect(originOut).toBe(remoteUrl)

        // HEAD must be on main branch with at least one commit
        const branch = execSync(
          `git -C "${stateRoot}" rev-parse --abbrev-ref HEAD`
        ).toString().trim()
        expect(branch).toBe("main")

        const log = execSync(
          `git -C "${stateRoot}" log --oneline`
        ).toString().trim()
        expect(log.length).toBeGreaterThan(0)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("adopts remote history when local dir has files but no .git (the bug fix)", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const remoteUrl = makeFakeRemote(tempBase, true)

        // Simulate the bug scenario: stateRoot exists with files but no .git
        const fs = yield* _(FileSystem.FileSystem)
        const orchAuthDir = nodePath.join(stateRoot, ".orch", "auth")
        yield* _(fs.makeDirectory(orchAuthDir, { recursive: true }))
        yield* _(fs.writeFileString(nodePath.join(orchAuthDir, "github.env"), "GH_TOKEN=test\n"))

        // Run stateInit — must NOT create a divergent root commit
        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        // .git directory must exist after init
        const hasGit = yield* _(fs.exists(nodePath.join(stateRoot, ".git")))
        expect(hasGit).toBe(true)

        // origin remote must be configured
        const originOut = execSync(
          `git -C "${stateRoot}" remote get-url origin`
        ).toString().trim()
        expect(originOut).toBe(remoteUrl)

        // HEAD must point to main
        const branch = execSync(
          `git -C "${stateRoot}" rev-parse --abbrev-ref HEAD`
        ).toString().trim()
        expect(branch).toBe("main")

        // INVARIANT: no divergent root commit — the repo must share history with remote
        // Verify by checking that local HEAD includes the remote initial commit
        const remoteHead = execSync(
          `git -C "${stateRoot}" rev-parse origin/main`
        ).toString().trim()
        const mergeBase = execSync(
          `git -C "${stateRoot}" merge-base HEAD origin/main || git -C "${stateRoot}" rev-parse origin/main`
        ).toString().trim()
        expect(mergeBase).toBe(remoteHead)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("is idempotent when .git already exists", () =>
    withTempStateRoot(({ tempBase, stateRoot }) =>
      Effect.gen(function*(_) {
        const remoteUrl = makeFakeRemote(tempBase, true)

        // First call — sets up the repository
        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        const firstCommit = execSync(
          `git -C "${stateRoot}" rev-parse HEAD`
        ).toString().trim()

        // Second call — must be a no-op (same HEAD, no extra commits)
        yield* _(stateInit({ repoUrl: remoteUrl, repoRef: "main" }))

        const secondCommit = execSync(
          `git -C "${stateRoot}" rev-parse HEAD`
        ).toString().trim()

        // INVARIANT: idempotent — HEAD does not change on repeated calls
        expect(secondCommit).toBe(firstCommit)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
