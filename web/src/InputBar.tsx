import { useEffect, useRef, useState } from 'react'
import { uploadImage } from './api'

interface Props {
  onSend: (data: string) => void
}

// 长按连发的起始延迟与间隔，对齐系统键盘的手感
const REPEAT_DELAY_MS = 400
const REPEAT_INTERVAL_MS = 60

// 移动端输入条：xterm 的隐藏 textarea 对语音/滑动输入法的 composition
// 事件支持不佳（长句只上屏个别字符），原生输入框则完全走系统 IME，
// 整句确认后再发给终端。按键行与输入框分两行，避免手机上过窄。
export function InputBar({ onSend }: Props) {
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const repeatRef = useRef<{ delay?: number; interval?: number }>({})

  // 长按连发：按下先发一次，超过起始延迟后按固定间隔重复，抬手/移出/取消即停。
  // 用 pointer 事件而非 click，抬手才结束的语义 click 表达不了。
  function startRepeat(data: string) {
    stopRepeat()
    onSend(data)
    repeatRef.current.delay = window.setTimeout(() => {
      repeatRef.current.interval = window.setInterval(() => onSend(data), REPEAT_INTERVAL_MS)
    }, REPEAT_DELAY_MS)
  }

  function stopRepeat() {
    window.clearTimeout(repeatRef.current.delay)
    window.clearInterval(repeatRef.current.interval)
    repeatRef.current = {}
  }

  // 卸载时若还按着（切换 window / 断连），定时器不能留下来继续发
  useEffect(() => stopRepeat, [])

  // 上传图片后把服务器路径插进输入框：Claude Code 等 CLI 会读取消息里的图片路径
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const savedPath = await uploadImage(file)
      setText((t) => (t ? `${t} ${savedPath} ` : `${savedPath} `))
      requestAnimationFrame(() => {
        if (taRef.current) autoResize(taRef.current)
      })
    } catch (err) {
      alert(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  // 有内容时只把文字送进终端，不替用户按回车——送进去的文字先落在对端
  // （Claude Code 的输入框、shell 的命令行）里，还能继续改；要提交再点 ⏎。
  // 框为空时回车才等价于给终端按一下回车。
  function send() {
    onSend(text || '\r')
    setText('')
    const ta = taRef.current
    if (ta) ta.style.height = 'auto'
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    send()
  }

  // 随内容自动长高：先归零再取 scrollHeight，删除文字时才能缩回
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <form className="input-bar" onSubmit={submit}>
      <div className="input-keys">
        <button type="button" onClick={() => onSend('\x1b')}>
          Esc
        </button>
        <button type="button" onClick={() => onSend('\t')}>
          Tab
        </button>
        <button type="button" onClick={() => onSend('\x03')}>
          ^C
        </button>
        <button type="button" onClick={() => onSend('\x1b[A')}>
          ↑
        </button>
        <button type="button" onClick={() => onSend('\x1b[B')}>
          ↓
        </button>
        <button type="button" onClick={() => onSend('\r')}>
          ⏎
        </button>
        {/* 退格用 DEL(0x7f)：readline / TUI 普遍按这个字节认退格，而非 BS(0x08)。
            长按连删——手机上逐字点删一句话太痛苦 */}
        <button
          type="button"
          title="退格（可长按连删）"
          onPointerDown={() => startRepeat('\x7f')}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
        >
          ⌫
        </button>
        {/* Shift+Tab（CSI Z）：Claude Code 用它循环切换 mode（plan / auto-accept 等） */}
        <button type="button" title="Shift+Tab 切换 Claude Code mode" onClick={() => onSend('\x1b[Z')}>
          Mode
        </button>
        <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? '⋯' : 'Img'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={onPickFile}
        />
      </div>
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          autoResize(e.target)
        }}
        onKeyDown={onKeyDown}
        placeholder="输入文字，回车送入终端"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="send"
      />
    </form>
  )
}
