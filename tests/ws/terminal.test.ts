import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionStore } from '../../src/auth/sessions.js'
import type { TmuxExec } from '../../src/tmux/exec.js'
import {
  handleTerminalConnection,
  MAX_WS_BUFFERED_BYTES,
  MAX_WS_MESSAGE_BYTES,
  MAX_PENDING_MESSAGES,
  sendTerminalMessage,
  type PtyLike,
  type SpawnPty,
  type TerminalDeps,
} from '../../src/ws/terminal.js'

interface FakePty extends PtyLike {
  written: string[]
  resizes: Array<[number, number]>
  killed: boolean
  emitData(d: string): void
  emitExit(): void
}

function makeFakePty(): FakePty {
  let dataCb: ((d: string) => void) | undefined
  let exitCb: (() => void) | undefined
  const pty: FakePty = {
    written: [],
    resizes: [],
    killed: false,
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: (d) => pty.written.push(d),
    resize: (c, r) => pty.resizes.push([c, r]),
    kill: () => {
      pty.killed = true
    },
    emitData: (d) => dataCb?.(d),
    emitExit: () => exitCb?.(),
  }
  return pty
}

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

async function startServer(deps: TerminalDeps): Promise<number> {
  server = createServer()
  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, req, deps)
    })
  })
  const activeServer = server
  await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

function makeDeps(pty: FakePty) {
  const store = createSessionStore(60_000)
  const token = store.create()
  const execCalls: string[][] = []
  const exec: TmuxExec = async (args) => {
    execCalls.push(args)
    return ''
  }
  const spawnPty: SpawnPty = () => pty
  const deps: TerminalDeps = { exec, store, spawnPty }
  return { deps, token, execCalls }
}

