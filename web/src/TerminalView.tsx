import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { InputBar } from './InputBar'
import { TERMINAL_OPTIONS } from './terminalOptions'
import { createTouchScroll } from './touchScroll'

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

    const term = new Terminal(TERMINAL_OPTIONS)
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

    // 手机端滑动滚动：应用开启 mouse tracking 时 xterm 忽略 touch，
    // 把滑动合成 WheelEvent 派发回 xterm，走桌面滚轮同一路径。
    // 每行派发一个 WheelEvent：xterm 的 wheel→mouse 上报每个事件只发一次
    // 滚动（幅度被丢弃），快速滑动的大位移必须拆成多个单行事件才滚得动。
    // deltaMode 用 DOM_DELTA_LINE：pixel 模式按设备像素行高换算，高 DPR 下
    // CSS 像素增量不足一行会被 floor 掉。
    const stepPx = Math.ceil(TERMINAL_OPTIONS.fontSize! * 1.2)
    // 合成事件必须带手指真实坐标：mouse tracking 下 wheel 会连同格子坐标
    // 上报给应用，(0,0) 落在内容区外会被按区域处理滚动的 TUI 忽略
    let touchX = 0
    let touchY = 0
    const touchScroll = createTouchScroll((deltaY) => {
      const screen = container.querySelector('.xterm-screen')
      if (!screen) return
      const lines = Math.round(Math.abs(deltaY) / stepPx)
      const dir = deltaY > 0 ? 1 : -1
      for (let i = 0; i < lines; i++) {
        screen.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: dir,
            deltaMode: WheelEvent.DOM_DELTA_LINE,
            clientX: touchX,
            clientY: touchY,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
    }, stepPx)
    // xterm 自己处理过的 touch 会 preventDefault（mouse tracking 关闭时），跳过避免双滚。
    // 我们接手时也立即 preventDefault：浏览器有时在 touchstart 后把手势判给
    // 原生滚动候选，之后一个 touchmove 都不派发（真机日志证实），必须在
    // touchstart 就声明手势归页面处理
    const onTouchStart = (e: TouchEvent) => {
      if (!e.defaultPrevented && e.touches.length === 1) {
        touchX = e.touches[0].clientX
        touchY = e.touches[0].clientY
        touchScroll.start(e.touches[0].clientY)
        e.preventDefault()
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (e.defaultPrevented || e.touches.length !== 1) return
      touchX = e.touches[0].clientX
      touchY = e.touches[0].clientY
      touchScroll.move(e.touches[0].clientY)
      e.preventDefault()
    }
    const onTouchEnd = () => touchScroll.end()
    container.addEventListener('touchstart', onTouchStart, { passive: false })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)

    return () => {
      disposed = true
      cancelAnimationFrame(initialFitFrame)
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
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
