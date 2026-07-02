import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../../src/auth/rateLimit.js'

describe('createRateLimiter', () => {
  it('窗口内不超过 max 次放行', () => {
    const limiter = createRateLimiter(3, 60_000, () => 0)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
  })

  it('不同 key 互不影响', () => {
    const limiter = createRateLimiter(1, 60_000, () => 0)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
  })

  it('窗口滑过后恢复放行', () => {
    let t = 0
    const limiter = createRateLimiter(1, 1000, () => t)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
    t = 1001
    expect(limiter.allow('a')).toBe(true)
  })
})