function connect(port: number, token: string | undefined, query: string) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?${query}`, {
    headers: token ? { cookie: `webui_token=${token}` } : {},
  })
}

function waitClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on('close', (code) => resolve(code)))
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
}

const flush = () => new Promise((r) => setTimeout(r, 50))

describe('handleTerminalConnection', () => {
  it('慢客户端超过输出缓冲上限时关闭连接', () => {
    const send = vi.fn()
    const close = vi.fn()
    const ws = {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: MAX_WS_BUFFERED_BYTES,
      send,
      close,
    } as unknown as WebSocket

    expect(sendTerminalMessage(ws, 'x')).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith(4413, 'client too slow')
  })

  it('无认证 cookie 时以 4401 关闭', async () => {
    const { deps } = makeDeps(makeFakePty())
    const port = await startServer(deps)
    const code = await waitClose(connect(port, undefined, 'session=demo'))
    expect(code).toBe(4401)
  })

  it('缺 session 参数时以 4400 关闭', async () => {
    const { deps, token } = makeDeps(makeFakePty())
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, ''))
    expect(code).toBe(4400)
  })

  it('createView 失败时以 4404 关闭', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    deps.exec = async () => {
      throw new Error("can't find session")
    }
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, 'session=nope'))
    expect(code).toBe(4404)
  })

  it('pty 输出转发到客户端；i 帧写入 pty；r 帧 resize；w 帧调 select-window', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo&window=1')
    await waitOpen(ws)
    await flush()

    const received: string[] = []
    ws.on('message', (d) => received.push(d.toString()))
    pty.emitData('hello from tmux')
    pty.emitData('second frame')
    ws.send('iecho hi\r')
    ws.send('r{"cols":120,"rows":40}')
    ws.send('w{"index":2}')
    await flush()

    expect(received).toEqual(['\0tmux-webui:sessions-changed', 'hello from tmux', 'second frame'])
    expect(pty.written).toEqual(['echo hi\r'])
    expect(pty.resizes).toEqual([[120, 40]])
    const selectCalls = execCalls.filter((c) => c[0] === 'select-window')
    // 一次来自 createView 的 window=1，一次来自 w 帧的 index=2
    expect(selectCalls).toHaveLength(2)
    expect(selectCalls[1][2]).toMatch(/^webui-[0-9a-f]{8}:2$/)
    ws.close()
    await flush()
  })

  it('客户端断开时 kill pty 并销毁视图', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    await flush()
    ws.close()
    await flush()
    expect(pty.killed).toBe(true)
    expect(execCalls.some((c) => c[0] === 'kill-session')).toBe(true)
  })

  it('pty 退出时以 4410 关闭客户端', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    const closed = waitClose(ws)
    await waitOpen(ws)
    await flush()
    pty.emitExit()
    expect(await closed).toBe(4410)
  })

  it('非法 JSON 控制帧不导致崩溃', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    await flush()
    ws.send('r{bad json')
    ws.send('x未知前缀')
    await flush()
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('跨站 Origin 时以 4403 关闭', async () => {
    const { deps, token } = makeDeps(makeFakePty())
    const port = await startServer(deps)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?session=demo`, {
      headers: { cookie: `webui_token=${token}`, origin: 'https://evil.example.com' },
    })
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)))
    expect(code).toBe(4403)
  })

  it('同源 Origin 正常通过', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?session=demo`, {
      headers: { cookie: `webui_token=${token}`, origin: `http://127.0.0.1:${port}` },
    })
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })
    ws.close()
  })

  it('window 参数非法时以 4400 关闭且不创建视图', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, 'session=demo&window=abc'))
    expect(code).toBe(4400)
    expect(execCalls.filter((c) => c[0] === 'new-session')).toHaveLength(0)
  })

  it('spawnPty 抛错时以 4500 关闭并销毁已创建的视图', async () => {
    const { deps, token, execCalls } = makeDeps(makeFakePty())
    deps.spawnPty = () => {
      throw new Error('pty spawn failed')
    }
    const port = await startServer(deps)
    const code = await waitClose(connect(port, token, 'session=demo'))
    expect(code).toBe(4500)
    await flush()
    expect(execCalls.some((c) => c[0] === 'kill-session')).toBe(true)
  })

  it('连接建立后立即发送的帧不丢失（视图创建期间需缓冲）', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const innerExec = deps.exec
    // 拖慢 createView，模拟真实 tmux exec 耗时，凸显消息早于 handler 注册到达的窗口
    deps.exec = async (args) => {
      await new Promise((r) => setTimeout(r, 100))
      return innerExec(args)
    }
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    ws.send('r{"cols":95,"rows":35}')
    ws.send('iecho early\r')
    // 每次 exec 被拖慢 100ms，createView 现在是 4 次调用（含查询目标工作目录）
    await new Promise((r) => setTimeout(r, 700))
    expect(pty.resizes).toEqual([[95, 35]])
    expect(pty.written).toEqual(['echo early\r'])
    ws.close()
    await flush()
  })

  it('PTY 初始化前排队帧超过上限时关闭连接并清理视图', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const innerExec = deps.exec
    deps.exec = async (args) => {
      await new Promise((r) => setTimeout(r, 100))
      return innerExec(args)
    }
    const ws = connect(await startServer(deps), token, 'session=demo')
    const closed = waitClose(ws)
    await waitOpen(ws)
    for (let i = 0; i <= MAX_PENDING_MESSAGES; i++) ws.send('ix')
    expect(await closed).toBe(4409)
    await new Promise((r) => setTimeout(r, 700))
    expect(pty.written).toEqual([])
    expect(execCalls.some((c) => c[0] === 'kill-session')).toBe(true)
  })

  it('PTY 初始化前排队内容超过字节上限时关闭连接', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const innerExec = deps.exec
    deps.exec = async (args) => {
      await new Promise((r) => setTimeout(r, 100))
      return innerExec(args)
    }
    const ws = connect(await startServer(deps), token, 'session=demo')
    const closed = waitClose(ws)
    await waitOpen(ws)
    // 前缀 i 也计入队列字节数，因此单帧即可单独触发字节上限而非消息数上限。
    ws.send(`i${'x'.repeat(MAX_WS_MESSAGE_BYTES)}`)

    expect(await closed).toBe(4409)
    expect(pty.written).toEqual([])
  })

  it('读取历史期间断开时不启动 PTY，并销毁已创建视图', async () => {
    const pty = makeFakePty()
    const { deps, token, execCalls } = makeDeps(pty)
    const innerExec = deps.exec
    let releaseHistory: () => void = () => undefined
    const historyBlocked = new Promise<void>((resolve) => {
      releaseHistory = resolve
    })
    let markHistoryStarted: () => void = () => undefined
    const historyStarted = new Promise<void>((resolve) => {
      markHistoryStarted = resolve
    })
    deps.exec = async (args) => {
      if (args[0] === 'display-message' && args.at(-1) === '#{alternate_on} #{history_size}') {
        markHistoryStarted()
        await historyBlocked
        return '0 0'
      }
      return innerExec(args)
    }
    let spawnCalls = 0
    deps.spawnPty = () => {
      spawnCalls += 1
      return pty
    }

    const ws = connect(await startServer(deps), token, 'session=demo')
    await waitOpen(ws)
    await historyStarted
    const closed = waitClose(ws)
    ws.close()
    await closed
    releaseHistory()
    await flush()

    expect(spawnCalls).toBe(0)
    expect(execCalls.some((c) => c[0] === 'kill-session')).toBe(true)
  })

  it('ws error 事件不会抛出未捕获异常', async () => {
    const pty = makeFakePty()
    const { deps, token } = makeDeps(pty)
    const port = await startServer(deps)
    const ws = connect(port, token, 'session=demo')
    await waitOpen(ws)
    await flush()
    // 强制底层 socket 异常断开，触发服务端 ws 的 error/close 路径
    ws.terminate()
    await flush()
    // 若服务端因未监听 error 崩溃，本测试进程会随之失败；活到这里即通过
    expect(pty.killed).toBe(true)
  })
})
