import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionStore } from '../../src/auth/sessions.js'

describe('createSessionStore', () => {
  it('create 返回 64 位 hex token 且 isValid 为 true', () => {
    const store = createSessionStore(1000)
    const token = store.create()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(store.isValid(token)).toBe(true)
  })

  it('未知 token 无效', () => {
    const store = createSessionStore(1000)
    expect(store.isValid('nope')).toBe(false)
  })

  it('过期 token 无效', () => {
    let t = 0
    const store = createSessionStore(1000, () => t)
    const token = store.create()
    t = 1001
    expect(store.isValid(token)).toBe(false)
  })

  it('destroy 后无效', () => {
    const store = createSessionStore(1000)
    const token = store.create()
    store.destroy(token)
    expect(store.isValid(token)).toBe(false)
  })
})

describe('token 落盘', () => {
  const dirs: string[] = []
  function tempFile(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'webui-sessions-'))
    dirs.push(dir)
    return path.join(dir, 'sessions.json')
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('token 跨 store 实例存活（模拟 server 重启）', () => {
    const file = tempFile()
    const store = createSessionStore(1000, Date.now, file)
    const token = store.create()
    const restarted = createSessionStore(1000, Date.now, file)
    expect(restarted.isValid(token)).toBe(true)
  })

  it('destroy 也落盘', () => {
    const file = tempFile()
    const store = createSessionStore(1000, Date.now, file)
    const token = store.create()
    store.destroy(token)
    const restarted = createSessionStore(1000, Date.now, file)
    expect(restarted.isValid(token)).toBe(false)
  })

  it('加载时丢弃过期 token', () => {
    const file = tempFile()
    let t = 0
    const store = createSessionStore(1000, () => t, file)
    const token = store.create()
    t = 2000
    const restarted = createSessionStore(1000, () => t, file)
    expect(restarted.isValid(token)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8'))).not.toHaveProperty(token)
  })

  it('文件损坏时从空开始，不抛错', () => {
    const file = tempFile()
    writeFileSync(file, 'not json{{')
    const store = createSessionStore(1000, Date.now, file)
    expect(store.isValid('nope')).toBe(false)
    expect(store.create()).toMatch(/^[0-9a-f]{64}$/)
  })

  it('文件权限 0600', () => {
    const file = tempFile()
    createSessionStore(1000, Date.now, file).create()
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('目录不存在时自动创建', () => {
    const file = path.join(tempFile(), '..', 'nested', 'deep', 'sessions.json')
    const store = createSessionStore(1000, Date.now, file)
    const token = store.create()
    expect(createSessionStore(1000, Date.now, file).isValid(token)).toBe(true)
  })
})
