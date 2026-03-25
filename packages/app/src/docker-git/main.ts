#!/usr/bin/env node

import * as _9 from "@effect/cli"
import * as _1 from "@effect/cluster"
import * as _2 from "@effect/experimental"
import * as _3 from "@effect/printer"
import * as _4 from "@effect/printer-ansi"
import * as _5 from "@effect/rpc"
import * as _6 from "@effect/sql"
import * as _7 from "@effect/typeclass"
import * as _8 from "@effect/workflow"

import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { program } from "./program.js"

export const _dummyDeps = [_1, _2, _3, _4, _5, _6, _7, _8, _9]

// CHANGE: run docker-git CLI through the Node runtime
// WHY: ensure platform services (FS, Path, Command) are available in app CLI
// QUOTE(ТЗ): "CLI (отображение, фронт) это app"
// REF: user-request-2026-01-28-cli-move
// SOURCE: n/a
// FORMAT THEOREM: forall env: runMain(program, env) -> exit
// PURITY: SHELL
// EFFECT: Effect<void, unknown, NodeContext>
// INVARIANT: program runs with NodeContext.layer
// COMPLEXITY: O(n)
const main = Effect.provide(program, NodeContext.layer)

NodeRuntime.runMain(main)
