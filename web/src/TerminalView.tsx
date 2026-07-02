import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { InputBar } from './InputBar'

const FATAL_CLOSE_CODES = new Set([4400, 4403, 4404, 4500])

interface Props {
  session: string
  windowIndex: number
  onAuthLost?: () => void
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export function TerminalView({ session, windowIndex, onAuthLost }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const winIndexRef = useRef(windowIndex)
  const onAuthLostRef = useRef(onAuthLost)
  onAuthLostRef.current = onAuthLost
  const [status, setStatus] = useState<Status>('connecting')

  // session 变化：重建 xterm + WS
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 重新同步到本次渲染时的 windowIndex，避免与下面的 windowIndex effect 出现执行顺序竞争
    winIndexRef.current = windowIndex

    const term = new Terminal({
      fontSize: 14,
      fontFamily: 'monospace',
      scrollback: 0,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // xterm 默认按 Unicode 6 宽度表把 emoji 算作 1 列，而 tmux（现代 wcwidth）
    // 算 2 列，emoji 之后的内容会整体错位一格；切到 Unicode 11 宽度表对齐两边
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(container)

    const sendSize = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(`r${JSON.stringify({ cols: term.cols, rows: term.rows })}`)
      }
    }
    // 尺寸变化统一从 onResize 事件同步给服务端，fit 的调用方不再各自发帧
    const resizeSub = term.onResize(sendSize)

    // open() 后渲染器要到首帧才完成字符测量，同步 fit 可能是 no-op，
    // 所以在下一帧再 fit 一次，保证初始尺寸不停留在默认 80x24
    fit.fit()
    const initialFitFrame = requestAnimationFrame(() => fit.fit())

    let disposed = false
    let retryDelay = 500

    function connect(winIndex: number) {
      setStatus((s) => (s === 'connected' ? 'reconnecting' : 'connecting'))
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(
        `${proto}://${location.host}/ws/terminal?session=${encodeURIComponent(session)}&window=${winIndex}`,
      )
      wsRef.current = ws
      ws.onopen = () => {
        retryDelay = 500
        setStatus('connected')
        // 连接建立时补发当前尺寸（onResize 只在尺寸变化时触发，覆盖不到这里）
        fit.fit()
        ws.send(`r${JSON.stringify({ cols: term.cols, rows: term.rows })}`)
      }
      ws.onmessage = (ev) => term.write(typeof ev.data === 'string' ? ev.data : '')
      ws.onclose = (ev) => {
        if (disposed) return
        if (ev.code === 4401) {
          setStatus('closed')
          onAuthLostRef.current?.()
          return
        }
        if (FATAL_CLOSE_CODES.has(ev.code)) {
          setStatus('closed')
          return
        }
        setStatus('reconnecting')
        setTimeout(() => {
          if (!disposed) connect(winIndexRef.current)
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 10_000)
      }
    }

    connect(winIndexRef.current)

    const dataSub = term.onData((d) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(`i${d}`)
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(container)

    return () => {
      disposed = true
      cancelAnimationFrame(initialFitFrame)
      observer.disconnect()
      resizeSub.dispose()
      dataSub.dispose()
      wsRef.current?.close()
      term.dispose()
    }
    // windowIndex 故意不在依赖里：切 window 走下面的 effect，不重连
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // windowIndex 变化：只发 w 帧，不重连
  useEffect(() => {
    winIndexRef.current = windowIndex
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(`w${JSON.stringify({ index: windowIndex })}`)
    }
  }, [windowIndex])

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(`i${data}`)
  }, [])

  return (
    <>
      <div className="terminal-wrap">
        {status !== 'connected' && (
          <div className="terminal-status">
            {status === 'connecting' && '连接中…'}
            {status === 'reconnecting' && '连接断开，正在重连…'}
            {status === 'closed' && '连接已关闭（无法建立此终端），请刷新或换一个 session'}
          </div>
        )}
        <div className="term-mount" ref={containerRef} />
      </div>
      <InputBar onSend={sendInput} />
    </>
  )
}
