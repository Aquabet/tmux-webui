import { describe, expect, it } from 'vitest'
import { HELP_TEXT, parseArgs } from '../src/cli.js'

describe('parseArgs', () => {
  it('无参数时启动服务', () => {
    expect(parseArgs([])).toEqual({ kind: 'serve' })
  })

  it('识别 init 子命令', () => {
    expect(parseArgs(['init'])).toEqual({ kind: 'init' })
  })

  it('识别 help / version 的长短写法', () => {
    for (const arg of ['help', '--help', '-h']) {
      expect(parseArgs([arg])).toEqual({ kind: 'help' })
    }
    for (const arg of ['version', '--version', '-v']) {
      expect(parseArgs([arg])).toEqual({ kind: 'version' })
    }
  })

  it('未知参数不当成 serve 静默吞掉', () => {
    expect(parseArgs(['strat'])).toEqual({ kind: 'unknown', arg: 'strat' })
    expect(parseArgs(['--port=1'])).toEqual({ kind: 'unknown', arg: '--port=1' })
  })

  it('帮助文本列出所有子命令', () => {
    expect(HELP_TEXT).toMatch(/init/)
    expect(HELP_TEXT).toMatch(/TMUX_WEBUI_/)
  })
})
