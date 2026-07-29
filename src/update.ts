const RELEASE_API = 'https://api.github.com/repos/Aquabet/tmux-webui/releases/latest'
const DEFAULT_TTL_MS = 6 * 3600_000
const DEFAULT_FAILURE_TTL_MS = 10 * 60_000
const REQUEST_TIMEOUT_MS = 5_000

export interface UpdateInfo {
  current: string
  latest: string | null
  url: string | null
  updateAvailable: boolean
}

// tag 前缀：本项目用 pi（见 CLAUDE.md 的版本号规则），历史上的 v 也认
const VERSION_PREFIX = /^(?:pi-?|v)/

// 只比 x.y.z 三段数值；带 - 后缀的预发布版排在同号正式版之前，
// 不做完整 semver 的预发布串比较（发布节奏用不上）。
// 数值比较对 π 展开天然成立：3.141 > 3.14 > 3.1
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(VERSION_PREFIX, '').split('-', 2)
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0)
    return { nums, isPrerelease: pre !== undefined }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  if (left.isPrerelease === right.isPrerelease) return 0
  return left.isPrerelease ? -1 : 1
}

interface CheckerOptions {
  current: string
  enabled: boolean
  fetchImpl?: typeof fetch
  ttlMs?: number
  failureTtlMs?: number
  now?: () => number
}

// 检查在服务端做：浏览器直连 GitHub 会撞 CORS，而且每个客户端各算一次
// 未认证配额（60 次/小时/IP）。结果缓存，失败缓存更短以便恢复后重试。
export function createUpdateChecker(options: CheckerOptions): () => Promise<UpdateInfo> {
  const {
    current,
    enabled,
    fetchImpl = fetch,
    ttlMs = DEFAULT_TTL_MS,
    failureTtlMs = DEFAULT_FAILURE_TTL_MS,
    now = Date.now,
  } = options

  const unknown: UpdateInfo = { current, latest: null, url: null, updateAvailable: false }
  let cached: { info: UpdateInfo; until: number } | null = null
  let inFlight: Promise<UpdateInfo> | null = null

  async function fetchLatest(): Promise<UpdateInfo> {
    const res = await fetchImpl(RELEASE_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`GitHub releases 接口返回 ${res.status}`)
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof body.tag_name !== 'string') throw new Error('releases 接口缺少 tag_name')
    const latest = body.tag_name.replace(VERSION_PREFIX, '')
    return {
      current,
      latest,
      url: typeof body.html_url === 'string' ? body.html_url : null,
      updateAvailable: compareVersions(latest, current) > 0,
    }
  }

  return async function check(): Promise<UpdateInfo> {
    if (!enabled) return unknown
    if (cached && now() < cached.until) return cached.info
    if (inFlight) return inFlight

    inFlight = fetchLatest()
      .then((info) => {
        cached = { info, until: now() + ttlMs }
        return info
      })
      .catch(() => {
        // 查不到更新不是错误，页面照常用；短缓存避免离线时每次请求都重试
        cached = { info: unknown, until: now() + failureTtlMs }
        return unknown
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }
}
