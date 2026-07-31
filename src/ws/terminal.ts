import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../auth/sessions.js'
import { COOKIE_NAME } from '../http/middleware.js'
import type { TmuxExec } from '../tmux/exec.js'
import { captureHistory } from '../tmux/history.js'
import { createAltScreenFilter } from './altScreenFilter.js'
import { createView, destroyView, selectWindow, type View } from '../tmux/view.js'

const SESSIONS_CHANGED_MESSAGE = '\0tmux-webui:sessions-changed'

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
  // 必须在任何 await 之前同步注册 message 监听：ws 是 EventEmitter 语义，
  // emit 时没有监听器的消息会被直接丢弃。视图创建期间到达的帧先缓冲，
  // pty 就绪后按序回放（否则连接后立即发送的 resize/输入帧会丢）。
  let deliver: ((msg: string) => void) | undefined
  const pending: string[] = []
  ws.on('message', (raw) => {
    const msg = raw.toString()
    if (deliver) deliver(msg)
    else pending.push(msg)
  })

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

  // attach 前注入 pane 历史：视图会话全新，xterm 没有 attach 之前的输出，
  // 普通缓冲应用（shell/Codex）翻不了旧内容。先把 tmux 历史写给前端进
  // scrollback，随后 attach 的整屏重绘接在其后，顺序天然无竞争
  try {
    const history = await captureHistory(deps.exec, view.viewName)
    if (history && ws.readyState === ws.OPEN) ws.send(history)
  } catch (error) {
    console.error('注入 pane 历史失败:', error)
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

  // 滤掉 tmux 的 alt screen 切换，xterm 留在 normal buffer 积累 scrollback
  const filterAltScreen = createAltScreenFilter()
  let foregroundNotified = false
  pty.onData((data) => {
    // 第一批 tmux 输出证明 attach 已完成；通知浏览器立即刷新前台状态，
    // 不必等 session 列表的 5 秒轮询。
    if (!foregroundNotified && ws.readyState === ws.OPEN) {
      foregroundNotified = true
      ws.send(SESSIONS_CHANGED_MESSAGE)
    }
    const filtered = filterAltScreen(data)
    if (filtered && ws.readyState === ws.OPEN) ws.send(filtered)
  })
  pty.onExit(() => {
    ws.close(4410, 'pty exited')
    void destroyView(deps.exec, view.viewName)
  })

  deliver = (msg) => {
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
        void (async () => {
          // 目标 window 的历史也在切换前注入。前提：当前 pane 不在
          // alternate screen（否则这些字节会写进即将被丢弃的 alt 缓冲）
          try {
            const current = (
              await deps.exec(['display-message', '-p', '-t', view.viewName, '#{alternate_on}'])
            ).trim()
            if (current === '0') {
              const history = await captureHistory(
                deps.exec,
                `${view.viewName}:${parsed.index}`,
              )
              if (history && ws.readyState === ws.OPEN) ws.send(history)
            }
          } catch (error) {
            console.error('注入 window 历史失败:', error)
          }
          await selectWindow(deps.exec, view.viewName, parsed.index).catch((error) =>
            console.error('切换 window 失败:', error),
          )
        })()
      }
    }
  }
  for (const msg of pending.splice(0)) deliver(msg)

  ws.on('close', () => {
    pty.kill()
    void destroyView(deps.exec, view.viewName)
  })

  ws.on('error', (error) => console.error('WebSocket 连接错误:', error))
}
