import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeQuotaProvider } from '../../src/planUsage/claudeQuota.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NOW = Date.parse('2026-08-13T08:00:00Z')

async function credentialsFile(content: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-claude-quota-'))
  roots.push(root)
  const file = path.join(root, '.credentials.json')
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
  return file
}

async function accountFileNextTo(credentials: string, content: unknown): Promise<string> {
  const file = path.join(path.dirname(credentials), 'account.json')
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
  return file
}

function validCredentials(overrides: Record<string, unknown> = {}): unknown {
  return {
    claudeAiOauth: {
      accessToken: 'tok-secret',
      refreshToken: 'refresh-secret',
      expiresAt: NOW + 3600_000,
      subscriptionType: 'max',
      ...overrides,
    },
  }
}

function usageResponse(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch
}

describe('createClaudeQuotaProvider', () => {
  it('凭据文件不存在时报告 unavailable，且不发请求', async () => {
    const fetchImpl = usageResponse({})
    const provider = createClaudeQuotaProvider({
      credentialsFile: '/nonexistent/.credentials.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.providerId).toBe('claude-quota')
    expect(usage.status).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('access token 已过期时不发请求，报告 error', async () => {
    const fetchImpl = usageResponse({})
    const file = await credentialsFile(validCredentials({ expiresAt: NOW - 1000 }))
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.status).toBe('error')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('把 utilization 响应映射为 quota 窗口', async () => {
    const resetsAt = '2026-08-13T10:00:00Z'
    const fetchImpl = usageResponse({
      five_hour: { utilization: 23.4, resets_at: resetsAt },
      seven_day: { utilization: 11, resets_at: '2026-08-18T00:00:00Z' },
    })
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    expect(usage.planType).toBe('max')
    expect(usage.windows).toHaveLength(2)
    const fiveHour = usage.windows.find((w) => w.label === '5h')
    if (fiveHour?.kind !== 'quota') throw new Error('expected 5h quota window')
    expect(fiveHour.usedPercent).toBe(23.4)
    expect(fiveHour.resetsAt).toBe(Date.parse(resetsAt))
    expect(fiveHour.windowMinutes).toBe(300)
    expect(fiveHour.state).toBe('observed')
    const weekly = usage.windows.find((w) => w.label === 'weekly')
    if (weekly?.kind !== 'quota') throw new Error('expected weekly quota window')
    expect(weekly.usedPercent).toBe(11)
    expect(weekly.windowMinutes).toBe(10080)
  })

  it('未知窗口键被丢弃，数字秒时间戳可解析', async () => {
    const fetchImpl = usageResponse({
      five_hour: { utilization: 5, resets_at: Math.floor(NOW / 1000) + 3600 },
      nimbus_quill: { utilization: 0 },
      not_a_window: 'ignore me',
    })
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.windows).toHaveLength(1)
    const win = usage.windows[0]
    if (win.kind !== 'quota') throw new Error('expected quota window')
    expect(win.label).toBe('5h')
    expect(win.resetsAt).toBe((Math.floor(NOW / 1000) + 3600) * 1000)
  })

  it('请求发送 Bearer token 与 anthropic-beta 头', async () => {
    const fetchImpl = usageResponse({ five_hour: { utilization: 1 } })
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    await provider.collect()
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-secret')
    expect(headers['anthropic-beta']).toBeDefined()
  })

  it('HTTP 非 200 时报告 error，不外泄响应内容', async () => {
    const fetchImpl = usageResponse({ error: 'token revoked, user id abc' }, 401)
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.status).toBe('error')
    expect(JSON.stringify(usage)).not.toContain('abc')
  })

  it('响应里没有任何可识别窗口时报告 unavailable', async () => {
    const fetchImpl = usageResponse({ something: 'else' })
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.status).toBe('unavailable')
  })

  it('rate limit tier 存在时细分计划名（max 20x）', async () => {
    const fetchImpl = usageResponse({ five_hour: { utilization: 1 } })
    const file = await credentialsFile(validCredentials())
    const account = await accountFileNextTo(file, {
      oauthAccount: { organizationRateLimitTier: 'default_claude_max_20x' },
    })
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: account,
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.planType).toBe('max 20x')
  })

  it('userRateLimitTier 优先于 organizationRateLimitTier', async () => {
    const fetchImpl = usageResponse({ five_hour: { utilization: 1 } })
    const file = await credentialsFile(validCredentials())
    const account = await accountFileNextTo(file, {
      oauthAccount: {
        userRateLimitTier: 'claude_max_5x',
        organizationRateLimitTier: 'default_claude_max_20x',
      },
    })
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: account,
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.planType).toBe('max 5x')
  })

  it('account 文件缺失或损坏时回退到订阅类型', async () => {
    const fetchImpl = usageResponse({ five_hour: { utilization: 1 } })
    const file = await credentialsFile(validCredentials())
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: path.join(path.dirname(file), 'missing.json'),
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.planType).toBe('max')

    const broken = await accountFileNextTo(file, 'not json')
    const provider2 = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: broken,
      fetchImpl: usageResponse({ five_hour: { utilization: 1 } }),
      now: () => NOW,
    })
    expect((await provider2.collect()).planType).toBe('max')
  })

  it('凭据文件损坏时报告 error，不发请求', async () => {
    const fetchImpl = usageResponse({})
    const file = await credentialsFile('not json')
    const provider = createClaudeQuotaProvider({
      credentialsFile: file,
      accountFile: '/nonexistent/account.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.status).toBe('error')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
