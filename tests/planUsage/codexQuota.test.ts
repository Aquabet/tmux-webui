import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCodexQuotaProvider } from '../../src/planUsage/codexQuota.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const NOW = Date.parse('2026-08-13T08:00:00Z')

async function authFile(content: unknown): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-codex-quota-'))
  roots.push(root)
  const file = path.join(root, 'auth.json')
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
  return file
}

function validAuth(): unknown {
  return {
    account_id: 'acc-legacy',
    tokens: { access_token: 'tok-secret', account_id: 'acc-123' },
  }
}

function usageResponse(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch
}

describe('createCodexQuotaProvider', () => {
  it('auth 文件不存在时报告 unavailable，且不发请求', async () => {
    const fetchImpl = usageResponse({})
    const provider = createCodexQuotaProvider({
      authFile: '/nonexistent/auth.json',
      fetchImpl,
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.providerId).toBe('codex-quota')
    expect(usage.status).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('auth 损坏或缺 token 时报告 error，不发请求', async () => {
    const fetchImpl = usageResponse({})
    const broken = await authFile('not json')
    const provider = createCodexQuotaProvider({ authFile: broken, fetchImpl, now: () => NOW })
    expect((await provider.collect()).status).toBe('error')

    const empty = await authFile({ tokens: { access_token: '' } })
    const provider2 = createCodexQuotaProvider({ authFile: empty, fetchImpl, now: () => NOW })
    expect((await provider2.collect()).status).toBe('error')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('映射 rate_limit 主/次窗口与计划名', async () => {
    const fetchImpl = usageResponse({
      plan_type: 'pro_20x',
      rate_limit: {
        primary: {
          used_percent: 5,
          limit_window_seconds: 604800,
          resets_at: Math.floor(NOW / 1000) + 3600,
        },
        secondary: { used_percent: 12, window_minutes: 300 },
      },
    })
    const file = await authFile(validAuth())
    const provider = createCodexQuotaProvider({ authFile: file, fetchImpl, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    expect(usage.planType).toBe('pro 20x')
    expect(usage.windows).toHaveLength(2)
    const weekly = usage.windows.find((w) => w.label === 'weekly')
    if (weekly?.kind !== 'quota') throw new Error('expected weekly quota window')
    expect(weekly.usedPercent).toBe(5)
    expect(weekly.windowMinutes).toBe(10080)
    expect(weekly.resetsAt).toBe((Math.floor(NOW / 1000) + 3600) * 1000)
    const fiveHour = usage.windows.find((w) => w.label === '5h')
    if (fiveHour?.kind !== 'quota') throw new Error('expected 5h quota window')
    expect(fiveHour.usedPercent).toBe(12)
  })

  it('顶层缺 rate_limit 时回退 rate_limit_status', async () => {
    const fetchImpl = usageResponse({
      rate_limit_status: {
        plan_type: 'plus',
        rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18000 } },
      },
    })
    const file = await authFile(validAuth())
    const provider = createCodexQuotaProvider({ authFile: file, fetchImpl, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    expect(usage.planType).toBe('plus')
    expect(usage.windows[0].label).toBe('5h')
    expect(usage.windows[0].usedPercent).toBe(30)
  })

  it('请求携带 Bearer token 与 ChatGPT-Account-Id', async () => {
    const fetchImpl = usageResponse({ rate_limit: { primary: { used_percent: 1 } } })
    const file = await authFile(validAuth())
    const provider = createCodexQuotaProvider({ authFile: file, fetchImpl, now: () => NOW })
    await provider.collect()
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-secret')
    // tokens.account_id 优先于顶层 account_id
    expect(headers['ChatGPT-Account-Id']).toBe('acc-123')
  })

  it('HTTP 非 200 时报告 error，不外泄响应内容', async () => {
    const fetchImpl = usageResponse({ error: 'secret detail xyz' }, 401)
    const file = await authFile(validAuth())
    const provider = createCodexQuotaProvider({ authFile: file, fetchImpl, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('error')
    expect(JSON.stringify(usage)).not.toContain('xyz')
  })

  it('响应无可识别窗口时报告 unavailable', async () => {
    const fetchImpl = usageResponse({ plan_type: 'pro' })
    const file = await authFile(validAuth())
    const provider = createCodexQuotaProvider({ authFile: file, fetchImpl, now: () => NOW })
    expect((await provider.collect()).status).toBe('unavailable')
  })
})
