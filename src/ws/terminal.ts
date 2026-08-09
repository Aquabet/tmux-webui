import type { IncomingMessage } from 'node:http'
import type { WebSocket } from 'ws'
import type { SessionStore } from '../auth/sessions.js'
import { COOKIE_NAME } from '../http/middleware.js'
import type { TmuxExec } from '../tmux/exec.js'
import { captureHistory } from '../tmux/history.js'
import { createAltScreenFilter } from './altScreenFilter.js'
import { createView, destroyView, selectWindow, type View } from '../tmux/view.js'

const SESSIONS_CHANGED_MESSAGE = '\0tmux-webui:sessions-changed'
export const MAX_WS_MESSAGE_BYTES = 1024 * 1024
export const MAX_PENDING_MESSAGES = 256
const MAX_PENDING_BYTES = 1024 * 1024
export const MAX_WS_BUFFERED_BYTES = 8 * 1024 * 1024

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

export function sendTerminalMessage(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== ws.OPEN) return false
  if (ws.bufferedAmount + Buffer.byteLength(data) > MAX_WS_BUFFERED_BYTES) {
    ws.close(4413, 'client too slow')
    return false
  }
  ws.send(data)
  return true
}

export async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  deps: TerminalDeps,
): Promise<void> {
  let view: View | undefined
  let pty: PtyLike | undefined
  let connectionClosed = false
  let viewDestroyed = false
  let ptyKilled = false

  const cleanup = () => {
    if (pty && !ptyKilled) {
      ptyKilled = true
      pty.kill()
    }
    if (view && !viewDestroyed) {
      viewDestroyed = true
      void destroyView(deps.exec, view.viewName)
    }
  }

  // maxPayload 等协议错误可能在视图异步初始化完成前触发；必须和 message
  // 监听一样同步注册，避免恶意首帧产生未处理的 EventEmitter error。
  ws.on('error', (error) => console.error('WebSocket 连接错误:', error))
  // close 同样可能发生在 createView/captureHistory 的 await 期间。同步监听并
  // 让后续每个阶段复用幂等清理，避免断线后仍启动 PTY 或遗留分组视图。
  ws.on('close', () => {
    connectionClosed = true
    cleanup()
  })
  // 必须在任何 await 之前同步注册 message 监听：ws 是 EventEmitter 语义，
  // emit 时没有监听器的消息会被直接丢弃。视图创建期间到达的帧先缓冲，
  // pty 就绪后按序回放（否则连接后立即发送的 resize/输入帧会丢）。
  let deliver: ((msg: string) => void) | undefined
  const pending: string[] = []
  let pendingBytes = 0
  let aborted = false
  ws.on('message', (raw) => {
    if (aborted) return
    const msg = raw.toString()
    if (deliver) deliver(msg)
    else {
      const bytes = Buffer.byteLength(msg)
      if (pending.length >= MAX_PENDING_MESSAGES || pendingBytes + bytes > MAX_PENDING_BYTES) {
        aborted = true
        pending.length = 0
        pendingBytes = 0
        ws.close(4409, 'pending input limit exceeded')
        return
      }
      pending.push(msg)
      pendingBytes += bytes
    }
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

  let createdView: View
  try {
    createdView = await createView(deps.exec, target, windowIndex)
    view = createdView
  } catch (error) {
    console.error('创建视图失败:', error)
    ws.close(4404, 'session not found')
    return
  }
  if (aborted || connectionClosed || ws.readyState !== ws.OPEN) {
    cleanup()
    return
  }

  // attach 前注入 pane 历史：视图会话全新，xterm 没有 attach 之前的输出，
  // 普通缓冲应用（shell/Codex）翻不了旧内容。先把 tmux 历史写给前端进
  // scrollback，随后 attach 的整屏重绘接在其后，顺序天然无竞争
  try {
    const history = await captureHistory(deps.exec, createdView.viewName)
    if (history) sendTerminalMessage(ws, history)
  } catch (error) {
    console.error('注入 pane 历史失败:', error)
  }
  if (aborted || connectionClosed || ws.readyState !== ws.OPEN) {
    cleanup()
    return
  }

  const socketArgs = deps.socketName ? ['-L', deps.socketName] : []
  let activePty: PtyLike
  try {
    activePty = deps.spawnPty(
      'tmux',
      [...socketArgs, 'attach-session', '-t', createdView.viewName],
      80,
      24,
    )
    pty = activePty
  } catch (error) {
    console.error('spawnPty 失败:', error)
    cleanup()
    ws.close(4500, 'pty spawn failed')
    return
  }

  // 滤掉 tmux 的 alt screen 切换，xterm 留在 normal buffer 积累 scrollback
  const filterAltScreen = createAltScreenFilter()
  let foregroundNotified = false
  activePty.onData((data) => {
    // 第一批 tmux 输出证明 attach 已完成；通知浏览器立即刷新前台状态，
    // 不必等 session 列表的 5 秒轮询。
    if (!foregroundNotified && ws.readyState === ws.OPEN) {
      foregroundNotified = true
      sendTerminalMessage(ws, SESSIONS_CHANGED_MESSAGE)
    }
    const filtered = filterAltScreen(data)
    if (filtered) sendTerminalMessage(ws, filtered)
  })
  activePty.onExit(() => {
    ptyKilled = true
    ws.close(4410, 'pty exited')
    cleanup()
  })

  deliver = (msg) => {
    const kind = msg[0]
    const rest = msg.slice(1)
    if (kind === 'i') {
      activePty.write(rest)
      return
    }
    if (kind === 'r') {
      const parsed = safeJsonParse(rest)
      if (resizeSchemaGuard(parsed) && parsed.cols > 0 && parsed.rows > 0) {
        activePty.resize(parsed.cols, parsed.rows)
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
              await deps.exec([
                'display-message',
                '-p',
                '-t',
                createdView.viewName,
                '#{alternate_on}',
              ])
            ).trim()
            if (current === '0') {
              const history = await captureHistory(
                deps.exec,
                `${createdView.viewName}:${parsed.index}`,
              )
              if (history) sendTerminalMessage(ws, history)
            }
          } catch (error) {
            console.error('注入 window 历史失败:', error)
          }
          await selectWindow(deps.exec, createdView.viewName, parsed.index).catch((error) =>
            console.error('切换 window 失败:', error),
          )
        })()
      }
    }
  }
  for (const msg of pending.splice(0)) deliver(msg)
  pendingBytes = 0
}
