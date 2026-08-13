import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { hashPassword } from '../src/auth/password.js'
import type { Config } from '../src/config.js'
import { createAppServer } from '../src/server.js'
import { createTmuxExec } from '../src/tmux/exec.js'
import { MAX_WS_MESSAGE_BYTES, type SpawnPty } from '../src/ws/terminal.js'

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

describe('createAppServer', () => {
  it('启动后 /api/login 可用（装配完整性冒烟测试）', async () => {
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName: 'webui-server-test-none',
      sessionTtlMs: 60_000,
      cookieSecure: false,
      sessionFile: '',
      uploadDir: '/tmp/webui-test-uploads',
      uploadRetentionMs: 60_000,
      uploadMaxBytes: 20 * 1024 * 1024,
      updateCheck: false,
      usageProviders: [],
    }
    server = createAppServer(config)
    const activeServer = server
    await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'pw' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  })

  it('index.html 响应 no-cache，hash 资源响应 immutable（防止发布后浏览器用旧页面）', async () => {
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName: 'webui-server-test-none',
      sessionTtlMs: 60_000,
      cookieSecure: false,
      sessionFile: '',
      uploadDir: '/tmp/webui-test-uploads',
      uploadRetentionMs: 60_000,
      uploadMaxBytes: 20 * 1024 * 1024,
      updateCheck: false,
      usageProviders: [],
    }
    // 静态资源只在 web/dist 存在时才挂载，缺了这里会以「cache-control 是 null」
    // 的形式失败，看不出真正原因，所以先显式检查
    expect(
      existsSync(path.resolve(import.meta.dirname, '../web/dist/index.html')),
      '需要先 npm run build：未构建前端时服务不挂载静态资源，本用例无从断言',
    ).toBe(true)

    server = createAppServer(config)
    const activeServer = server
    await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const html = await fetch(`http://127.0.0.1:${port}/`)
    expect(html.headers.get('cache-control')).toBe('no-cache')
    expect(html.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(html.headers.get('x-frame-options')).toBe('DENY')
    expect(html.headers.get('x-content-type-options')).toBe('nosniff')
    expect(html.headers.get('referrer-policy')).toBe('no-referrer')
    expect(html.headers.get('strict-transport-security')).toBeNull()
    const htmlDeep = await fetch(`http://127.0.0.1:${port}/some/spa/route`)
    expect(htmlDeep.headers.get('cache-control')).toBe('no-cache')
    // 构建产物存在时校验 assets 的长缓存头
    const assetPath = (await html.text()).match(/src="(\/assets\/[^"]+)"/)?.[1]
    if (assetPath) {
      const asset = await fetch(`http://127.0.0.1:${port}${assetPath}`)
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    }
  })

  it('非 /ws/terminal 的 upgrade 请求被拒绝', async () => {
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName: 'webui-server-test-none',
      sessionTtlMs: 60_000,
      cookieSecure: false,
      sessionFile: '',
      uploadDir: '/tmp/webui-test-uploads',
      uploadRetentionMs: 60_000,
      uploadMaxBytes: 20 * 1024 * 1024,
      updateCheck: false,
      usageProviders: [],
    }
    server = createAppServer(config)
    const activeServer = server
    await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/other`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })
    expect(failed).toBe(true)
  })

  it('超过 1 MiB 的 WebSocket 消息由真实服务以 1009 拒绝', async () => {
    const socketName = `webui-server-max-payload-${process.pid}`
    const exec = createTmuxExec(socketName)
    await exec(['new-session', '-d', '-s', 'demo'])
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      passwordHash: await hashPassword('pw'),
      socketName,
      sessionTtlMs: 60_000,
      cookieSecure: false,
      sessionFile: '',
      uploadDir: '/tmp/webui-test-uploads',
      uploadRetentionMs: 60_000,
      uploadMaxBytes: 20 * 1024 * 1024,
      updateCheck: false,
      usageProviders: [],
    }
    const spawnPty: SpawnPty = () => ({
      onData: () => undefined,
      onExit: () => undefined,
      write: () => undefined,
      resize: () => undefined,
      kill: () => undefined,
    })

    try {
      server = createAppServer(config, spawnPty)
      const activeServer = server
      await new Promise<void>((resolve) => activeServer.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'pw' }),
      })
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toContain('webui_token=')

      const { WebSocket } = await import('ws')
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/terminal?session=demo`, {
        headers: { cookie: cookie ?? '' },
      })
      ws.on('error', () => undefined)
      const closed = new Promise<number>((resolve) => ws.on('close', resolve))
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve)
        ws.on('error', reject)
      })
      ws.send(Buffer.alloc(MAX_WS_MESSAGE_BYTES + 1))

      expect(await closed).toBe(1009)
    } finally {
      await exec(['kill-server']).catch(() => undefined)
    }
  })
})
