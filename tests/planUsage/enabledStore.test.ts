import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEnabledStore } from '../../src/planUsage/enabledStore.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempFile(name = 'usage-providers.json'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-usage-state-'))
  roots.push(root)
  return path.join(root, 'nested', name)
}

const KNOWN = ['codex', 'codex-quota', 'claude-quota']

describe('createEnabledStore', () => {
  it('没有状态文件时为空——功能只在用户主动打开后才碰数据', async () => {
    const store = createEnabledStore({ file: await tempFile(), known: KNOWN })
    expect(store.list()).toEqual([])
  })

  it('保存后可读回，重新打开仍然有效', async () => {
    const file = await tempFile()
    const store = createEnabledStore({ file, known: KNOWN })
    await store.save(['codex-quota'])
    expect(store.list()).toEqual(['codex-quota'])
    expect(createEnabledStore({ file, known: KNOWN }).list()).toEqual(['codex-quota'])
  })

  it('只接受注册表里的 provider id', async () => {
    const store = createEnabledStore({ file: await tempFile(), known: KNOWN })
    await expect(store.save(['nope'])).rejects.toThrow()
    expect(store.list()).toEqual([])
  })

  it('状态文件按 0600 写入——它记录了服务被授权读取哪些凭据', async () => {
    const file = await tempFile()
    const store = createEnabledStore({ file, known: KNOWN })
    await store.save(['codex'])
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ enabled: ['codex'] })
  })

  it('文件损坏时当作空，含未知 id 时只保留认识的，不炸', async () => {
    const file = await tempFile()
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'not json')
    expect(createEnabledStore({ file, known: KNOWN }).list()).toEqual([])

    await writeFile(file, JSON.stringify({ enabled: ['codex', 'ghost'] }))
    expect(createEnabledStore({ file, known: KNOWN }).list()).toEqual(['codex'])
  })
})
