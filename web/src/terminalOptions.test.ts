import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE } from './appearance'
import { TERMINAL_OPTIONS, terminalOptionsForAppearance } from './terminalOptions'

describe('TERMINAL_OPTIONS', () => {
  it('retains output above the viewport for terminal scrollback', () => {
    expect(TERMINAL_OPTIONS.scrollback).toBe(10_000)
  })

  it('把外观设置转换为 xterm 字体、主题和光标选项', () => {
    const options = terminalOptionsForAppearance({
      ...DEFAULT_APPEARANCE,
      theme: 'dracula',
      font: 'jetbrains-mono',
      fontSize: 18,
      lineHeight: 1.2,
      cursorStyle: 'bar',
    })

    expect(options.fontFamily).toContain('JetBrains Mono')
    expect(options.fontSize).toBe(18)
    expect(options.lineHeight).toBe(1.2)
    expect(options.cursorStyle).toBe('bar')
    expect(options.theme?.background).toBe('#282a36')
  })
})
