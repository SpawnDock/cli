import { Effect, Match, pipe } from "effect"

import {
  authClaudeLogin,
  authClaudeLogout,
  authGeminiLogin,
  authGeminiLogout,
  authGithubLogin,
  claudeAuthRoot,
  geminiAuthRoot
} from "@effect-template/lib/usecases/auth"
import type { AppError } from "@effect-template/lib/usecases/errors"
import { renderError } from "@effect-template/lib/usecases/errors"

import { readAuthSnapshot, successMessage, writeAuthFlow } from "./menu-auth-data.js"
import { pauseOnError, resumeSshWithSkipInputs, withSuspendedTui } from "./menu-shared.js"
import type { AuthSnapshot, MenuEnv, MenuViewContext, ViewState } from "./menu-types.js"

type AuthPromptView = Extract<ViewState, { readonly _tag: "AuthPrompt" }>

type AuthEffectContext = MenuViewContext & {
  readonly runner: { readonly runEffect: (effect: Effect.Effect<void, AppError, MenuEnv>) => void }
  readonly setSshActive: (active: boolean) => void
  readonly setSkipInputs: (update: (value: number) => number) => void
  readonly cwd: string
}

const resolveLabelOption = (values: Readonly<Record<string, string>>): string | null => {
  const labelValue = (values["label"] ?? "").trim()
  return labelValue.length > 0 ? labelValue : null
}

export const resolveAuthPromptEffect = (
  view: AuthPromptView,
  cwd: string,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> => {
  const labelOption = resolveLabelOption(values)
  return Match.value(view.flow).pipe(
    Match.when("GithubOauth", () =>
      authGithubLogin({
        _tag: "AuthGithubLogin",
        label: labelOption,
        token: null,
        scopes: null,
        envGlobalPath: view.snapshot.globalEnvPath
      })),
    Match.when("ClaudeOauth", () =>
      authClaudeLogin({
        _tag: "AuthClaudeLogin",
        label: labelOption,
        claudeAuthPath: claudeAuthRoot
      })),
    Match.when("ClaudeLogout", () =>
      authClaudeLogout({
        _tag: "AuthClaudeLogout",
        label: labelOption,
        claudeAuthPath: claudeAuthRoot
      })),
    Match.when("GeminiApiKey", () => {
      const apiKey = (values["apiKey"] ?? "").trim()
      return authGeminiLogin({
        _tag: "AuthGeminiLogin",
        label: labelOption,
        geminiAuthPath: geminiAuthRoot
      }, apiKey)
    }),
    Match.when("GeminiLogout", () =>
      authGeminiLogout({
        _tag: "AuthGeminiLogout",
        label: labelOption,
        geminiAuthPath: geminiAuthRoot
      })),
    Match.when("GithubRemove", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GitSet", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.when("GitRemove", (flow) => writeAuthFlow(cwd, flow, values)),
    Match.exhaustive
  )
}

export const startAuthMenuWithSnapshot = (
  snapshot: AuthSnapshot,
  context: Pick<MenuViewContext, "setView" | "setMessage">
): void => {
  context.setView({ _tag: "AuthMenu", selected: 0, snapshot })
  context.setMessage(null)
}

export const runAuthPromptEffect = (
  effect: Effect.Effect<void, AppError, MenuEnv>,
  view: AuthPromptView,
  label: string,
  context: AuthEffectContext,
  options: { readonly suspendTui: boolean }
): void => {
  const withOptionalSuspension = options.suspendTui
    ? withSuspendedTui(effect, {
      onError: pauseOnError(renderError),
      onResume: resumeSshWithSkipInputs(context)
    })
    : effect

  context.setSshActive(options.suspendTui)
  context.runner.runEffect(
    pipe(
      withOptionalSuspension,
      Effect.zipRight(readAuthSnapshot(context.cwd)),
      Effect.tap((snapshot) =>
        Effect.sync(() => {
          startAuthMenuWithSnapshot(snapshot, context)
          context.setMessage(successMessage(view.flow, label))
        })
      ),
      Effect.asVoid
    )
  )
}
