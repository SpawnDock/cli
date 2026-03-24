import { Either } from "effect"

import type { Command, ParseError, SpawnCommand } from "@effect-template/lib/core/domain"

import { parseRawOptions } from "./parser-options.js"

// CHANGE: parse spawn command from CLI args into a typed SpawnCommand
// WHY: validate --token presence before any effects run
// REF: spawn-command
// FORMAT THEOREM: forall argv: parseSpawn(argv) = cmd -> deterministic(cmd)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns MissingRequiredOption when --token is absent or blank
// COMPLEXITY: O(n) where n = |args|
export const parseSpawn = (args: ReadonlyArray<string>): Either.Either<Command, ParseError> =>
  Either.flatMap(parseRawOptions(args), (raw): Either.Either<Command, ParseError> => {
    const token = raw.token
    if (!token || token.trim().length === 0) {
      const missingToken: ParseError = { _tag: "MissingRequiredOption", option: "--token" }
      return Either.left(missingToken)
    }
    const spawnCmd: SpawnCommand = {
      _tag: "Spawn",
      token: token.trim(),
      outDir: raw.outDir ?? ".spawn-dock/spawndock"
    }
    return Either.right(spawnCmd)
  })
