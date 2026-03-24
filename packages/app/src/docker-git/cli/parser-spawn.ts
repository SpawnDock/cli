import { Either } from "effect"

import type { Command, ParseError } from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

export const parseSpawn = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), (raw): Either.Either<Command, ParseError> => {
    const token = raw.token
    if (!token || token.trim().length === 0) {
      return Either.left({ _tag: "MissingRequiredOption" as const, option: "--token" })
    }
    return Either.right({
      _tag: "Spawn" as const,
      token: token.trim(),
      outDir: raw.outDir ?? ".spawn-dock/spawndock"
    })
  })
