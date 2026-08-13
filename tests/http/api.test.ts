import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../src/auth/password.js'
import { createRateLimiter } from '../../src/auth/rateLimit.js'
import { createSessionStore } from '../../src/auth/sessions.js'
import type { Config } from '../../src/config.js'
import { createApiRouter } from '../../src/http/api.js'
import type { PlanUsageReport } from '../../src/planUsage/types.js'
import type { SystemResources } from '../../src/systemResources.js'
import { TmuxError, type TmuxExec } from '../../src/tmux/exec.js'

const USAGE_REPORT: PlanUsageReport = {
  schemaVersion: 1,
  collectedAt: 1000,
  providers: [
    {
      providerId: 'codex',
      displayName: 'Codex',
      status: 'ok',
      planType: 'pro',
      windows: [
        {
          kind: 'quota',
          label: 'weekly',
          usedPercent: 12,
          windowMinutes: 10080,
          resetsAt: 2000,
          observedAt: 900,
          state: 'observed',
        },
      ],
      lastActivityAt: 900,
    },
  ],
}

const SESSIONS_OUT = 'demo\t1\n'
const WINDOWS_OUT = 'demo\t0\tclaude\t1\n'
const PANES_OUT = 'demo\t%0\tclaude\tclaude\tidle\n'

const UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'webui-upload-'))
// 真仓库根：scripts/update.sh 确实存在且可执行
const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
afterAll(() => rmSync(UPLOAD_DIR, { recursive: true, force: true }))

async function makeApp(
  overrides: {
    exec?: TmuxExec
    limiterMax?: number
    repoRoot?: string
    getSystemResources?: () => SystemResources
    collectPlanUsage?: () => Promise<PlanUsageReport>
    config?: Partial<Config>
  } = {},
) {
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    passwordHash: await hashPassword('pw'),
    socketName: undefined,
    sessionTtlMs: 60_000,
    cookieSecure: false,
    sessionFile: '',
    uploadDir: UPLOAD_DIR,
    uploadRetentionMs: 60_000,
    uploadMaxBytes: 20 * 1024 * 1024,
    updateCheck: false,
    usageProviders: [],
    ...overrides.config,
  }
  const exec: TmuxExec =
    overrides.exec ??
    (async (args) => {
      if (args[0] === 'list-sessions') return SESSIONS_OUT
      if (args[0] === 'list-windows') return WINDOWS_OUT
      return PANES_OUT
    })
  const app = express()
  app.use(cookieParser())
  app.use(
    '/api',
    createApiRouter({
      config,
      store: createSessionStore(60_000),
      limiter: createRateLimiter(overrides.limiterMax ?? 100, 60_000),
      exec,
      checkUpdate: async () => ({
        current: '0.1.0',
        latest: null,
        url: null,
        updateAvailable: false,
      }),
      getSystemResources:
        overrides.getSystemResources ??
        (() => ({
          cpuPercent: 25,
          cpuCount: 4,
          memoryUsedBytes: 3_000,
          memoryTotalBytes: 8_000,
          memoryPercent: 37.5,
        })),
      collectPlanUsage: overrides.collectPlanUsage ?? (async () => USAGE_REPORT),
      // 默认指向一个没有 update.sh 的目录：一键更新按不可用处理
      repoRoot: overrides.repoRoot ?? UPLOAD_DIR,
    }),
  )
  return app
}

async function loginAgent(app: express.Express) {
  const agent = request.agent(app)
  await agent.post('/api/login').send({ password: 'pw' }).expect(200)
  return agent
}

