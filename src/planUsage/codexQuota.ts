import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ProviderUsage, QuotaWindow, UsageProvider } from './types.js'

// 与 claude-quota 同款信任模型：读 Codex CLI 的 OAuth token
// （~/.codex/auth.json），调 ChatGPT 的 usage 接口换取实时配额。
// 相比本地 rollout 快照（codex provider），数据不滞后，且服务器端的
// plan_type 是细分档位（pro_5x/pro_20x 拆分后自动生效）。
//
// 必须在设置面板里显式打开才启用——打开即同意
// 「读 auth.json」+「HTTPS 请求 chatgpt.com」。token 只在单次请求
// 内存中使用，不落日志、不进返回值；API 原始响应不透传。

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const REQUEST_TIMEOUT_MS = 10_000

interface CodexQuotaOptions {
  authFile?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

interface Credentials {
  accessToken: string
  accountId?: string
}

function parseAuth(content: string): Credentials | undefined {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const tokens = record.tokens
  if (typeof tokens !== 'object' || tokens === null) return undefined
  const fields = tokens as Record<string, unknown>
  if (typeof fields.access_token !== 'string' || fields.access_token.length === 0) return undefined
  const accountId =
    typeof fields.account_id === 'string' && fields.account_id
      ? fields.account_id
      : typeof record.account_id === 'string'
        ? record.account_id
        : undefined
  return { accessToken: fields.access_token, accountId }
}

function windowLabel(minutes: number | undefined): string {
  if (minutes === undefined) return 'window'
  if (minutes <= 300) return '5h'
  if (minutes === 10080) return 'weekly'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  return `${minutes}m`
}

function toQuotaWindow(raw: unknown, observedAt: number, now: number): QuotaWindow | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const fields = raw as Record<string, unknown>
  if (typeof fields.used_percent !== 'number' || !Number.isFinite(fields.used_percent)) {
    return undefined
  }
  const windowMinutes =
    typeof fields.window_minutes === 'number'
      ? fields.window_minutes
      : typeof fields.limit_window_seconds === 'number'
        ? Math.round(fields.limit_window_seconds / 60)
        : undefined
  const resetsAtRaw =
    typeof fields.resets_at === 'number'
      ? fields.resets_at
      : typeof fields.reset_at === 'number'
        ? fields.reset_at
        : undefined
  const resetsAt =
    resetsAtRaw !== undefined
      ? resetsAtRaw * 1000
      : typeof fields.reset_after_seconds === 'number'
        ? now + fields.reset_after_seconds * 1000
        : undefined
  return {
    kind: 'quota',
    label: windowLabel(windowMinutes),
    usedPercent: fields.used_percent,
    windowMinutes,
    resetsAt,
    observedAt,
    state: resetsAt !== undefined && resetsAt < now ? 'expired' : 'observed',
  }
}

interface Extracted {
  planType?: string
  windows: QuotaWindow[]
}

function extract(body: unknown, now: number): Extracted {
  if (typeof body !== 'object' || body === null) return { windows: [] }
  const record = body as Record<string, unknown>
  const status =
    typeof record.rate_limit_status === 'object' && record.rate_limit_status !== null
      ? (record.rate_limit_status as Record<string, unknown>)
      : undefined
  const planTypeRaw =
    typeof record.plan_type === 'string'
      ? record.plan_type
      : typeof status?.plan_type === 'string'
        ? status.plan_type
        : undefined
  const rateLimit = (record.rate_limit ?? status?.rate_limit) as Record<string, unknown> | undefined
  const windows: QuotaWindow[] = []
  if (typeof rateLimit === 'object' && rateLimit !== null) {
    for (const key of ['primary', 'primary_window', 'secondary', 'secondary_window']) {
      const win = toQuotaWindow(rateLimit[key], now, now)
      if (win) windows.push(win)
    }
  }
  return { planType: planTypeRaw?.replace(/_/g, ' '), windows }
}

export function createCodexQuotaProvider(options: CodexQuotaOptions = {}): UsageProvider {
  const authFile = options.authFile ?? path.join(homedir(), '.codex', 'auth.json')
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now

  return {
    id: 'codex-quota',
    displayName: 'Codex Live',
    async collect(): Promise<ProviderUsage> {
      const base = { providerId: 'codex-quota', displayName: 'Codex Live' }
      let content: string
      try {
        content = await readFile(authFile, 'utf8')
      } catch {
        return { ...base, status: 'unavailable', windows: [] }
      }
      const credentials = parseAuth(content)
      if (!credentials) {
        return { ...base, status: 'error', windows: [] }
      }

      const timestamp = now()
      let body: unknown
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${credentials.accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'codex-cli',
        }
        if (credentials.accountId) headers['ChatGPT-Account-Id'] = credentials.accountId
        const res = await fetchImpl(USAGE_URL, {
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!res.ok) {
          return { ...base, status: 'error', windows: [] }
        }
        body = await res.json()
      } catch {
        return { ...base, status: 'error', windows: [] }
      }

      const { planType, windows } = extract(body, timestamp)
      if (windows.length === 0) {
        return { ...base, status: 'unavailable', windows: [] }
      }
      return { ...base, status: 'ok', planType, windows, lastActivityAt: timestamp }
    },
  }
}
