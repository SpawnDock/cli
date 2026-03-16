import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { git, gitBaseEnv, gitExitCode, successExitCode } from "./git-commands.js"

// CHANGE: align local history with remote when histories have no common ancestor
// WHY: prevents creation of new branches when local repo was git-init'd without cloning (divergent root commits)
// QUOTE(ТЗ): "у нас должна быть единая система облака в виде .docker-git. Новая ветка открывается только тогда когда не возможно исправить конфликт и сделать push в main"
// REF: issue-141
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: soft-resets only when merge-base finds no common ancestor; idempotent when histories are already related
// COMPLEXITY: O(1) git operations
export const adoptRemoteHistoryIfOrphan = (
  root: string,
  repoRef: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    // Fetch remote history first — required for merge-base and reset
    const fetchExit = yield* _(gitExitCode(root, ["fetch", "origin", repoRef], gitBaseEnv))
    if (fetchExit !== successExitCode) {
      yield* _(Effect.logWarning(`git fetch origin ${repoRef} failed (exit ${fetchExit}); starting fresh history`))
      return
    }
    const remoteRef = `origin/${repoRef}`
    const hasRemoteExit = yield* _(
      gitExitCode(root, ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`], gitBaseEnv)
    )
    if (hasRemoteExit !== successExitCode) {
      return // Remote branch does not exist yet (brand-new repo)
    }

    // Case 1: orphan branch (no local commits at all)
    const revParseExit = yield* _(gitExitCode(root, ["rev-parse", "HEAD"], gitBaseEnv))
    if (revParseExit !== successExitCode) {
      yield* _(git(root, ["reset", "--soft", remoteRef], gitBaseEnv))
      yield* _(Effect.log(`Adopted remote history from ${remoteRef}`))
      return
    }

    // Case 2: local commits exist but histories share no common ancestor
    // (e.g. git-init without cloning produced a divergent root commit)
    const mergeBaseExit = yield* _(gitExitCode(root, ["merge-base", "HEAD", remoteRef], gitBaseEnv))
    if (mergeBaseExit === successExitCode) {
      return // Histories are related — normal rebase in stateSync will handle it
    }

    // Merge unrelated histories so both are preserved; abort on conflict — stateSync will open a PR
    yield* _(Effect.logWarning(`Local history has no common ancestor with ${remoteRef}; merging unrelated histories`))
    const mergeExit = yield* _(
      gitExitCode(root, ["merge", "--allow-unrelated-histories", "--no-edit", remoteRef], gitBaseEnv)
    )
    if (mergeExit === successExitCode) {
      yield* _(Effect.log(`Merged unrelated histories from ${remoteRef}`))
      return
    }
    // Conflict — abort and leave resolution to stateSync (which will push a branch and log a PR URL)
    yield* _(gitExitCode(root, ["merge", "--abort"], gitBaseEnv))
    yield* _(Effect.logWarning(`Merge conflict with ${remoteRef}; sync will open a PR for manual resolution`))
  })
