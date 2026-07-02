import cookieParser from 'cookie-parser'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { hashPassword } from '../../src/auth/password.js'
import { createRateLimiter } from '../../src/auth/rateLimit.js'
import { createSessionStore } from '../../src/auth/sessions.js'
import type { Config } from '../../src/config.js'
import { createApiRouter } from '../../src/http/api.js'
import { TmuxError, type TmuxExec } from '../../src/tmux/exec.js'

const SESSIONS_OUT = 'demo\t1\n'
const WINDOWS_OUT = 'demo\t0\tclaude\t1\n'

async function makeApp(overrides: { exec?: TmuxExec; limiterMax?: number } = {}) {
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    passwordHash: await hashPassword('pw'),
    socketName: undefined,
    sessionTtlMs: 60_000,
    cookieSecure: false,
  }
  const exec: TmuxExec =
    overrides.exec ??
    (async (args) => (args[0] === 'list-sessions' ? SESSIONS_OUT : WINDOWS_OUT))
  const app = express()
  app.use(cookieParser())
  app.use(
    '/api',
    createApiRouter({
      config,
      store: createSessionStore(60_000),
      limiter: createRateLimiter(overrides.limiterMax ?? 100, 60_000),
      exec,
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
    expect(calls).toContainEqual(['new-session', '-d', '-s', 'dev'])
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
