import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError, fetchSessions, login } from './api'

afterEach(() => vi.restoreAllMocks())

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

describe('login', () => {
  it('成功时正常返回', async () => {
    mockFetch(200, { success: true })
    await expect(login('pw')).resolves.toBeUndefined()
  })

  it('失败时抛出服务端错误文案', async () => {
    mockFetch(401, { success: false, error: '密码错误' })
    await expect(login('pw')).rejects.toThrow('密码错误')
  })
})

describe('fetchSessions', () => {
  it('返回 data 数组', async () => {
    mockFetch(200, { success: true, data: [{ name: 'demo', attached: true, windows: [] }] })
    await expect(fetchSessions()).resolves.toEqual([
      { name: 'demo', attached: true, windows: [] },
    ])
  })

  it('401 时抛 AuthError', async () => {
    mockFetch(401, { success: false, error: '未登录' })
    await expect(fetchSessions()).rejects.toBeInstanceOf(AuthError)
  })

  it('503 时抛普通 Error（tmux 未运行）', async () => {
    mockFetch(503, { success: false, error: 'tmux server 未运行' })
    await expect(fetchSessions()).rejects.toThrow('tmux server 未运行')
  })
})
