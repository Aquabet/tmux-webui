import { describe, expect, it } from 'vitest'
import { createTmuxExec, TmuxError } from '../../src/tmux/exec.js'

describe('createTmuxExec', () => {
  it('对不存在的独立 socket 报 NO_SERVER', async () => {
    const exec = createTmuxExec('webui-exec-test-nonexistent')
    await expect(exec(['list-sessions'])).rejects.toSatisfy(
      (e: unknown) => e instanceof TmuxError && e.code === 'NO_SERVER',
    )
  })

  it('PATH 里没有 tmux 时报 NOT_INSTALLED，而不是笼统的 FAILED', async () => {
    const original = process.env.PATH
    process.env.PATH = '/nonexistent-for-test'
    try {
      await expect(createTmuxExec()(['-V'])).rejects.toSatisfy(
        (e: unknown) => e instanceof TmuxError && e.code === 'NOT_INSTALLED',
      )
    } finally {
      process.env.PATH = original
    }
  })

  it('正常命令返回 stdout', async () => {
    const exec = createTmuxExec()
    // -V 不需要 server 运行
    const out = await exec(['-V'])
    expect(out).toMatch(/^tmux /)
  })
})
