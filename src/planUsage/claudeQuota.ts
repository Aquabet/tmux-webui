import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ProviderUsage, QuotaWindow, UsageProvider } from './types.js'

// 唯一一个会出网、会读凭据的 provider：拿 Claude Code 的 OAuth token 调
// Anthropic 的 usage 接口，换取官方的窗口用量百分比。因此它单独成一个
// provider id（claude-quota），必须在设置面板里显式打开才会启用——
// 打开即代表用户同意这两件事。
//
// 安全边界：token 只在进程内存在于单次请求；不落日志、不进返回值；
// API 原始响应不透传，只提取数字百分比与重置时间。token 过期时不请求
// 也不刷新——刷新流程属于 Claude Code 自己，这里绝不碰 refreshToken。

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const REQUEST_TIMEOUT_MS = 10_000

// 只展示已知窗口；接口会夹带内部实验性限额桶（如 nimbus_quill），
// 对用户没有意义，直接丢弃
const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'weekly',
}

// 接口只给 resets_at，不给窗口长度；前端要用它算"按时间该用到哪"的基准线
const WINDOW_MINUTES: Record<string, number> = {
  five_hour: 300,
  seven_day: 10080,
}

interface ClaudeQuotaOptions {
  credentialsFile?: string
  /** Claude Code 的账号状态文件（~/.claude.json），只用于读取 rate limit tier */
  accountFile?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

interface Credentials {
  accessToken: string
  expiresAt?: number
  subscriptionType?: string
}

function parseCredentials(content: string): Credentials | undefined {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const oauth = record.claudeAiOauth ?? record
  if (typeof oauth !== 'object' || oauth === null) return undefined
  const fields = oauth as Record<string, unknown>
  if (typeof fields.accessToken !== 'string' || fields.accessToken.length === 0) return undefined
  return {
    accessToken: fields.accessToken,
    expiresAt: typeof fields.expiresAt === 'number' ? fields.expiresAt : undefined,
    subscriptionType:
      typeof fields.subscriptionType === 'string' ? fields.subscriptionType : undefined,
  }
}

// ~/.claude.json 里 oauthAccount 的 rate limit tier 能区分 max 5x / 20x，
// 订阅类型（"max"）没有这个粒度。文件包含大量与此无关的本地状态，
// 这里只取 tier 字符串，其它内容不进入返回值。
// 'default_claude_max_20x' → 'max 20x'
function parsePlanTier(content: string): string | undefined {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const account = (data as Record<string, unknown>).oauthAccount
  if (typeof account !== 'object' || account === null) return undefined
  const fields = account as Record<string, unknown>
  const tier =
    typeof fields.userRateLimitTier === 'string'
      ? fields.userRateLimitTier
      : typeof fields.organizationRateLimitTier === 'string'
        ? fields.organizationRateLimitTier
        : undefined
  if (!tier) return undefined
  return tier
    .replace(/^default_/, '')
    .replace(/^claude_/, '')
    .replace(/_/g, ' ')
}

function parseResetsAt(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // 接口可能返回 epoch 秒；毫秒时间戳不会小于 1e12
    return value < 1e12 ? value * 1000 : value
  }
  return undefined
}

function extractWindows(body: unknown, observedAt: number, now: number): QuotaWindow[] {
  if (typeof body !== 'object' || body === null) return []
  const windows: QuotaWindow[] = []
  for (const [key, value] of Object.entries(body)) {
    if (!(key in WINDOW_LABELS)) continue
    if (typeof value !== 'object' || value === null) continue
    const fields = value as Record<string, unknown>
    if (typeof fields.utilization !== 'number' || !Number.isFinite(fields.utilization)) continue
    const resetsAt = parseResetsAt(fields.resets_at)
    windows.push({
      kind: 'quota',
      label: WINDOW_LABELS[key],
      usedPercent: fields.utilization,
      windowMinutes: WINDOW_MINUTES[key],
      resetsAt,
      observedAt,
      state: resetsAt !== undefined && resetsAt < now ? 'expired' : 'observed',
    })
  }
  return windows
}

export function createClaudeQuotaProvider(options: ClaudeQuotaOptions = {}): UsageProvider {
  const credentialsFile =
    options.credentialsFile ?? path.join(homedir(), '.claude', '.credentials.json')
  const accountFile = options.accountFile ?? path.join(homedir(), '.claude.json')
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now

  return {
    id: 'claude-quota',
    displayName: 'Claude Code',
    async collect(): Promise<ProviderUsage> {
      const base = { providerId: 'claude-quota', displayName: 'Claude Code' }
      let content: string
      try {
        content = await readFile(credentialsFile, 'utf8')
      } catch {
        return { ...base, status: 'unavailable', windows: [] }
      }
      const credentials = parseCredentials(content)
      if (!credentials) {
        return { ...base, status: 'error', windows: [] }
      }
      const timestamp = now()
      // token 已过期：请求必然 401，而刷新是 Claude Code 的事，这里直接报错
      if (credentials.expiresAt !== undefined && credentials.expiresAt <= timestamp) {
        return { ...base, status: 'error', windows: [] }
      }

      let body: unknown
      try {
        const res = await fetchImpl(USAGE_URL, {
          headers: {
            Authorization: `Bearer ${credentials.accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!res.ok) {
          return { ...base, status: 'error', windows: [] }
        }
        body = await res.json()
      } catch {
        return { ...base, status: 'error', windows: [] }
      }

      const windows = extractWindows(body, timestamp, timestamp)
      if (windows.length === 0) {
        return { ...base, status: 'unavailable', windows: [] }
      }
      const tier = parsePlanTier(await readFile(accountFile, 'utf8').catch(() => ''))
      return {
        ...base,
        status: 'ok',
        planType: tier ?? credentials.subscriptionType,
        windows,
        lastActivityAt: timestamp,
      }
    },
  }
}
