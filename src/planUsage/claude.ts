import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { ProviderUsage, TokenWindow, UsageProvider } from './types.js'

// Claude Code 本地没有任何配额上限数据（拿真实百分比必须带 OAuth 凭据出网，
// 违反本模块「纯本地」的安全边界），所以只能如实统计 transcript 里的
// token 用量：最近 5 小时滑动窗口 + 今日累计。展示端必须标注这不是配额。
//
// transcript 含完整对话内容，这里逐行流式解析、只取数字 usage 字段，
// 任何文本内容都不落到返回值里。

const FIVE_HOURS_MS = 5 * 3600 * 1000
const MAX_FILES = 200
const MAX_BYTES_PER_FILE = 32 * 1024 * 1024

interface ClaudeProviderOptions {
  projectsDir?: string
  now?: () => number
}

interface UsageEvent {
  timestamp: number
  dedupeKey: string
  tokens: number
}

function parseUsageEvent(line: string): UsageEvent | undefined {
  // 粗筛掉绝大多数行，避免为每行付 JSON.parse 的代价
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return undefined
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (record.type !== 'assistant') return undefined
  const timestamp = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN
  if (!Number.isFinite(timestamp)) return undefined
  const message = record.message
  if (typeof message !== 'object' || message === null) return undefined
  const { id, usage } = message as Record<string, unknown>
  if (typeof usage !== 'object' || usage === null) return undefined
  const fields = usage as Record<string, unknown>
  const tokens = [
    fields.input_tokens,
    fields.output_tokens,
    fields.cache_creation_input_tokens,
    fields.cache_read_input_tokens,
  ].reduce<number>((sum, value) => (typeof value === 'number' ? sum + value : sum), 0)
  return {
    timestamp,
    // 流式响应会把同一条消息写入多次，id+requestId 去重
    dedupeKey: `${typeof id === 'string' ? id : ''}:${typeof record.requestId === 'string' ? record.requestId : ''}`,
    tokens,
  }
}

async function listRecentTranscripts(root: string, cutoffMs: number): Promise<string[]> {
  const files: Array<{ file: string; mtimeMs: number }> = []
  for (const project of await readdir(root)) {
    const projectDir = path.join(root, project)
    for (const name of await readdir(projectDir).catch(() => [])) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(projectDir, name)
      const info = await stat(file).catch(() => undefined)
      if (!info?.isFile() || info.mtimeMs < cutoffMs) continue
      files.push({ file, mtimeMs: info.mtimeMs })
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES)
    .map((entry) => entry.file)
}

async function collectEvents(
  file: string,
  since: number,
  seen: Set<string>,
): Promise<UsageEvent[]> {
  const stream = createReadStream(file, { end: MAX_BYTES_PER_FILE - 1 })
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  const events: UsageEvent[] = []
  try {
    for await (const line of lines) {
      const event = parseUsageEvent(line)
      if (!event || event.timestamp < since || seen.has(event.dedupeKey)) continue
      seen.add(event.dedupeKey)
      events.push(event)
    }
  } catch {
    // 单个文件读取失败不影响其它文件
  } finally {
    lines.close()
    stream.destroy()
  }
  return events
}

export function createClaudeProvider(options: ClaudeProviderOptions = {}): UsageProvider {
  const projectsDir = options.projectsDir ?? path.join(homedir(), '.claude', 'projects')
  const now = options.now ?? Date.now

  return {
    id: 'claude',
    displayName: 'Claude Code',
    async collect(): Promise<ProviderUsage> {
      const base = { providerId: 'claude', displayName: 'Claude Code' }
      const timestamp = now()
      const midnight = new Date(timestamp).setHours(0, 0, 0, 0)
      // 5h 窗口可能跨午夜：取两个窗口起点中更早的作为读取下限
      const since = Math.min(midnight, timestamp - FIVE_HOURS_MS)

      let files: string[]
      try {
        files = await listRecentTranscripts(projectsDir, since)
      } catch {
        return { ...base, status: 'unavailable', windows: [] }
      }

      const seen = new Set<string>()
      const events: UsageEvent[] = []
      for (const file of files) {
        events.push(...(await collectEvents(file, since, seen)))
      }
      if (events.length === 0) {
        return { ...base, status: 'unavailable', windows: [] }
      }

      let fiveHourTokens = 0
      let todayTokens = 0
      let lastActivityAt = 0
      for (const event of events) {
        if (event.timestamp >= timestamp - FIVE_HOURS_MS) fiveHourTokens += event.tokens
        if (event.timestamp >= midnight) todayTokens += event.tokens
        if (event.timestamp > lastActivityAt) lastActivityAt = event.timestamp
      }
      const windows: TokenWindow[] = [
        {
          kind: 'tokens',
          label: '5h',
          tokens: fiveHourTokens,
          windowMinutes: 300,
          observedAt: timestamp,
          state: 'observed',
        },
        {
          kind: 'tokens',
          label: 'today',
          tokens: todayTokens,
          windowMinutes: Math.max(1, Math.round((timestamp - midnight) / 60_000)),
          observedAt: timestamp,
          state: 'observed',
        },
      ]
      return { ...base, status: 'ok', windows, lastActivityAt }
    },
  }
}
