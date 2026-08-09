import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTmuxExec, TmuxError } from '../src/tmux/exec.js'
import { canSelfUpdate, startUpdateSession, UPDATE_SESSION } from '../src/selfUpdate.js'

const projectRoot = path.resolve(import.meta.dirname, '..')

function repoWithScript(executable = true): string {
  const root = mkdtempSync(path.join(tmpdir(), 'webui-selfupdate-'))
  mkdirSync(path.join(root, 'scripts'))
  const script = path.join(root, 'scripts', 'update.sh')
  writeFileSync(script, '#!/bin/sh\n')
  chmodSync(script, executable ? 0o755 : 0o644)
  return root
}

describe('update working tree hygiene', () => {
  it('忽略 Playwright MCP 生成物，避免它们阻止安全更新', () => {
    const ignoredBy = execFileSync(
      'git',
      ['check-ignore', '--verbose', '.playwright-mcp/page.yml'],
      { cwd: projectRoot, encoding: 'utf8' },
    )

    expect(ignoredBy).toMatch(/^\.gitignore:.*:\.playwright-mcp\//)
  })
})

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
    expect(calls).toContainEqual([
      'set-window-option',
      '-t',
      UPDATE_SESSION,
      'remain-on-exit',
      'on',
    ])
    expect(calls).toContainEqual([
      'set-option',
      '-t',
      UPDATE_SESSION,
      '@tmux_webui_update',
      'managed',
    ])
    // 命令里不能出现任何来自请求的内容，只有固定的脚本调用
    const respawn = calls.find((c) => c[0] === 'respawn-pane')
    const command = respawn?.[respawn.length - 1] ?? ''
    expect(command).toContain('scripts/update.sh')
    expect(command).toContain('--yes')
    expect(command).toContain('更新失败')
    expect(command).toContain('if ./')
    expect(command).not.toContain('exec "${SHELL')
  })

  it('受管更新会话仍在运行时拒绝重复启动', async () => {
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'has-session') return ''
      if (args[0] === 'list-panes') return '0\tif ./scripts/update.sh --yes; then ...\n'
      if (args[0] === 'show-options') return 'managed\n'
      return ''
    })
    await expect(startUpdateSession(exec, repoWithScript())).rejects.toThrow(/已在进行/)
  })

  it.each([
    ['旧版遗留的 shell', '0\tif ./scripts/update.sh --yes; then ...\n', ''],
    ['已经结束的受管 pane', '1\tif ./scripts/update.sh --yes; then ...\n', 'managed\n'],
  ])('%s 会被自动清理后开始新更新', async (_label, paneDead, marker) => {
    const calls: string[][] = []
    const exec = vi.fn(async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'has-session') return ''
      if (args[0] === 'list-panes') return paneDead
      if (args[0] === 'show-options') {
        if (marker) return marker
        throw new TmuxError('FAILED', 'unknown option')
      }
      return ''
    })

    await expect(startUpdateSession(exec, repoWithScript())).resolves.toEqual({
      session: UPDATE_SESSION,
    })
    expect(calls).toContainEqual(['kill-session', '-t', `=${UPDATE_SESSION}`])
    expect(calls.some((args) => args[0] === 'new-session')).toBe(true)
  })

  it('不删除用户碰巧创建的同名 session', async () => {
    const calls: string[][] = []
    const exec = vi.fn(async (args: string[]) => {
      calls.push(args)
      if (args[0] === 'has-session') return ''
      if (args[0] === 'list-panes') return '0\tbash\n'
      if (args[0] === 'show-options') throw new TmuxError('FAILED', 'unknown option')
      return ''
    })

    await expect(startUpdateSession(exec, repoWithScript())).rejects.toThrow(/已被占用/)
    expect(calls).not.toContainEqual(['kill-session', '-t', `=${UPDATE_SESSION}`])
  })

  it.each(['set-option', 'set-window-option', 'respawn-pane'])(
    '初始化更新 pane 的 %s 失败时清理半创建的 session',
    async (failingCommand) => {
      const calls: string[][] = []
      const exec = vi.fn(async (args: string[]) => {
        calls.push(args)
        if (args[0] === 'has-session') return noSession()
        if (args[0] === failingCommand) {
          throw new TmuxError('FAILED', `${failingCommand} failed`)
        }
        return ''
      })

      await expect(startUpdateSession(exec, repoWithScript())).rejects.toThrow(
        new RegExp(`${failingCommand} failed`),
      )
      expect(calls).toContainEqual(['kill-session', '-t', `=${UPDATE_SESSION}`])
    },
  )

  it('两个同时点击只有第一个能越过启动锁', async () => {
    let releaseHasSession: (() => void) | undefined
    let firstHasSession = true
    const exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'has-session' && firstHasSession) {
        firstHasSession = false
        await new Promise<void>((resolve) => {
          releaseHasSession = resolve
        })
        throw new TmuxError('FAILED', "can't find session")
      }
      return ''
    })
    const root = repoWithScript()
    const first = startUpdateSession(exec, root)
    await vi.waitFor(() => expect(releaseHasSession).toBeTypeOf('function'))

    await expect(startUpdateSession(exec, root)).rejects.toThrow(/正在启动/)
    releaseHasSession?.()
    await expect(first).resolves.toEqual({ session: UPDATE_SESSION })
  })

  it('真实 tmux 会保留已结束输出，下一次更新自动替换 dead pane', async () => {
    const exec = createTmuxExec(`webui-selfupdate-${process.pid}`)
    const root = repoWithScript()
    try {
      await startUpdateSession(exec, root)
      let paneDead = ''
      for (let attempt = 0; attempt < 40 && paneDead.trim() !== '1'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        paneDead = await exec(['list-panes', '-t', `=${UPDATE_SESSION}`, '-F', '#{pane_dead}'])
      }
      expect(paneDead.trim()).toBe('1')
      expect(await exec(['capture-pane', '-p', '-t', `${UPDATE_SESSION}:0.0`])).toContain(
        '更新完成',
      )

      await expect(startUpdateSession(exec, root)).resolves.toEqual({ session: UPDATE_SESSION })
    } finally {
      await exec(['kill-server']).catch(() => undefined)
    }
  })

  it('仓库里没有更新脚本时拒绝', async () => {
    const exec = vi.fn(async () => '')
    await expect(
      startUpdateSession(exec, mkdtempSync(path.join(tmpdir(), 'webui-noscript-'))),
    ).rejects.toThrow(/update\.sh/)
    expect(exec).not.toHaveBeenCalled()
  })
})
