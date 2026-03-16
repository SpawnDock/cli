import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import { hasFileAtPath } from "./menu-project-auth-helpers.js"

// CHANGE: add Gemini CLI account credentials check for project auth
// WHY: enable Gemini CLI authentication verification at project level
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall accountPath: hasGeminiAccountCredentials(fs, accountPath) = boolean | PlatformError
// PURITY: SHELL
// EFFECT: Effect<boolean, PlatformError>
// INVARIANT: returns true only if valid API key exists
// COMPLEXITY: O(1)

const apiKeyFileName = ".api-key"
const envFileName = ".env"

const hasNonEmptyApiKey = (
  fs: FileSystem.FileSystem,
  apiKeyPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, apiKeyPath))
    if (!hasFile) {
      return false
    }
    const keyValue = yield* _(fs.readFileString(apiKeyPath), Effect.orElseSucceed(() => ""))
    return keyValue.trim().length > 0
  })

const hasApiKeyInEnvFile = (
  fs: FileSystem.FileSystem,
  envFilePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, envFilePath))
    if (!hasFile) {
      return false
    }
    const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
    const lines = envContent.split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith("GEMINI_API_KEY=")) {
        const value = trimmed.slice("GEMINI_API_KEY=".length).replaceAll(/^['"]|['"]$/g, "").trim()
        if (value.length > 0) {
          return true
        }
      }
    }
    return false
  })

export const hasGeminiAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyApiKey(fs, `${accountPath}/${apiKeyFileName}`).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }
      return hasApiKeyInEnvFile(fs, `${accountPath}/${envFileName}`)
    })
  )
