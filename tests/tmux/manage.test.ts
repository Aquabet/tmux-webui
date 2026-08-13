import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { TmuxExec } from '../../src/tmux/exec.js'
import {
  createSession,
  killSession,
  renameSession,
  sessionNameError,
} from '../../src/tmux/manage.js'

function makeExec() {
  const calls: string[][] = []
  const exec: TmuxExec = async (args) => {
    calls.push(args)
    return ''
  }
  return { calls, exec }
}

describe('sessionNameError', () => {
  it('合法名称返回 undefined', () => {
    expect(sessionNameError('dev')).toBeUndefined()
    expect(sessionNameError('my-project_2')).toBeUndefined()
  })

  it('拒绝空名称、冒号、点和空白（tmux 目标语法保留字符）', () => {
    expect(sessionNameError('')).toBeDefined()
    expect(sessionNameError('a:b')).toBeDefined()
    expect(sessionNameError('a.b')).toBeDefined()
    expect(sessionNameError('a b')).toBeDefined()
  })

  it('拒绝超过 64 字符的名称', () => {
    expect(sessionNameError('x'.repeat(65))).toBeDefined()
  })

  it('拒绝 webui- 前缀（内部视图会话保留）', () => {
    expect(sessionNameError('webui-abc')).toBeDefined()
  })
})

describe('createSession', () => {
  it('以 detached 方式创建会话，并显式指定起始目录', async () => {
    const { calls, exec } = makeExec()
    await createSession(exec, 'dev', '/home/tester')
    expect(calls).toEqual([['new-session', '-d', '-s', 'dev', '-c', '/home/tester']])
  })

  // 不带 -c 时，新 session 会继承 tmux server 的 cwd；而 server 常常是被
  // 本服务拉起的，于是安装目录被当成用户的默认工作目录
  it('默认使用 home 目录，不泄漏服务进程的工作目录', async () => {
    const { calls, exec } = makeExec()
    await createSession(exec, 'dev')
    expect(calls[0].slice(0, 4)).toEqual(['new-session', '-d', '-s', 'dev'])
    expect(calls[0][4]).toBe('-c')
    expect(calls[0][5]).toBe(homedir())
  })

  it('非法名称直接抛错且不调用 tmux', async () => {
    const { calls, exec } = makeExec()
    await expect(createSession(exec, 'webui-x')).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('killSession', () => {
  it('用 = 前缀精确匹配目标，避免 tmux 前缀匹配误杀', async () => {
    const { calls, exec } = makeExec()
    await killSession(exec, 'dev')
    expect(calls).toEqual([['kill-session', '-t', '=dev']])
  })

  it('拒绝删除 webui- 内部视图会话', async () => {
    const { calls, exec } = makeExec()
    await expect(killSession(exec, 'webui-abc12345')).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

describe('renameSession', () => {
  it('用 = 前缀精确匹配旧名称', async () => {
    const { calls, exec } = makeExec()
    await renameSession(exec, 'dev', 'work')
    expect(calls).toEqual([['rename-session', '-t', '=dev', 'work']])
  })

  it('新旧名称任一非法都拒绝', async () => {
    const { calls, exec } = makeExec()
    await expect(renameSession(exec, 'dev', 'webui-x')).rejects.toThrow()
    await expect(renameSession(exec, 'a:b', 'work')).rejects.toThrow()
    expect(calls).toEqual([])
  })
})
