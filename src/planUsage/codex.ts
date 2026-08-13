import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ProviderUsage, QuotaWindow, UsageProvider } from './types.js'

// Codex CLI 在 ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl 里随每次请求写入
// rate_limits 快照。快照带真实配额百分比，本地解析即可，无需出网。
//
// 并发 session 会同时写多个文件，「最新文件」不等于「最新快照」：
// 按 mtime 取最近的一批文件，各自 tail 读，最后按事件时间戳挑最新。

const MAX_FILES = 8
const TAIL_BYTES = 64 * 1024
// 超过 30 天没有任何快照就当作没有数据，避免翻遍历史目录
const MAX_AGE_MS = 30 * 24 * 3600 * 1000

interface CodexProviderOptions {
  sessionsDir?: string
  now?: () => number
}

interface RawLimitWindow {
  used_percent?: unknown
  window_minutes?: unknown
  resets_at?: unknown
}

interface Snapshot {
  observedAt: number
  planType?: string
  primary?: RawLimitWindow
  secondary?: RawLimitWindow
}

function windowLabel(minutes: number | undefined): string {
  if (minutes === undefined) return 'window'
  if (minutes <= 300) return '5h'
  if (minutes === 10080) return 'weekly'
  if (minutes % 1440 === 0) return `${minutes / 1440}d`
  return `${minutes}m`
}

function toQuotaWindow(
  raw: RawLimitWindow,
  observedAt: number,
  now: number,
): QuotaWindow | undefined {
  if (typeof raw.used_percent !== 'number' || !Number.isFinite(raw.used_percent)) return undefined
  const windowMinutes = typeof raw.window_minutes === 'number' ? raw.window_minutes : undefined
  const resetsAt = typeof raw.resets_at === 'number' ? raw.resets_at * 1000 : undefined
  return {
    kind: 'quota',
    label: windowLabel(windowMinutes),
    usedPercent: raw.used_percent,
    windowMinutes,
    resetsAt,
    observedAt,
    state: resetsAt !== undefined && resetsAt < now ? 'expired' : 'observed',
  }
}

function parseSnapshot(line: string): Snapshot | undefined {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return undefined
  const rateLimits = (payload as Record<string, unknown>).rate_limits
  if (typeof rateLimits !== 'object' || rateLimits === null) return undefined
  const limits = rateLimits as Record<string, unknown>
  const observedAt = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
  if (!Number.isFinite(observedAt)) return undefined
  return {
    observedAt,
    planType: typeof limits.plan_type === 'string' ? limits.plan_type : undefined,
    primary:
      typeof limits.primary === 'object' && limits.primary !== null
        ? (limits.primary as RawLimitWindow)
        : undefined,
    secondary:
      typeof limits.secondary === 'object' && limits.secondary !== null
        ? (limits.secondary as RawLimitWindow)
        : undefined,
  }
}

// 只读文件末尾：rate_limits 跟随每次请求出现，最新的必然在尾部附近
async function readTail(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    // 从中间开始读时第一行多半被截断，丢掉
    return length < size ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}

async function listRecentFiles(root: string, now: number): Promise<string[]> {
  const files: Array<{ file: string; mtimeMs: number }> = []
  // 目录结构固定为 YYYY/MM/DD，三层枚举比递归 walk 更可控
  for (const year of await readdir(root)) {
    const yearDir = path.join(root, year)
    for (const month of await readdir(yearDir).catch(() => [])) {
      const monthDir = path.join(yearDir, month)
      for (const day of await readdir(monthDir).catch(() => [])) {
        const dayDir = path.join(monthDir, day)
        for (const name of await readdir(dayDir).catch(() => [])) {
          if (!name.endsWith('.jsonl')) continue
          const file = path.join(dayDir, name)
          const info = await stat(file).catch(() => undefined)
          if (!info?.isFile()) continue
          if (now - info.mtimeMs > MAX_AGE_MS) continue
          files.push({ file, mtimeMs: info.mtimeMs })
        }
      }
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES)
    .map((entry) => entry.file)
}

export function createCodexProvider(options: CodexProviderOptions = {}): UsageProvider {
  const sessionsDir = options.sessionsDir ?? path.join(homedir(), '.codex', 'sessions')
  const now = options.now ?? Date.now

  return {
    id: 'codex',
    displayName: 'Codex',
    async collect(): Promise<ProviderUsage> {
      const base = { providerId: 'codex', displayName: 'Codex' }
      const timestamp = now()
      let files: string[]
      try {
        files = await listRecentFiles(sessionsDir, timestamp)
      } catch {
        return { ...base, status: 'unavailable', windows: [] }
      }

      let latest: Snapshot | undefined
      for (const file of files) {
        const text = await readTail(file).catch(() => '')
        for (const line of text.split('\n')) {
          const snapshot = parseSnapshot(line)
          if (snapshot && (!latest || snapshot.observedAt > latest.observedAt)) {
            latest = snapshot
          }
        }
      }
      if (!latest) {
        return { ...base, status: 'unavailable', windows: [] }
      }

      const windows = [latest.primary, latest.secondary]
        .map((raw) => (raw ? toQuotaWindow(raw, latest.observedAt, timestamp) : undefined))
        .filter((win): win is QuotaWindow => win !== undefined)
      return {
        ...base,
        status: windows.length > 0 ? 'ok' : 'unavailable',
        planType: latest.planType,
        windows,
        lastActivityAt: latest.observedAt,
      }
    },
  }
}
