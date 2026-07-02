import { useState } from 'react'

interface Props {
  onSend: (data: string) => void
}

// 移动端输入条：xterm 的隐藏 textarea 对语音/滑动输入法的 composition
// 事件支持不佳（长句只上屏个别字符），原生 input 则完全走系统 IME，
// 整句确认后再发给终端
export function InputBar({ onSend }: Props) {
  const [text, setText] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSend(`${text}\r`)
    setText('')
  }

  return (
    <form className="input-bar" onSubmit={submit}>
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
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入命令，回车发送"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="send"
      />
    </form>
  )
}
