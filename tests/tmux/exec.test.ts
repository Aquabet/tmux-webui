import { describe, expect, it } from 'vitest'
import { createTmuxExec, TmuxError } from '../../src/tmux/exec.js'

describe('createTmuxExec', () => {
  it('对不存在的独立 socket 报 NO_SERVER', async () => {
    const exec = createTmuxExec('webui-exec-test-nonexistent')
    await expect(exec(['list-sessions'])).rejects.toSatisfy(
      (e: unknown) => e instanceof TmuxError && e.code === 'NO_SERVER',
    )
  })

  it('正常命令返回 stdout', async () => {
    const exec = createTmuxExec()
    // -V 不需要 server 运行
    const out = await exec(['-V'])
    expect(out).toMatch(/^tmux /)
  })
})
