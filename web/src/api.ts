export interface ApiWindow {
  index: number
  name: string
  active: boolean
}

export interface ApiSession {
  name: string
  attached: boolean
  windows: ApiWindow[]
}

export class AuthError extends Error {
  constructor() {
    super('未登录')
    this.name = 'AuthError'
  }
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function parseBody<T>(res: Response): Promise<ApiResponse<T>> {
  try {
    return (await res.json()) as ApiResponse<T>
  } catch {
    return { success: false, error: `HTTP ${res.status}` }
  }
}

export async function login(password: string): Promise<void> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = await parseBody<never>(res)
    throw new Error(body.error ?? '登录失败')
  }
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/sessions')
    return res.status !== 401
  } catch {
    return false
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST' })
}

export async function fetchSessions(): Promise<ApiSession[]> {
  const res = await fetch('/api/sessions')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<ApiSession[]>(res)
  if (!res.ok || !body.success) throw new Error(body.error ?? '获取会话列表失败')
  return body.data ?? []
}

async function mutate(url: string, method: string, payload: unknown, fallback: string): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<never>(res)
  if (!res.ok || !body.success) throw new Error(body.error ?? fallback)
}

export function createSession(name: string): Promise<void> {
  return mutate('/api/sessions', 'POST', { name }, '创建 session 失败')
}

export function deleteSession(name: string): Promise<void> {
  return mutate(`/api/sessions/${encodeURIComponent(name)}`, 'DELETE', undefined, '删除 session 失败')
}

export function renameSession(name: string, newName: string): Promise<void> {
  return mutate(
    `/api/sessions/${encodeURIComponent(name)}`,
    'PATCH',
    { name: newName },
    '重命名 session 失败',
  )
}