describe('POST /api/login', () => {
  it('密码正确返回 200 并设置 httpOnly cookie', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({ password: 'pw' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    const cookie = res.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('webui_token=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('密码错误返回 401', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({ password: 'wrong' })
    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('请求体非法返回 400', async () => {
    const app = await makeApp()
    const res = await request(app).post('/api/login').send({})
    expect(res.status).toBe(400)
  })

  it('超过限速返回 429', async () => {
    const app = await makeApp({ limiterMax: 1 })
    await request(app).post('/api/login').send({ password: 'wrong' })
    const res = await request(app).post('/api/login').send({ password: 'pw' })
    expect(res.status).toBe(429)
  })
})

describe('GET /api/sessions', () => {
  it('未认证返回 401', async () => {
    const app = await makeApp()
    const res = await request(app).get('/api/sessions')
    expect(res.status).toBe(401)
  })

  it('/version 需要登录，认证后返回版本与更新信息', async () => {
    const app = await makeApp()
    expect((await request(app).get('/api/version')).status).toBe(401)
    const agent = await loginAgent(app)
    const res = await agent.get('/api/version')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: {
        current: '0.1.0',
        latest: null,
        url: null,
        updateAvailable: false,
        canUpdate: false,
      },
    })
  })

  it('/usage 需要登录，认证后返回计划用量报告且禁止缓存', async () => {
    const app = await makeApp()
    expect((await request(app).get('/api/usage')).status).toBe(401)
    const agent = await loginAgent(app)
    const res = await agent.get('/api/usage')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: USAGE_REPORT })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('/usage 采集抛错时返回 500 且不泄露细节', async () => {
    const app = await makeApp({
      collectPlanUsage: async () => {
        throw new Error('secret /home/user path')
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.get('/api/usage')
    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('/resources 需要登录，认证后返回系统 CPU 与 RAM 占用', async () => {
    const app = await makeApp()
    expect((await request(app).get('/api/resources')).status).toBe(401)
    const agent = await loginAgent(app)
    expect((await agent.get('/api/resources')).body).toEqual({
      success: true,
      data: {
        cpuPercent: 25,
        cpuCount: 4,
        memoryUsedBytes: 3_000,
        memoryTotalBytes: 8_000,
        memoryPercent: 37.5,
      },
    })
  })

  it('仓库里有 update.sh 时 canUpdate 为真', async () => {
    const agent = await loginAgent(await makeApp({ repoRoot: REPO_ROOT }))
    expect((await agent.get('/api/version')).body.data.canUpdate).toBe(true)
  })

  it('/update 需要登录，认证后在独立 session 里拉起更新脚本', async () => {
    const calls: string[][] = []
    const exec: TmuxExec = async (args) => {
      calls.push(args)
      if (args[0] === 'has-session') throw new TmuxError('FAILED', "can't find session")
      return ''
    }
    const app = await makeApp({ exec, repoRoot: REPO_ROOT })
    expect((await request(app).post('/api/update')).status).toBe(401)

    const agent = await loginAgent(app)
    const res = await agent.post('/api/update')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { session: 'tmux-webui-update' } })
    expect(calls.some((c) => c[0] === 'new-session' && c.includes('tmux-webui-update'))).toBe(true)
  })

  it('/update 在没有 update.sh 的部署里返回 409 而不是 500', async () => {
    const agent = await loginAgent(await makeApp())
    const res = await agent.post('/api/update')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/update\.sh/)
  })

  it('/update 在更新已在进行时返回 409', async () => {
    const exec: TmuxExec = async (args) => {
      if (args[0] === 'list-panes') return '0\tif ./scripts/update.sh --yes; then ...\n'
      if (args[0] === 'show-options') return 'managed\n'
      // has-session 成功 = 会话已存在
      return ''
    }
    const agent = await loginAgent(await makeApp({ exec, repoRoot: REPO_ROOT }))
    const res = await agent.post('/api/update')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/已在进行/)
  })

  it('认证后返回 session 树', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    const res = await agent.get('/api/sessions')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      success: true,
      data: [
        {
          name: 'demo',
          attached: true,
          windows: [{ index: 0, name: 'claude', active: true }],
          agents: [{ kind: 'claude' }],
        },
      ],
    })
  })

  it('tmux server 未运行返回 503', async () => {
    const app = await makeApp({
      exec: async () => {
        throw new TmuxError('NO_SERVER', 'tmux server 未运行')
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.get('/api/sessions')
    expect(res.status).toBe(503)
    expect(res.body.error).toContain('tmux')
  })
})

describe('POST /api/sessions', () => {
  it('未认证返回 401', async () => {
    const app = await makeApp()
    await request(app).post('/api/sessions').send({ name: 'dev' }).expect(401)
  })

  it('创建成功返回 201 并调用 new-session', async () => {
    const calls: string[][] = []
    const app = await makeApp({
      exec: async (args) => {
        calls.push(args)
        return ''
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.post('/api/sessions').send({ name: 'dev' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ success: true })
    // -c 起始目录由 createSession 决定，这里只断言路由确实建了这个 session
    expect(calls.some((args) => args.slice(0, 4).join(' ') === 'new-session -d -s dev')).toBe(true)
  })

  it('名称含冒号或 webui- 前缀返回 400', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.post('/api/sessions').send({ name: 'a:b' }).expect(400)
    await agent.post('/api/sessions').send({ name: 'webui-x' }).expect(400)
    await agent.post('/api/sessions').send({}).expect(400)
  })

  it('同名会话已存在返回 409', async () => {
    const app = await makeApp({
      exec: async () => {
        throw new TmuxError('FAILED', 'duplicate session: dev')
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.post('/api/sessions').send({ name: 'dev' })
    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })
})

describe('DELETE /api/sessions/:name', () => {
  it('未认证返回 401', async () => {
    const app = await makeApp()
    await request(app).delete('/api/sessions/dev').expect(401)
  })

  it('删除成功并用精确匹配目标', async () => {
    const calls: string[][] = []
    const app = await makeApp({
      exec: async (args) => {
        calls.push(args)
        return ''
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.delete('/api/sessions/dev')
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(['kill-session', '-t', '=dev'])
  })

  it('会话不存在返回 404', async () => {
    const app = await makeApp({
      exec: async () => {
        throw new TmuxError('FAILED', "can't find session: nope")
      },
    })
    const agent = await loginAgent(app)
    await agent.delete('/api/sessions/nope').expect(404)
  })

  it('删除 webui- 内部视图返回 400', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.delete('/api/sessions/webui-abc12345').expect(400)
  })
})

describe('PATCH /api/sessions/:name', () => {
  it('未认证返回 401', async () => {
    const app = await makeApp()
    await request(app).patch('/api/sessions/dev').send({ name: 'work' }).expect(401)
  })

  it('改名成功并用精确匹配旧名称', async () => {
    const calls: string[][] = []
    const app = await makeApp({
      exec: async (args) => {
        calls.push(args)
        return ''
      },
    })
    const agent = await loginAgent(app)
    const res = await agent.patch('/api/sessions/dev').send({ name: 'work' })
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(['rename-session', '-t', '=dev', 'work'])
  })

  it('新名称非法返回 400', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.patch('/api/sessions/dev').send({ name: 'a.b' }).expect(400)
    await agent.patch('/api/sessions/dev').send({ name: 'webui-x' }).expect(400)
    await agent.patch('/api/sessions/dev').send({}).expect(400)
  })

  it('会话不存在返回 404', async () => {
    const app = await makeApp({
      exec: async () => {
        throw new TmuxError('FAILED', "can't find session: nope")
      },
    })
    const agent = await loginAgent(app)
    await agent.patch('/api/sessions/nope').send({ name: 'work' }).expect(404)
  })
})

describe('POST /api/logout', () => {
  it('登出后原 cookie 失效', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.post('/api/logout').expect(200)
    await agent.get('/api/sessions').expect(401)
  })
})

describe('POST /api/upload', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex')

  it('未登录返回 401', async () => {
    const app = await makeApp()
    await request(app).post('/api/upload').set('content-type', 'image/png').send(PNG).expect(401)
  })

  it('保存图片到 uploadDir 并返回绝对路径', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    const res = await agent.post('/api/upload').set('content-type', 'image/png').send(PNG)
    expect(res.status).toBe(200)
    const saved = res.body.data.path as string
    expect(saved.startsWith(UPLOAD_DIR)).toBe(true)
    expect(saved.endsWith('.png')).toBe(true)
    expect(existsSync(saved)).toBe(true)
    expect(readFileSync(saved).equals(PNG)).toBe(true)
  })

  it('jpeg 扩展名为 .jpg', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    const res = await agent.post('/api/upload').set('content-type', 'image/jpeg').send(PNG)
    expect(res.status).toBe(200)
    expect((res.body.data.path as string).endsWith('.jpg')).toBe(true)
  })

  it.each([
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
  ])('%s 保持受支持并使用正确扩展名', async (contentType, extension) => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    const res = await agent.post('/api/upload').set('content-type', contentType).send(PNG)
    expect(res.status).toBe(200)
    expect((res.body.data.path as string).endsWith(extension)).toBe(true)
  })

  it('非图片类型返回 400', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.post('/api/upload').set('content-type', 'text/plain').send('hi').expect(400)
    await agent.post('/api/upload').set('content-type', 'image/svg+xml').send('<svg/>').expect(400)
  })

  it('空 body 返回 400', async () => {
    const app = await makeApp()
    const agent = await loginAgent(app)
    await agent.post('/api/upload').set('content-type', 'image/png').expect(400)
  })

  it('图片总量超过配置配额时返回 507', async () => {
    const app = await makeApp({ config: { uploadMaxBytes: PNG.length - 1 } })
    const agent = await loginAgent(app)
    const res = await agent.post('/api/upload').set('content-type', 'image/png').send(PNG)
    expect(res.status).toBe(507)
    expect(res.body.error).toMatch(/存储空间已满/)
  })

  it('存储路径不可用时返回 500', async () => {
    const invalidDir = path.join(UPLOAD_DIR, 'upload-path-is-file')
    writeFileSync(invalidDir, 'not a directory')
    const app = await makeApp({ config: { uploadDir: invalidDir } })
    const agent = await loginAgent(app)

    const res = await agent.post('/api/upload').set('content-type', 'image/png').send(PNG)

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('保存图片失败')
  })
})
