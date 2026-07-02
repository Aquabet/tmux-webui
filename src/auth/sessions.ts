import { randomBytes } from 'node:crypto'

export interface SessionStore {
  create(): string
  isValid(token: string): boolean
  destroy(token: string): void
}

export function createSessionStore(ttlMs: number, now: () => number = Date.now): SessionStore {
  const expiries = new Map<string, number>()
  return {
    create() {
      const token = randomBytes(32).toString('hex')
      expiries.set(token, now() + ttlMs)
      return token
    },
    isValid(token) {
      const expiry = expiries.get(token)
      if (expiry === undefined) return false
      if (expiry <= now()) {
        expiries.delete(token)
        return false
      }
      return true
    },
    destroy(token) {
      expiries.delete(token)
    },
  }
}
