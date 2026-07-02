import { Router, json, type Response } from 'express'
import { z } from 'zod'
import { verifyPassword } from '../auth/password.js'
import type { RateLimiter } from '../auth/rateLimit.js'
import type { SessionStore } from '../auth/sessions.js'
import type { Config } from '../config.js'
import { TmuxError, type TmuxExec } from '../tmux/exec.js'
import { listSessions } from '../tmux/list.js'
import {
  createSession,
  killSession,
  renameSession,
  sessionNameError,
} from '../tmux/manage.js'
import { COOKIE_NAME, requireAuth } from './middleware.js'

export interface ApiDeps {
  config: Config
  store: SessionStore
  limiter: RateLimiter
  exec: TmuxExec
}

const loginSchema = z.object({ password: z.string().min(1).max(200) })
const sessionNameSchema = z.object({ name: z.string().min(1).max(64) })

function sendTmuxError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof TmuxError) {
    if (error.code === 'NO_SERVER') {
      res.status(503).json({ success: false, error: 'tmux server 未运行' })
      return
    }
    if (/duplicate session/i.test(error.message)) {
      res.status(409).json({ success: false, error: '同名 session 已存在' })
      return
    }
    if (/can't find session|session not found/i.test(error.message)) {
      res.status(404).json({ success: false, error: 'session 不存在' })
      return
    }
  }
  console.error(fallback, error)
  res.status(500).json({ success: false, error: fallback })
}

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

  router.post('/sessions', requireAuth(deps.store), async (req, res) => {
    const parsed = sessionNameSchema.safeParse(req.body)
    const nameErr = parsed.success ? sessionNameError(parsed.data.name) : '请求格式错误'
    if (!parsed.success || nameErr) {
      res.status(400).json({ success: false, error: nameErr ?? '请求格式错误' })
      return
    }
    try {
      await createSession(deps.exec, parsed.data.name)
      res.status(201).json({ success: true })
    } catch (error) {
      sendTmuxError(res, error, '创建 session 失败')
    }
  })

  router.delete('/sessions/:name', requireAuth(deps.store), async (req, res) => {
    const name = req.params.name
    const nameErr = sessionNameError(name)
    if (nameErr) {
      res.status(400).json({ success: false, error: nameErr })
      return
    }
    try {
      await killSession(deps.exec, name)
      res.json({ success: true })
    } catch (error) {
      sendTmuxError(res, error, '删除 session 失败')
    }
  })

  router.patch('/sessions/:name', requireAuth(deps.store), async (req, res) => {
    const parsed = sessionNameSchema.safeParse(req.body)
    const targetErr = sessionNameError(req.params.name)
    const newErr = parsed.success ? sessionNameError(parsed.data.name) : '请求格式错误'
    if (!parsed.success || targetErr || newErr) {
      res.status(400).json({ success: false, error: targetErr ?? newErr ?? '请求格式错误' })
      return
    }
    try {
      await renameSession(deps.exec, req.params.name, parsed.data.name)
      res.json({ success: true })
    } catch (error) {
      sendTmuxError(res, error, '重命名 session 失败')
    }
  })

  return router
}
