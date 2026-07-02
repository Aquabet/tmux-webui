import { describe, expect, it } from 'vitest'
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
