import { FetchHttpClient, HttpClient } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { parseGithubRepoUrl } from "../core/repo.js"
import { normalizeGitTokenLabel } from "../core/token-labels.js"
import { AuthError } from "../shell/errors.js"
import { findEnvValue, readEnvText } from "./env-file.js"

const githubTokenValidationUrl = "https://api.github.com/user"
const githubTokenValidationWarning = "Unable to validate GitHub token before start; continuing."
export const githubInvalidTokenMessage =
  "GitHub token is invalid. Register GitHub again: docker-git auth github login --web"

const defaultGithubTokenKeys: ReadonlyArray<string> = [
  "GIT_AUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN"
]

const findFirstEnvValue = (input: string, keys: ReadonlyArray<string>): string | null => {
  for (const key of keys) {
    const value = findEnvValue(input, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

const resolvePreferredGithubTokenLabel = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | undefined => {
  const explicit = normalizeGitTokenLabel(config.gitTokenLabel)
  if (explicit !== undefined) {
    return explicit
  }

  const repo = parseGithubRepoUrl(config.repoUrl)
  if (repo === null) {
    return undefined
  }

  return normalizeGitTokenLabel(repo.owner)
}

// CHANGE: resolve the GitHub token that clone will actually use for a repo URL
// WHY: preflight must validate the same labeled/default token selection as the entrypoint
// QUOTE(ТЗ): "ПУсть всегда проверяет токен гитхаба перед запуском"
// REF: user-request-2026-03-19-github-token-preflight
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg,env: resolve(cfg, env) = token_clone(cfg, env) ∨ null
// PURITY: CORE
// INVARIANT: labeled token has priority; falls back to default token keys
// COMPLEXITY: O(k) where k = |token keys|
export const resolveGithubCloneAuthToken = (
  envText: string,
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | null => {
  if (parseGithubRepoUrl(config.repoUrl) === null) {
    return null
  }

  const preferredLabel = resolvePreferredGithubTokenLabel(config)
  if (preferredLabel !== undefined) {
    const labeledKeys = defaultGithubTokenKeys.map((key) => `${key}__${preferredLabel}`)
    const labeledToken = findFirstEnvValue(envText, labeledKeys)
    if (labeledToken !== null) {
      return labeledToken
    }
  }

  return findFirstEnvValue(envText, defaultGithubTokenKeys)
}

type GithubTokenValidationStatus = "valid" | "invalid" | "unknown"

const unknownGithubTokenValidationStatus = (): GithubTokenValidationStatus => "unknown"

const mapGithubTokenValidationStatus = (status: number): GithubTokenValidationStatus => {
  if (status === 401) {
    return "invalid"
  }
  return status >= 200 && status < 300 ? "valid" : "unknown"
}

const validateGithubTokenStatus = (token: string): Effect.Effect<GithubTokenValidationStatus> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(
      client.get(githubTokenValidationUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json"
        }
      })
    )
    return mapGithubTokenValidationStatus(response.status)
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.match({
      onFailure: unknownGithubTokenValidationStatus,
      onSuccess: (status) => status
    })
  )

// CHANGE: validate GitHub auth token before clone/create starts mutating the project
// WHY: dead tokens make git clone fail later with a misleading branch/auth error inside the container
// QUOTE(ТЗ): "Если токен мёртв то пусть пишет что надо зарегистрировать github используй docker-git auth github login --web"
// REF: user-request-2026-03-19-github-token-preflight
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: invalid_token(cfg) → fail_before_start(cfg)
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | PlatformError, FileSystem>
// INVARIANT: only GitHub repo URLs with a configured token are validated
// COMPLEXITY: O(|env|) + O(1) network round-trip
export const validateGithubCloneAuthTokenPreflight = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel" | "envGlobalPath">
): Effect.Effect<void, AuthError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const envText = yield* _(readEnvText(fs, config.envGlobalPath))
    const token = resolveGithubCloneAuthToken(envText, config)

    if (token === null) {
      return
    }

    const status = yield* _(validateGithubTokenStatus(token))
    if (status === "invalid") {
      return yield* _(Effect.fail(new AuthError({ message: githubInvalidTokenMessage })))
    }
    if (status === "unknown") {
      yield* _(Effect.logWarning(githubTokenValidationWarning))
    }
  })
