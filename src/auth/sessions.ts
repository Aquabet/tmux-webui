import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SessionStore {
  create(): string
  isValid(token: string): boolean
  destroy(token: string): void
}

export function createSessionStore(
  ttlMs: number,
  now: () => number = Date.now,
  persistPath?: string,
): SessionStore {
  const expiries = new Map<string, number>()

  function save(): void {
    if (!persistPath) return
    try {
      mkdirSync(path.dirname(persistPath), { recursive: true })
      // token 即登录凭证，文件必须仅属主可读写
      writeFileSync(persistPath, JSON.stringify(Object.fromEntries(expiries)), { mode: 0o600 })
    } catch (error) {
      console.error('会话 token 落盘失败:', error)
    }
  }

  if (persistPath) {
    try {
      const raw = JSON.parse(readFileSync(persistPath, 'utf8')) as Record<string, unknown>
      for (const [token, expiry] of Object.entries(raw)) {
        if (typeof expiry === 'number' && expiry > now()) expiries.set(token, expiry)
      }
    } catch {
      // 文件不存在（首次启动）或损坏：从空开始
    }
    save()
  }

  return {
    create() {
      const token = randomBytes(32).toString('hex')
      expiries.set(token, now() + ttlMs)
      save()
      return token
    },
    isValid(token) {
      const expiry = expiries.get(token)
      if (expiry === undefined) return false
      if (expiry <= now()) {
        expiries.delete(token)
        save()
        return false
      }
      return true
    },
    destroy(token) {
      expiries.delete(token)
      save()
    },
  }
}
