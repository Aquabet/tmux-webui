import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { InputBar } from './InputBar'
import type { AppearanceSettings } from './appearance'
import { terminalOptionsForAppearance } from './terminalOptions'
import { createTouchScroll } from './touchScroll'

const FATAL_CLOSE_CODES = new Set([4400, 4403, 4404, 4500])
const SESSIONS_CHANGED_MESSAGE = '\0tmux-webui:sessions-changed'

interface Props {
  session: string
  windowIndex: number
  appearance: AppearanceSettings
  onAuthLost?: () => void
  onForegroundChange?: () => void
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export function TerminalView({
  session,
  windowIndex,
  appearance,
  onAuthLost,
  onForegroundChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | undefined>(undefined)
  const termRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const winIndexRef = useRef(windowIndex)
  const appearanceRef = useRef(appearance)
  appearanceRef.current = appearance
  const touchStepRef = useRef(Math.ceil(appearance.fontSize * appearance.lineHeight * 1.2))
  const onAuthLostRef = useRef(onAuthLost)
  onAuthLostRef.current = onAuthLost
  const onForegroundChangeRef = useRef(onForegroundChange)
  onForegroundChangeRef.current = onForegroundChange
  const [status, setStatus] = useState<Status>('connecting')

  // 先同步 ref，再让 session effect 建立连接；切 window 只发 w 帧，不重连。
  useEffect(() => {
    winIndexRef.current = windowIndex
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(`w${JSON.stringify({ index: windowIndex })}`)
    }
  }, [windowIndex])

  // session 变化：重建 xterm + WS；外观设置在下面单独热更新，避免拖字号时反复重连。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal(terminalOptionsForAppearance(appearanceRef.current))
    const fit = new FitAddon()
    termRef.current = term
    fitRef.current = fit
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
      ws.onmessage = (ev) => {
        if (ev.data === SESSIONS_CHANGED_MESSAGE) {
          onForegroundChangeRef.current?.()
          return
        }
        term.write(typeof ev.data === 'string' ? ev.data : '')
      }
      ws.onclose = (ev) => {
        onForegroundChangeRef.current?.()
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
    // 合成事件必须带手指真实坐标：mouse tracking 下 wheel 会连同格子坐标
    // 上报给应用，(0,0) 落在内容区外会被按区域处理滚动的 TUI 忽略
    let touchX = 0
    let touchY = 0
    const emitLines = (deltaY: number) => {
      const screen = container.querySelector('.xterm-screen')
      if (!screen) return
      const lines = Math.round(Math.abs(deltaY) / touchStepRef.current)
      const dir = deltaY > 0 ? 1 : -1
      // 应用开了 mouse tracking：绕开 xterm 的 wheel→mouse 管线（内部
      // 活跃态/坐标换算时机不可控，真机上会随机吞事件），自己算格子坐标
      // 直接把 SGR 滚动序列写进 WS —— 和桌面滚轮到达应用的字节完全一致
      if (term.modes.mouseTrackingMode !== 'none') {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return
        const rect = screen.getBoundingClientRect()
        const clamp = (v: number, max: number) => Math.min(Math.max(v, 1), max)
        const col = clamp(Math.ceil((touchX - rect.left) / (rect.width / term.cols)), term.cols)
        const row = clamp(Math.ceil((touchY - rect.top) / (rect.height / term.rows)), term.rows)
        const btn = dir > 0 ? 65 : 64
        for (let i = 0; i < lines; i++) {
          wsRef.current.send(`i\x1b[<${btn};${col};${row}M`)
        }
        return
      }
      // 未开 mouse tracking（普通 shell）：直接滚 xterm 视口看 scrollback。
      // 绝不在 touch 处理期间派发合成 DOM 事件——同步合成 WheelEvent 会
      // 打断 Chrome 后续的 touchmove 派发（滑一两行就断流的根因）
      term.scrollLines(dir * lines)
    }
    const touchScroll = createTouchScroll(emitLines, () => touchStepRef.current)

    // 惯性滚动：抬手后按末速度衰减继续滚，接近原生滚动手感
    let flingFrame = 0
    const startFling = (v0: number) => {
      let v = v0
      let acc = 0
      let last = performance.now()
      const tick = (now: number) => {
        acc += v * (now - last)
        v *= 0.95 ** ((now - last) / 16)
        last = now
        if (Math.abs(acc) >= touchStepRef.current) {
          emitLines(acc)
          acc = acc % touchStepRef.current
        }
        if (Math.abs(v) > 0.05) flingFrame = requestAnimationFrame(tick)
      }
      flingFrame = requestAnimationFrame(tick)
    }
    // 手势用 Pointer Events + setPointerCapture：Touch Events 会参与浏览器
    // 滚动手势仲裁，实测（真机 + CDP 复现）中途会随机停发 touchmove；
    // pointer capture 明确宣示手势归属，事件持续派发
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      cancelAnimationFrame(flingFrame)
      container.setPointerCapture(e.pointerId)
      touchX = e.clientX
      touchY = e.clientY
      touchScroll.start(e.clientY)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      touchX = e.clientX
      touchY = e.clientY
      touchScroll.move(e.clientY)
    }
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return
      const v = touchScroll.end()
      if (Math.abs(v) > 0.2) startFling(v)
    }
    // touch 事件在 capture 阶段整体拦截：既阻止浏览器原生滚动/选择，也让
    // xterm 的 touch 处理彻底失效（滚动统一走上面的 pointer 手势），避免双滚
    const blockTouch = (e: TouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', onPointerEnd)
    container.addEventListener('pointercancel', onPointerEnd)
    container.addEventListener('touchstart', blockTouch, { capture: true, passive: false })
    container.addEventListener('touchmove', blockTouch, { capture: true, passive: false })

    return () => {
      disposed = true
      cancelAnimationFrame(initialFitFrame)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerEnd)
      container.removeEventListener('pointercancel', onPointerEnd)
      container.removeEventListener('touchstart', blockTouch, { capture: true })
      container.removeEventListener('touchmove', blockTouch, { capture: true })
      cancelAnimationFrame(flingFrame)
      observer.disconnect()
      resizeSub.dispose()
      dataSub.dispose()
      wsRef.current?.close()
      termRef.current = undefined
      fitRef.current = undefined
      term.dispose()
    }
  }, [session])

  useEffect(() => {
    touchStepRef.current = Math.ceil(appearance.fontSize * appearance.lineHeight * 1.2)
    const term = termRef.current
    if (!term) return
    const options = terminalOptionsForAppearance(appearance)
    term.options.fontFamily = options.fontFamily
    term.options.fontSize = options.fontSize
    term.options.lineHeight = options.lineHeight
    term.options.cursorStyle = options.cursorStyle
    term.options.theme = options.theme
    const fitFrame = requestAnimationFrame(() => fitRef.current?.fit())
    return () => cancelAnimationFrame(fitFrame)
  }, [appearance])

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
