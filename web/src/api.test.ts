import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthError,
  createSession,
  deleteSession,
  fetchSessions,
  login,
  renameSession,
} from './api'

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

describe('session 管理', () => {
  it('createSession POST 到 /api/sessions', async () => {
    mockFetch(201, { success: true })
    await createSession('dev')
    const call = vi.mocked(fetch).mock.calls[0]
    expect(call[0]).toBe('/api/sessions')
    expect((call[1] as RequestInit).method).toBe('POST')
    expect((call[1] as RequestInit).body).toBe(JSON.stringify({ name: 'dev' }))
  })

  it('deleteSession DELETE 到编码后的路径', async () => {
    mockFetch(200, { success: true })
    await deleteSession('my/session')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/sessions/my%2Fsession')
  })

  it('renameSession PATCH 新名称', async () => {
    mockFetch(200, { success: true })
    await renameSession('dev', 'work')
    const call = vi.mocked(fetch).mock.calls[0]
    expect(call[0]).toBe('/api/sessions/dev')
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect((call[1] as RequestInit).body).toBe(JSON.stringify({ name: 'work' }))
  })

  it('401 时抛 AuthError，失败时抛服务端文案', async () => {
    mockFetch(401, { success: false })
    await expect(createSession('dev')).rejects.toBeInstanceOf(AuthError)
    mockFetch(409, { success: false, error: '同名 session 已存在' })
    await expect(createSession('dev')).rejects.toThrow('同名 session 已存在')
  })
})
