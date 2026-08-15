import { useEffect, useState } from 'react'

const TOAST_MS = 10_000

/** 错误提示浮层：错误多是一次性的（同名 session 已存在之类），
 *  常驻横幅会一直占着终端上方，所以到点自动收走，也允许手动关。 */
export function Toast({ message }: { message?: string }) {
  const [visible, setVisible] = useState(false)

  // message 变化才重新显示：自动消失后同一条消息不该被后续渲染重新拉起来
  useEffect(() => {
    if (!message) return
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), TOAST_MS)
    return () => clearTimeout(timer)
  }, [message])

  if (!message || !visible) return null
  return (
    <div className="toast" role="alert">
      <span className="toast-message">{message}</span>
      <button
        className="toast-close"
        type="button"
        aria-label="关闭提示"
        onClick={() => setVisible(false)}
      >
        ×
      </button>
    </div>
  )
}
