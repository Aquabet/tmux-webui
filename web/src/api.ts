export interface ApiWindow {
  index: number
  name: string
  active: boolean
}

export type ApiAgentKind = 'codex' | 'claude' | 'pi' | 'kimi' | 'opencode'
export type ApiAgentStatus = 'running' | 'waiting'

export interface ApiAgent {
  kind: ApiAgentKind
  status?: ApiAgentStatus
}

export interface ApiSession {
  name: string
  attached: boolean
  windows: ApiWindow[]
  agents?: ApiAgent[]
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

export async function uploadImage(file: File): Promise<string> {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<{ path: string }>(res)
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? '上传失败')
  return body.data.path
}

export async function checkAuth(): Promise<boolean> {
  try {
    const res = await fetch('/api/sessions')
    return res.status !== 401
  } catch {
    return false
  }
}

export interface VersionInfo {
  current: string
  latest: string | null
  url: string | null
  updateAvailable: boolean
  canUpdate: boolean
}

export interface SystemResources {
  cpuPercent: number
  cpuCount: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  memoryPercent: number
}

// 与后端 src/planUsage/types.ts 对应；数据全部来自服务器本地文件解析
export interface PlanUsageQuotaWindow {
  kind: 'quota'
  label: string
  usedPercent: number
  windowMinutes?: number
  resetsAt?: number
  observedAt: number
  state: 'observed' | 'expired'
}

export interface PlanUsageTokenWindow {
  kind: 'tokens'
  label: string
  tokens: number
  windowMinutes: number
  observedAt: number
  state: 'observed'
}

export interface PlanUsageProvider {
  providerId: string
  displayName: string
  /** disabled = 未在设置里启用，服务端完全没去读它的数据 */
  status: 'ok' | 'unavailable' | 'error' | 'disabled'
  planType?: string
  windows: Array<PlanUsageQuotaWindow | PlanUsageTokenWindow>
  lastActivityAt?: number
}

export interface PlanUsageReport {
  schemaVersion: number
  collectedAt: number
  providers: PlanUsageProvider[]
}

export async function fetchPlanUsage(): Promise<PlanUsageReport> {
  const res = await fetch('/api/usage')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<PlanUsageReport>(res)
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? '获取计划用量失败')
  return body.data
}

export function savePlanUsageProviders(enabled: string[]): Promise<void> {
  return mutate('/api/usage/providers', 'PUT', { enabled }, '保存用量 provider 失败')
}

export async function fetchSystemResources(): Promise<SystemResources> {
  const res = await fetch('/api/resources')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<SystemResources>(res)
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? '获取系统资源失败')
  return body.data
}

export async function fetchVersion(): Promise<VersionInfo> {
  const res = await fetch('/api/version')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<VersionInfo>(res)
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? '获取版本失败')
  return body.data
}

// 在独立 tmux session 里启动更新，返回的会话名用于切过去看输出
export async function startUpdate(): Promise<string> {
  const res = await fetch('/api/update', { method: 'POST' })
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<{ session: string }>(res)
  if (!res.ok || !body.success || !body.data) throw new Error(body.error ?? '启动更新失败')
  return body.data.session
}

export async function fetchSessions(): Promise<ApiSession[]> {
  const res = await fetch('/api/sessions')
  if (res.status === 401) throw new AuthError()
  const body = await parseBody<ApiSession[]>(res)
  if (!res.ok || !body.success) throw new Error(body.error ?? '获取会话列表失败')
  return body.data ?? []
}

async function mutate(
  url: string,
  method: string,
  payload: unknown,
  fallback: string,
): Promise<void> {
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
  return mutate(
    `/api/sessions/${encodeURIComponent(name)}`,
    'DELETE',
    undefined,
    '删除 session 失败',
  )
}

export function renameSession(name: string, newName: string): Promise<void> {
  return mutate(
    `/api/sessions/${encodeURIComponent(name)}`,
    'PATCH',
    { name: newName },
    '重命名 session 失败',
  )
}
