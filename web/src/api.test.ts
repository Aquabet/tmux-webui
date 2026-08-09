import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthError,
  checkAuth,
  createSession,
  deleteSession,
  fetchSessions,
  fetchSystemResources,
  login,
  renameSession,
  uploadImage,
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

describe('checkAuth', () => {
  it('cookie 有效（非 401）返回 true', async () => {
    mockFetch(200, { success: true, data: [] })
    await expect(checkAuth()).resolves.toBe(true)
  })

  it('tmux 未运行（503）仍视为已登录', async () => {
    mockFetch(503, { success: false, error: 'tmux server 未运行' })
    await expect(checkAuth()).resolves.toBe(true)
  })

  it('401 返回 false', async () => {
    mockFetch(401, { success: false })
    await expect(checkAuth()).resolves.toBe(false)
  })

  it('网络错误返回 false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    )
    await expect(checkAuth()).resolves.toBe(false)
  })
})

describe('uploadImage', () => {
  it('POST 文件本体并返回保存路径', async () => {
    mockFetch(200, { success: true, data: { path: '/home/u/.tmux-webui/uploads/img-1.png' } })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    await expect(uploadImage(file)).resolves.toBe('/home/u/.tmux-webui/uploads/img-1.png')
    const call = vi.mocked(fetch).mock.calls[0]
    expect(call[0]).toBe('/api/upload')
    expect((call[1] as RequestInit).body).toBe(file)
    expect((call[1] as RequestInit).headers).toEqual({ 'content-type': 'image/png' })
  })

  it('401 抛 AuthError，失败抛服务端文案', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    mockFetch(401, { success: false })
    await expect(uploadImage(file)).rejects.toBeInstanceOf(AuthError)
    mockFetch(400, { success: false, error: '仅支持 png/jpeg/webp/gif 图片' })
    await expect(uploadImage(file)).rejects.toThrow('仅支持 png/jpeg/webp/gif 图片')
  })
})

describe('fetchSessions', () => {
  it('返回 data 数组', async () => {
    mockFetch(200, { success: true, data: [{ name: 'demo', attached: true, windows: [] }] })
    await expect(fetchSessions()).resolves.toEqual([{ name: 'demo', attached: true, windows: [] }])
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

describe('fetchSystemResources', () => {
  it('返回 CPU 与 RAM 数据', async () => {
    const data = {
      cpuPercent: 25,
      cpuCount: 4,
      memoryUsedBytes: 3_000,
      memoryTotalBytes: 8_000,
      memoryPercent: 37.5,
    }
    mockFetch(200, { success: true, data })
    await expect(fetchSystemResources()).resolves.toEqual(data)
  })

  it('401 时抛 AuthError', async () => {
    mockFetch(401, { success: false })
    await expect(fetchSystemResources()).rejects.toBeInstanceOf(AuthError)
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
