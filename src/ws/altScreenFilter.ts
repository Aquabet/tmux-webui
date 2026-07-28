const PATTERNS = ['\x1b[?1049h', '\x1b[?1049l']
const MAX_PREFIX = Math.max(...PATTERNS.map((p) => p.length)) - 1

// 滤掉 tmux 客户端的 alternate screen 切换序列：tmux attach 会把整个
// xterm 切进 alt buffer，scrollback 因此永远为空（滚轮/触摸都翻不了
// 历史）。让 xterm 始终留在 normal buffer，流式输出自然进 scrollback；
// pane 内的全屏应用由 tmux 自行重绘，不受影响。
export function createAltScreenFilter(): (chunk: string) => string {
  let carry = ''
  return (chunk) => {
    let s = carry + chunk
    carry = ''
    for (const p of PATTERNS) s = s.split(p).join('')
    // 尾部可能是被截断的目标序列前缀：留到下一块再判断
    for (let keep = Math.min(MAX_PREFIX, s.length); keep > 0; keep--) {
      const tail = s.slice(-keep)
      if (PATTERNS.some((p) => p.startsWith(tail))) {
        carry = tail
        s = s.slice(0, -keep)
        break
      }
    }
    return s
  }
}
