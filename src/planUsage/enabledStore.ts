import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// 哪些 provider 被启用，由界面里的开关决定并落盘。
// 启用一个 live provider 就是同意服务读取对应 CLI 的 OAuth 凭据并请求
// 厂商接口，所以这份状态与密码哈希同等对待：0600，只存 id 列表。

interface EnabledStoreOptions {
  file: string
  /** 注册表里全部 provider id，未知 id 一律拒绝 */
  known: string[]
  /** 状态文件不存在时的初始值（来自配置，便于无人值守部署） */
  seed?: string[]
}

interface EnabledStore {
  list(): string[]
  save(ids: string[]): Promise<void>
}

export function createEnabledStore(options: EnabledStoreOptions): EnabledStore {
  const known = new Set(options.known)
  const sanitize = (ids: unknown): string[] =>
    Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && known.has(id))
      : []

  function readFile(): string[] | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(options.file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const { enabled } = parsed as Record<string, unknown>
      return Array.isArray(enabled) ? sanitize(enabled) : undefined
    } catch {
      return undefined
    }
  }

  let current = readFile() ?? sanitize(options.seed ?? [])

  return {
    list: () => [...current],
    async save(ids: string[]): Promise<void> {
      const unknown = ids.filter((id) => !known.has(id))
      if (unknown.length > 0) {
        throw new Error(`未知的用量 provider: ${unknown.join(', ')}`)
      }
      mkdirSync(path.dirname(options.file), { recursive: true, mode: 0o700 })
      writeFileSync(options.file, `${JSON.stringify({ enabled: ids })}\n`, { mode: 0o600 })
      current = [...ids]
    },
  }
}
