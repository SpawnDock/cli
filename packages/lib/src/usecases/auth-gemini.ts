import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { AuthGeminiLoginCommand, AuthGeminiLogoutCommand, AuthGeminiStatusCommand } from "../core/domain.js"
import { defaultTemplateConfig } from "../core/domain.js"
import type { CommandFailedError } from "../shell/errors.js"
import { isRegularFile, normalizeAccountLabel } from "./auth-helpers.js"
import { migrateLegacyOrchLayout } from "./auth-sync.js"
import { resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"
import { autoSyncState } from "./state-repo.js"

// CHANGE: add Gemini CLI authentication management
// WHY: enable Gemini CLI authentication via API key similar to Claude/Codex
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLogin(cmd) -> api_key_persisted | error
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: API key is stored in isolated account directory
// COMPLEXITY: O(1)

type GeminiRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type GeminiAccountContext = {
  readonly accountLabel: string
  readonly accountPath: string
  readonly cwd: string
  readonly fs: FileSystem.FileSystem
}

export const geminiAuthRoot = ".docker-git/.orch/auth/gemini"

const geminiApiKeyFileName = ".api-key"
const geminiEnvFileName = ".env"

const geminiApiKeyPath = (accountPath: string): string => `${accountPath}/${geminiApiKeyFileName}`
const geminiEnvFilePath = (accountPath: string): string => `${accountPath}/${geminiEnvFileName}`

const ensureGeminiOrchLayout = (
  cwd: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath: defaultTemplateConfig.envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    claudeAuthPath: ".docker-git/.orch/auth/claude",
    geminiAuthPath: ".docker-git/.orch/auth/gemini"
  })

const resolveGeminiAccountPath = (path: Path.Path, rootPath: string, label: string | null): {
  readonly accountLabel: string
  readonly accountPath: string
} => {
  const accountLabel = normalizeAccountLabel(label, "default")
  const accountPath = path.join(rootPath, accountLabel)
  return { accountLabel, accountPath }
}

const withGeminiAuth = <A, E>(
  command: AuthGeminiLoginCommand | AuthGeminiLogoutCommand | AuthGeminiStatusCommand,
  run: (
    context: GeminiAccountContext
  ) => Effect.Effect<A, E, CommandExecutor.CommandExecutor>
): Effect.Effect<A, E | PlatformError | CommandFailedError, GeminiRuntime> =>
  withFsPathContext(({ cwd, fs, path }) =>
    Effect.gen(function*(_) {
      yield* _(ensureGeminiOrchLayout(cwd))
      const rootPath = resolvePathFromCwd(path, cwd, command.geminiAuthPath)
      const { accountLabel, accountPath } = resolveGeminiAccountPath(path, rootPath, command.label)
      yield* _(fs.makeDirectory(accountPath, { recursive: true }))
      return yield* _(run({ accountLabel, accountPath, cwd, fs }))
    })
  )

const readApiKey = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    const apiKeyFilePath = geminiApiKeyPath(accountPath)
    const hasApiKey = yield* _(isRegularFile(fs, apiKeyFilePath))
    if (hasApiKey) {
      const apiKey = yield* _(fs.readFileString(apiKeyFilePath), Effect.orElseSucceed(() => ""))
      const trimmed = apiKey.trim()
      if (trimmed.length > 0) {
        return trimmed
      }
    }

    const envFilePath = geminiEnvFilePath(accountPath)
    const hasEnvFile = yield* _(isRegularFile(fs, envFilePath))
    if (hasEnvFile) {
      const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
      const lines = envContent.split("\n")
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith("GEMINI_API_KEY=")) {
          const value = trimmed.slice("GEMINI_API_KEY=".length).replaceAll(/^['"]|['"]$/g, "").trim()
          if (value.length > 0) {
            return value
          }
        }
      }
    }

    return null
  })

// CHANGE: login to Gemini CLI by storing API key (menu version with direct key)
// WHY: Gemini CLI uses GEMINI_API_KEY environment variable for authentication
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLogin(cmd) -> api_key_file_exists(accountPath)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: API key is stored in .api-key file with 0600 permissions
// COMPLEXITY: O(1)
export const authGeminiLogin = (
  command: AuthGeminiLoginCommand,
  apiKey: string
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> => {
  const accountLabel = normalizeAccountLabel(command.label, "default")
  return withGeminiAuth(command, ({ accountPath, fs }) =>
    Effect.gen(function*(_) {
      const apiKeyFilePath = geminiApiKeyPath(accountPath)
      yield* _(fs.writeFileString(apiKeyFilePath, `${apiKey.trim()}\n`))
      yield* _(fs.chmod(apiKeyFilePath, 0o600), Effect.orElseSucceed(() => void 0))
    })).pipe(
      Effect.zipRight(autoSyncState(`chore(state): auth gemini ${accountLabel}`))
    )
}

// CHANGE: login to Gemini CLI via CLI (prompts user to run web-based setup)
// WHY: CLI-based login requires interactive API key entry
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLoginCli(cmd) -> instruction_shown
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: only shows instructions, does not store credentials
// COMPLEXITY: O(1)
export const authGeminiLoginCli = (
  _command: AuthGeminiLoginCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log("Gemini CLI uses API key authentication."))
    yield* _(Effect.log("To get an API key:"))
    yield* _(Effect.log("  1. Go to https://ai.google.dev/aistudio"))
    yield* _(Effect.log("  2. Create or retrieve your API key"))
    yield* _(Effect.log("  3. Use the menu (docker-git menu) to add your API key"))
    yield* _(Effect.log("  Or set GEMINI_API_KEY environment variable directly."))
  })

// CHANGE: show Gemini CLI auth status for a given label
// WHY: allow verifying API key presence without exposing credentials
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiStatus(cmd) -> connected(cmd) | disconnected(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: never logs API keys
// COMPLEXITY: O(1)
export const authGeminiStatus = (
  command: AuthGeminiStatusCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  withGeminiAuth(command, ({ accountLabel, accountPath, fs }) =>
    Effect.gen(function*(_) {
      const apiKey = yield* _(readApiKey(fs, accountPath))
      if (apiKey === null) {
        yield* _(Effect.log(`Gemini not connected (${accountLabel}).`))
        return
      }
      yield* _(Effect.log(`Gemini connected (${accountLabel}, api-key).`))
    }))

// CHANGE: logout Gemini CLI by clearing API key for a label
// WHY: allow revoking Gemini CLI access deterministically
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd: authGeminiLogout(cmd) -> credentials_cleared(cmd)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | CommandFailedError, GeminiRuntime>
// INVARIANT: all credential files are removed from account directory
// COMPLEXITY: O(1)
export const authGeminiLogout = (
  command: AuthGeminiLogoutCommand
): Effect.Effect<void, PlatformError | CommandFailedError, GeminiRuntime> =>
  Effect.gen(function*(_) {
    const accountLabel = normalizeAccountLabel(command.label, "default")
    yield* _(
      withGeminiAuth(command, ({ accountPath, fs }) =>
        Effect.gen(function*(_) {
          yield* _(fs.remove(geminiApiKeyPath(accountPath), { force: true }))
          yield* _(fs.remove(geminiEnvFilePath(accountPath), { force: true }))
        }))
    )
    yield* _(autoSyncState(`chore(state): auth gemini logout ${accountLabel}`))
  }).pipe(Effect.asVoid)
