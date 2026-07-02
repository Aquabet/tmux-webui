import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password.js'

describe('password', () => {
  it('正确密码校验通过', async () => {
    const hash = await hashPassword('s3cret')
    expect(await verifyPassword('s3cret', hash)).toBe(true)
  })

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('s3cret')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('非法哈希返回 false 而不是抛错', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
  })
})
