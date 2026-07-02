import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../auth/sessions.js'
import { COOKIE_NAME } from '../http/middleware.js'
import type { TmuxExec } from '../tmux/exec.js'
import { createView, destroyView, selectWindow, type View } from '../tmux/view.js'

export interface PtyLike {
  onData(cb: (d: string) => void): void
  onExit(cb: () => void): void
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export type SpawnPty = (file: string, args: string[], cols: number, rows: number) => PtyLike

export interface TerminalDeps {
  exec: TmuxExec
  store: SessionStore
  spawnPty: SpawnPty
  socketName?: string
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const idx = pair.indexOf('=')
      return [pair.slice(0, idx).trim(), pair.slice(idx + 1).trim()]
    }),
  )
}

const resizeSchemaGuard = (v: unknown): v is { cols: number; rows: number } =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as { cols: unknown }).cols) &&
  Number.isInteger((v as { rows: unknown }).rows)

const windowSchemaGuard = (v: unknown): v is { index: number } =>
  typeof v === 'object' && v !== null && Number.isInteger((v as { index: unknown }).index)

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  deps: TerminalDeps,
): Promise<void> {
  const origin = req.headers.origin
  if (origin) {
    let originHost: string | undefined
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = undefined
    }
    if (!originHost || originHost !== req.headers.host) {
      ws.close(4403, 'forbidden origin')
      return
    }
  }

  const cookies = parseCookies(req.headers.cookie)
  const token = cookies[COOKIE_NAME]
  if (!token || !deps.store.isValid(token)) {
    ws.close(4401, 'unauthorized')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  const target = url.searchParams.get('session')
  if (!target) {
    ws.close(4400, 'missing session')
    return
  }
  const windowParam = url.searchParams.get('window')
  if (windowParam !== null && (!Number.isInteger(Number(windowParam)) || Number(windowParam) < 0)) {
    ws.close(4400, 'invalid window')
    return
  }
  const windowIndex = windowParam === null ? undefined : Number(windowParam)

  let view: View
  try {
    view = await createView(deps.exec, target, windowIndex)
  } catch (error) {
    console.error('创建视图失败:', error)
    ws.close(4404, 'session not found')
    return
  }

  const socketArgs = deps.socketName ? ['-L', deps.socketName] : []
  let pty: PtyLike
  try {
    pty = deps.spawnPty('tmux', [...socketArgs, 'attach-session', '-t', view.viewName], 80, 24)
  } catch (error) {
    console.error('spawnPty 失败:', error)
    void destroyView(deps.exec, view.viewName)
    ws.close(4500, 'pty spawn failed')
    return
  }

  pty.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data)
  })
  pty.onExit(() => {
    ws.close(4410, 'pty exited')
    void destroyView(deps.exec, view.viewName)
  })

  ws.on('message', (raw) => {
    const msg = raw.toString()
    const kind = msg[0]
    const rest = msg.slice(1)
    if (kind === 'i') {
      pty.write(rest)
      return
    }
    if (kind === 'r') {
      const parsed = safeJsonParse(rest)
      if (resizeSchemaGuard(parsed) && parsed.cols > 0 && parsed.rows > 0) {
        pty.resize(parsed.cols, parsed.rows)
      }
      return
    }
    if (kind === 'w') {
      const parsed = safeJsonParse(rest)
      if (windowSchemaGuard(parsed) && parsed.index >= 0) {
        selectWindow(deps.exec, view.viewName, parsed.index).catch((error) =>
          console.error('切换 window 失败:', error),
        )
      }
    }
  })

  ws.on('close', () => {
    pty.kill()
    void destroyView(deps.exec, view.viewName)
  })
}
