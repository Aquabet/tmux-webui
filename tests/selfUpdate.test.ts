import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TmuxError } from '../src/tmux/exec.js'
import { canSelfUpdate, startUpdateSession, UPDATE_SESSION } from '../src/selfUpdate.js'

function repoWithScript(executable = true): string {
  const root = mkdtempSync(path.join(tmpdir(), 'webui-selfupdate-'))
  mkdirSync(path.join(root, 'scripts'))
  const script = path.join(root, 'scripts', 'update.sh')
  writeFileSync(script, '#!/bin/sh\n')
  chmodSync(script, executable ? 0o755 : 0o644)
  return root
}

describe('canSelfUpdate', () => {
  it('仓库里有可执行的 update.sh 时可用', () => {
    expect(canSelfUpdate(repoWithScript())).toBe(true)
  })

  it('脚本不可执行时不可用', () => {
    expect(canSelfUpdate(repoWithScript(false))).toBe(false)
  })

  it('没有脚本时不可用（如只拷了 dist 的部署）', () => {
    expect(canSelfUpdate(mkdtempSync(path.join(tmpdir(), 'webui-noscript-')))).toBe(false)
  })
})

describe('startUpdateSession', () => {
  const noSession = () => Promise.reject(new TmuxError('FAILED', "can't find session"))

  it('在独立 tmux session 里跑更新脚本，工作目录为仓库根', async () => {
    const root = repoWithScript()
    const calls: string[][] = []
    const exec = vi.fn(async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'has-session') return noSession()
      return ''
    })

    expect(await startUpdateSession(exec, root)).toEqual({ session: UPDATE_SESSION })

    const created = calls.find((c) => c[0] === 'new-session')
    expect(created).toBeDefined()
    expect(created).toContain('-d')
    expect(created).toContain(UPDATE_SESSION)
    // -c 指定启动目录，脚本必须在仓库根跑
    expect(created?.[created.indexOf('-c') + 1]).toBe(root)
    // 命令里不能出现任何来自请求的内容，只有固定的脚本调用
    const command = created?.[created.length - 1] ?? ''
    expect(command).toContain('scripts/update.sh')
    expect(command).toContain('--yes')
  })

  it('更新会话已存在时拒绝重复启动', async () => {
    const exec = vi.fn(async (args: string[]) => (args[0] === 'has-session' ? '' : ''))
    await expect(startUpdateSession(exec, repoWithScript())).rejects.toThrow(/已在进行/)
  })

  it('仓库里没有更新脚本时拒绝', async () => {
    const exec = vi.fn(async () => '')
    await expect(
      startUpdateSession(exec, mkdtempSync(path.join(tmpdir(), 'webui-noscript-'))),
    ).rejects.toThrow(/update\.sh/)
    expect(exec).not.toHaveBeenCalled()
  })
})
