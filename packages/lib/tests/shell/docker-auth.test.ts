import { describe, expect, it } from "@effect/vitest"

import { remapDockerBindHostPathFromMounts } from "../../src/shell/docker-auth.js"

describe("remapDockerBindHostPathFromMounts", () => {
  it("maps nested bind paths through the current container mount source", () => {
    const next = remapDockerBindHostPathFromMounts("/home/dev/.docker-git/.orch/auth/claude/default", [
      {
        source: "/home/user/.docker-git",
        destination: "/home/dev/.docker-git"
      }
    ])

    expect(next).toBe("/home/user/.docker-git/.orch/auth/claude/default")
  })

  it("prefers the longest matching destination prefix", () => {
    const next = remapDockerBindHostPathFromMounts("/home/dev/.docker-git/spawndock/repo/.orch/auth/gh", [
      {
        source: "/home/user/.docker-git",
        destination: "/home/dev/.docker-git"
      },
      {
        source: "/srv/docker-git/spawndock/repo",
        destination: "/home/dev/.docker-git/spawndock/repo"
      }
    ])

    expect(next).toBe("/srv/docker-git/spawndock/repo/.orch/auth/gh")
  })

  it("keeps the original path when no mount matches", () => {
    const hostPath = "/tmp/docker-git-auth"

    expect(remapDockerBindHostPathFromMounts(hostPath, [])).toBe(hostPath)
  })
})
