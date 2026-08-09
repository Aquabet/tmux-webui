import { Router, json, raw, type Response } from 'express'
import { z } from 'zod'
import { verifyPassword } from '../auth/password.js'
import type { RateLimiter } from '../auth/rateLimit.js'
import type { SessionStore } from '../auth/sessions.js'
import type { Config } from '../config.js'
import { TmuxError, type TmuxExec } from '../tmux/exec.js'
import { listSessions } from '../tmux/list.js'
import { createSession, killSession, renameSession, sessionNameError } from '../tmux/manage.js'
import { canSelfUpdate, startUpdateSession } from '../selfUpdate.js'
import type { SystemResources } from '../systemResources.js'
import type { UpdateInfo } from '../update.js'
import { createImageUploadStore, type ImageExtension, UploadQuotaError } from '../uploads.js'
import { COOKIE_NAME, requireAuth } from './middleware.js'

interface ApiDeps {
  config: Config
  store: SessionStore
  limiter: RateLimiter
  exec: TmuxExec
  checkUpdate: () => Promise<UpdateInfo>
  getSystemResources: () => SystemResources
  repoRoot: string
}

const loginSchema = z.object({ password: z.string().min(1).max(200) })
const sessionNameSchema = z.object({ name: z.string().min(1).max(64) })

// 白名单 mime → 扩展名；文件名完全由服务端生成，客户端无法影响路径
const IMAGE_EXT: Record<string, ImageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function sendTmuxError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof TmuxError) {
    if (error.code === 'NOT_INSTALLED') {
      res.status(503).json({ success: false, error: error.message })
      return
    }
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
  const uploadStore = createImageUploadStore({
    dir: deps.config.uploadDir,
    retentionMs: deps.config.uploadRetentionMs,
    maxBytes: deps.config.uploadMaxBytes,
  })
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

  // 上传图片存盘，返回绝对路径。用途：把路径粘进终端输入，
  // Claude Code 等 CLI 会自行读取消息中提到的图片文件
  router.post(
    '/upload',
    requireAuth(deps.store),
    raw({ type: 'image/*', limit: '15mb' }),
    async (req, res) => {
      const ext = IMAGE_EXT[req.headers['content-type'] ?? '']
      if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ success: false, error: '仅支持 png/jpeg/webp/gif 图片' })
        return
      }
      try {
        const file = await uploadStore.save(req.body, ext)
        res.json({ success: true, data: { path: file } })
      } catch (error) {
        if (error instanceof UploadQuotaError) {
          res.status(507).json({ success: false, error: error.message })
          return
        }
        console.error('保存上传图片失败:', error)
        res.status(500).json({ success: false, error: '保存图片失败' })
      }
    },
  )

  // 放在鉴权后：未登录的人没必要知道这台机器跑的什么版本
  router.get('/version', requireAuth(deps.store), async (_req, res) => {
    const info = await deps.checkUpdate()
    res.json({ success: true, data: { ...info, canUpdate: canSelfUpdate(deps.repoRoot) } })
  })

  // 主机资源同样放在鉴权后：它虽不含 shell 内容，仍属于不该公开的运行状态。
  router.get('/resources', requireAuth(deps.store), (_req, res) => {
    res.json({ success: true, data: deps.getSystemResources() })
  })

  // 一键更新：在独立 tmux session 里跑仓库自带的 update.sh。命令固定，
  // 不接受请求里的任何参数——这个端点等价于远程执行代码，可控面必须为零
  router.post('/update', requireAuth(deps.store), async (_req, res) => {
    try {
      res.json({ success: true, data: await startUpdateSession(deps.exec, deps.repoRoot) })
    } catch (error) {
      if (error instanceof TmuxError) {
        sendTmuxError(res, error, '启动更新失败')
        return
      }
      // 脚本缺失、已有更新在跑：都是用户可理解的状态，原样回传
      res.status(409).json({
        success: false,
        error: error instanceof Error ? error.message : '启动更新失败',
      })
    }
  })

  router.get('/sessions', requireAuth(deps.store), async (_req, res) => {
    try {
      const data = await listSessions(deps.exec)
      res.json({ success: true, data })
    } catch (error) {
      sendTmuxError(res, error, '获取会话列表失败')
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
