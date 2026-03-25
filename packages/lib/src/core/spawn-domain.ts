// CHANGE: spawn command for one-shot container + bootstrap + agent open
// WHY: keep domain.ts under max-lines; mirrors session-gist-domain split
// REF: spawn-command
// PURITY: CORE

export interface SpawnCommand {
  readonly _tag: "Spawn"
  readonly token: string
  readonly outDir: string
  readonly force: boolean
}
