import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookieParser from 'cookie-parser'
import express from 'express'
import { WebSocketServer } from 'ws'
import { createRateLimiter } from './auth/rateLimit.js'
import { createSessionStore } from './auth/sessions.js'
import type { Config } from './config.js'
import { createApiRouter } from './http/api.js'
import { spawnNodePty } from './pty.js'
import { createTmuxExec } from './tmux/exec.js'
import { createUpdateChecker } from './update.js'
import { createSystemResourceSampler } from './systemResources.js'
import { handleTerminalConnection, MAX_WS_MESSAGE_BYTES, type SpawnPty } from './ws/terminal.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

export function createAppServer(config: Config, spawnPty: SpawnPty = spawnNodePty): http.Server {
  const exec = createTmuxExec(config.socketName)
  const store = createSessionStore(config.sessionTtlMs, Date.now, config.sessionFile)
  const limiter = createRateLimiter(5, 60_000)

  const app = express()
  // 本服务设计为跑在本机反代/Tailscale 之后：只信任来自回环地址的 X-Forwarded-For，
  // 这样限速器拿到的 req.ip 是真实客户端 IP，远程直连伪造的 XFF 不会被信任。
  app.set('trust proxy', 'loopback')
  app.use((_req, res, next) => {
    res.setHeader('content-security-policy', CONTENT_SECURITY_POLICY)
    res.setHeader('x-frame-options', 'DENY')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    next()
  })
  app.use(cookieParser())
  const checkUpdate = createUpdateChecker({
    current: packageVersion(),
    enabled: config.updateCheck,
  })
  const getSystemResources = createSystemResourceSampler()
  // dist/ 的上一级即仓库根，update.sh 和 package.json 都在那里
  const repoRoot = path.resolve(__dirname, '..')
  app.use(
    '/api',
    createApiRouter({ config, store, limiter, exec, checkUpdate, getSystemResources, repoRoot }),
  )

  const staticDir = path.resolve(__dirname, '../web/dist')
  if (existsSync(staticDir)) {
    // index.html 必须每次向服务器校验（no-cache），否则重新构建部署后浏览器
    // 会继续用启发式缓存的旧页面；带 hash 的 assets 内容不可变，可永久缓存
    app.use(
      express.static(staticDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('cache-control', 'no-cache')
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('cache-control', 'public, max-age=31536000, immutable')
          }
        },
      }),
    )
    app.get('*', (_req, res) =>
      res.sendFile(path.join(staticDir, 'index.html'), {
        headers: { 'cache-control': 'no-cache' },
      }),
    )
  }

  const server = http.createServer(app)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_BYTES })
  wss.on('error', (error) => console.error('WebSocketServer 错误:', error))
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/terminal')) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, req, {
        exec,
        store,
        spawnPty,
        socketName: config.socketName,
      })
    })
  })
  return server
}
