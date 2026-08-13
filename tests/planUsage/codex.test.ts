import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCodexProvider } from '../../src/planUsage/codex.js'

const roots: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'tmux-webui-codex-'))
  roots.push(root)
  return root
}

// 2026-08-13T08:00:00Z
const NOW = Date.parse('2026-08-13T08:00:00Z')

function rateLimitLine(options: {
  timestamp: string
  usedPercent: number
  windowMinutes?: number
  resetsAt?: number
  planType?: string
  secondary?: { used_percent: number; window_minutes: number; resets_at: number } | null
}): string {
  return `${JSON.stringify({
    timestamp: options.timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { total_tokens: 1000 } },
      rate_limits: {
        limit_id: 'codex',
        primary: {
          used_percent: options.usedPercent,
          window_minutes: options.windowMinutes ?? 10080,
          resets_at: options.resetsAt ?? Math.floor(NOW / 1000) + 3600,
        },
        secondary: options.secondary ?? null,
        plan_type: options.planType ?? 'pro',
      },
    },
  })}\n`
}

async function writeRollout(root: string, day: string, name: string, content: string) {
  const dir = path.join(root, ...day.split('-'))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), content)
}

describe('createCodexProvider', () => {
  it('目录不存在时报告 unavailable', async () => {
    const root = await tempRoot()
    const provider = createCodexProvider({
      sessionsDir: path.join(root, 'missing'),
      now: () => NOW,
    })
    const usage = await provider.collect()
    expect(usage.providerId).toBe('codex')
    expect(usage.status).toBe('unavailable')
    expect(usage.windows).toEqual([])
  })

  it('从 rollout 文件解析最新 rate_limits 快照', async () => {
    const root = await tempRoot()
    const resetsAt = Math.floor(NOW / 1000) + 24 * 3600
    await writeRollout(
      root,
      '2026-08-13',
      'rollout-a.jsonl',
      rateLimitLine({ timestamp: '2026-08-13T07:00:00Z', usedPercent: 42.5, resetsAt }),
    )
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    expect(usage.planType).toBe('pro')
    expect(usage.windows).toHaveLength(1)
    const win = usage.windows[0]
    expect(win.kind).toBe('quota')
    if (win.kind !== 'quota') throw new Error('unreachable')
    expect(win.usedPercent).toBe(42.5)
    expect(win.windowMinutes).toBe(10080)
    expect(win.resetsAt).toBe(resetsAt * 1000)
    expect(win.observedAt).toBe(Date.parse('2026-08-13T07:00:00Z'))
    expect(win.state).toBe('observed')
    expect(usage.lastActivityAt).toBe(Date.parse('2026-08-13T07:00:00Z'))
  })

  it('跨文件取事件时间戳最新的快照，而非文件名最新', async () => {
    const root = await tempRoot()
    await writeRollout(
      root,
      '2026-08-13',
      'rollout-z-newer-name.jsonl',
      rateLimitLine({ timestamp: '2026-08-13T05:00:00Z', usedPercent: 10 }),
    )
    await writeRollout(
      root,
      '2026-08-12',
      'rollout-a-older-name.jsonl',
      rateLimitLine({ timestamp: '2026-08-13T07:30:00Z', usedPercent: 55 }),
    )
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    const win = usage.windows[0]
    if (win.kind !== 'quota') throw new Error('expected quota window')
    expect(win.usedPercent).toBe(55)
  })

  it('reset 已过期的快照标记为 expired', async () => {
    const root = await tempRoot()
    await writeRollout(
      root,
      '2026-08-10',
      'rollout-old.jsonl',
      rateLimitLine({
        timestamp: '2026-08-10T00:00:00Z',
        usedPercent: 90,
        resetsAt: Math.floor(NOW / 1000) - 3600,
      }),
    )
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    const win = usage.windows[0]
    if (win.kind !== 'quota') throw new Error('expected quota window')
    expect(win.state).toBe('expired')
  })

  it('plan_type 下划线转空格显示（pro_5x → pro 5x）', async () => {
    const root = await tempRoot()
    await writeRollout(
      root,
      '2026-08-13',
      'rollout-a.jsonl',
      rateLimitLine({ timestamp: '2026-08-13T07:00:00Z', usedPercent: 1, planType: 'pro_5x' }),
    )
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.planType).toBe('pro 5x')
  })

  it('包含 secondary 窗口', async () => {
    const root = await tempRoot()
    await writeRollout(
      root,
      '2026-08-13',
      'rollout-a.jsonl',
      rateLimitLine({
        timestamp: '2026-08-13T07:00:00Z',
        usedPercent: 20,
        secondary: {
          used_percent: 5,
          window_minutes: 300,
          resets_at: Math.floor(NOW / 1000) + 600,
        },
      }),
    )
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.windows).toHaveLength(2)
    expect(usage.windows.map((w) => w.windowMinutes).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      300, 10080,
    ])
  })

  it('跳过损坏行和无 rate_limits 的行', async () => {
    const root = await tempRoot()
    const content =
      '{"broken json\n' +
      `${JSON.stringify({ timestamp: '2026-08-13T06:00:00Z', type: 'event_msg', payload: { type: 'agent_message' } })}\n` +
      rateLimitLine({ timestamp: '2026-08-13T06:30:00Z', usedPercent: 33 }) +
      '{"truncated": tru'
    await writeRollout(root, '2026-08-13', 'rollout-a.jsonl', content)
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('ok')
    const win = usage.windows[0]
    if (win.kind !== 'quota') throw new Error('expected quota window')
    expect(win.usedPercent).toBe(33)
  })

  it('目录存在但没有任何 rate_limits 事件时报告 unavailable', async () => {
    const root = await tempRoot()
    await writeRollout(root, '2026-08-13', 'rollout-a.jsonl', '{"timestamp":"x","type":"other"}\n')
    const provider = createCodexProvider({ sessionsDir: root, now: () => NOW })
    const usage = await provider.collect()
    expect(usage.status).toBe('unavailable')
  })
})
