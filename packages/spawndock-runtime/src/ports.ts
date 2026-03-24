import { createConnection, createServer } from "node:net"

const PORT_CHECK_TIMEOUT_MS = 500
const PORT_READY_TIMEOUT_MS = 30_000
const PORT_READY_POLL_MS = 200
const MAX_PORT_ATTEMPTS = 20

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false)
        return
      }
      reject(error)
    })

    server.listen(port, () => {
      server.close(() => resolve(true))
    })
  })

export const findAvailablePort = async (preferredPort: number): Promise<number> => {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const candidate = preferredPort + offset
    if (await isPortAvailable(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `Could not find a free local port starting from ${preferredPort} after ${MAX_PORT_ATTEMPTS} attempts`,
  )
}

const isPortReachable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port })
    socket.setTimeout(PORT_CHECK_TIMEOUT_MS)

    const finalize = (result: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.once("connect", () => finalize(true))
    socket.once("timeout", () => finalize(false))
    socket.once("error", () => finalize(false))
  })

export const waitForPort = async (
  port: number,
  options: {
    readonly timeoutMs?: number
    readonly pollMs?: number
    readonly isCancelled?: () => boolean
  } = {},
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? PORT_READY_TIMEOUT_MS
  const pollMs = options.pollMs ?? PORT_READY_POLL_MS
  const isCancelled = options.isCancelled ?? (() => false)
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (isCancelled()) {
      throw new Error(`Local dev server exited before port ${port} became ready`)
    }

    if (await isPortReachable(port)) {
      return
    }

    await delay(pollMs)
  }

  throw new Error(`Timed out waiting for local dev server on port ${port}`)
}
