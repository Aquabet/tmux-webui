import type { AddressInfo } from 'node:net'
import { describe, expect, it, afterEach } from 'vitest'
import type { Server } from 'node:http'
import { hashPassword } from '../src/auth/password.js'
import type { Config } from '../src/config.js'
import { createAppServer } from '../src/server.js'

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
    }
    server = createAppServer(config)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
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
    }
    server = createAppServer(config)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const html = await fetch(`http://127.0.0.1:${port}/`)
    expect(html.headers.get('cache-control')).toBe('no-cache')
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
    }
    server = createAppServer(config)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/other`)
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true))
      ws.on('open', () => resolve(false))
    })
    expect(failed).toBe(true)
  })
})
