import type { RequestHandler } from 'express'
import type { SessionStore } from '../auth/sessions.js'

export const COOKIE_NAME = 'webui_token'

export function requireAuth(store: SessionStore): RequestHandler {
  return (req, res, next) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
    if (!token || !store.isValid(token)) {
      res.status(401).json({ success: false, error: '未登录' })
      return
    }
    next()
  }
}
