import { describe, expect, it } from 'vitest'
import type { TmuxExec } from '../../src/tmux/exec.js'
import { captureHistory } from '../../src/tmux/history.js'

function makeExec(
  alt: string,
  historySize: string,
  captured: string,
): { exec: TmuxExec; calls: string[][] } {
  const calls: string[][] = []
  const exec: TmuxExec = async (args) => {
    calls.push(args)
    if (args[0] === 'display-message') return `${alt} ${historySize}\n`
    if (args[0] === 'capture-pane') return captured
    throw new Error(`unexpected: ${args[0]}`)
  }
  return { exec, calls }
}

describe('captureHistory', () => {
  it('导出历史并把 \\n 转成 \\r\\n，结尾重置颜色', async () => {
    const { exec, calls } = makeExec('0', '78', 'line1\nline2\n')
    const out = await captureHistory(exec, 'webui-x:1')
    expect(out).toBe('line1\r\nline2\r\n\x1b[0m')
    const capture = calls.find((c) => c[0] === 'capture-pane')
    if (!capture) throw new Error('capture-pane was not called')
    expect(capture).toContain('-e')
    expect(capture).toContain('webui-x:1')
  })

  it('alternate screen 中返回空（全屏 TUI 自带滚动）', async () => {
    const { exec, calls } = makeExec('1', '78', 'x\n')
    expect(await captureHistory(exec, 't')).toBe('')
    expect(calls.some((c) => c[0] === 'capture-pane')).toBe(false)
  })

  it('无历史返回空（避免重复回显可视区首行）', async () => {
    const { exec, calls } = makeExec('0', '0', '')
    expect(await captureHistory(exec, 't')).toBe('')
    expect(calls.some((c) => c[0] === 'capture-pane')).toBe(false)
  })

  it('历史全空白返回空', async () => {
    const { exec } = makeExec('0', '5', '\n\n')
    expect(await captureHistory(exec, 't')).toBe('')
  })
})
