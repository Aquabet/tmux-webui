import { Router, json } from 'express'
import { z } from 'zod'
import { verifyPassword } from '../auth/password.js'
import type { RateLimiter } from '../auth/rateLimit.js'
import type { SessionStore } from '../auth/sessions.js'
import type { Config } from '../config.js'
import { TmuxError, type TmuxExec } from '../tmux/exec.js'
import { listSessions } from '../tmux/list.js'
import { COOKIE_NAME, requireAuth } from './middleware.js'

export interface ApiDeps {
  config: Config
  store: SessionStore
  limiter: RateLimiter
  exec: TmuxExec
}

const loginSchema = z.object({ password: z.string().min(1).max(200) })

export function createApiRouter(deps: ApiDeps): Router {
  const router = Router()
  router.use(json())

  router.post('/login', async (req, res) => {
    if (!deps.limiter.allow(req.ip ?? 'unknown')) {
      res.status(429).json({ success: false, error: '尝试过于频繁，请稍后再试' })
      return
    }
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ success: false, error: '请求格式错误' })
      return
    }
    const ok = await verifyPassword(parsed.data.password, deps.config.passwordHash)
    if (!ok) {
      res.status(401).json({ success: false, error: '密码错误' })
      return
    }
    const token = deps.store.create()
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: deps.config.cookieSecure,
      maxAge: deps.config.sessionTtlMs,
    })
    res.json({ success: true })
  })

  router.post('/logout', (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
    if (token) deps.store.destroy(token)
    res.clearCookie(COOKIE_NAME)
    res.json({ success: true })
  })

  router.get('/sessions', requireAuth(deps.store), async (_req, res) => {
    try {
      const data = await listSessions(deps.exec)
      res.json({ success: true, data })
    } catch (error) {
      if (error instanceof TmuxError && error.code === 'NO_SERVER') {
        res.status(503).json({ success: false, error: 'tmux server 未运行' })
        return
      }
      console.error('获取会话列表失败:', error)
      res.status(500).json({ success: false, error: '获取会话列表失败' })
    }
  })

  return router
}
