import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, fetchPlanUsage, type PlanUsageReport } from './api'
import { PlanUsage } from './PlanUsage'
import { loadHiddenProviders, setProviderHidden } from './planUsageDisplay'

vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchPlanUsage: vi.fn(),
}))

const NOW = Date.parse('2026-08-13T08:00:00Z')

// 倒计时展示用真实时钟计算剩余时长，固定系统时间才能稳定断言 "2d"
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  localStorage.clear()
})

function report(providers: PlanUsageReport['providers']): PlanUsageReport {
  return { schemaVersion: 1, collectedAt: NOW, providers }
}

const codexOk: PlanUsageReport['providers'][number] = {
  providerId: 'codex',
  displayName: 'Codex',
  status: 'ok',
  planType: 'pro',
  windows: [
    {
      kind: 'quota',
      label: 'weekly',
      usedPercent: 42.5,
      windowMinutes: 10080,
      resetsAt: NOW + 2 * 24 * 3600 * 1000,
      observedAt: NOW - 60_000,
      state: 'observed',
    },
  ],
  lastActivityAt: NOW - 60_000,
}

const claudeOk: PlanUsageReport['providers'][number] = {
  providerId: 'claude',
  displayName: 'Claude Code',
  status: 'ok',
  windows: [
    {
      kind: 'tokens',
      label: '5h',
      tokens: 1_500_000,
      windowMinutes: 300,
      observedAt: NOW,
      state: 'observed',
    },
    {
      kind: 'tokens',
      label: 'today',
      tokens: 4_000_000,
      windowMinutes: 480,
      observedAt: NOW,
      state: 'observed',
    },
  ],
  lastActivityAt: NOW - 30_000,
}

describe('PlanUsage', () => {
  it('展示 Codex 配额百分比、计划名与重置倒计时', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(report([codexOk]))
    render(<PlanUsage onAuthLost={vi.fn()} />)

    expect(await screen.findByText('Codex')).toBeDefined()
    expect(screen.getByText('pro')).toBeDefined()
    expect(screen.getByLabelText('Codex weekly 已用 43%')).toBeDefined()
    expect(screen.getByText(/2d/)).toBeDefined()
  })

  it('展示 Claude token 统计并标注非配额', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(report([claudeOk]))
    render(<PlanUsage onAuthLost={vi.fn()} />)

    expect(await screen.findByText('Claude Code')).toBeDefined()
    expect(screen.getByText('1.5M')).toBeDefined()
    expect(screen.getByText('4.0M')).toBeDefined()
    // token 统计不是配额，每行都要有说明性标注
    expect(screen.getAllByTitle(/本地统计/)).toHaveLength(2)
  })

  it('没有任何 provider 时整个区块不渲染', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(report([]))
    const { container } = render(<PlanUsage onAuthLost={vi.fn()} />)

    await waitFor(() => expect(fetchPlanUsage).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('过期快照标注为已过期', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(
      report([
        {
          ...codexOk,
          windows: [{ ...codexOk.windows[0], state: 'expired', resetsAt: NOW - 3600_000 } as never],
        },
      ]),
    )
    render(<PlanUsage onAuthLost={vi.fn()} />)

    expect(await screen.findByText(/已过期/)).toBeDefined()
  })

  it('数据源缺失与获取失败分别提示', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(
      report([
        { providerId: 'codex', displayName: 'Codex', status: 'unavailable', windows: [] },
        { providerId: 'claude-quota', displayName: 'Claude 配额', status: 'error', windows: [] },
      ]),
    )
    render(<PlanUsage onAuthLost={vi.fn()} />)

    expect(await screen.findByText('未检测到数据源')).toBeDefined()
    expect(screen.getByText('获取失败')).toBeDefined()
  })

  it('点击 provider 名后整块隐藏并持久化，设置面板事件可恢复', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(report([codexOk]))
    render(<PlanUsage onAuthLost={vi.fn()} />)

    const toggle = await screen.findByRole('button', { name: /Codex/ })
    fireEvent.click(toggle)
    // 整块（含名字）都消失，恢复入口在设置面板
    expect(screen.queryByText('Codex')).toBeNull()
    expect(loadHiddenProviders()).toEqual(['codex'])

    setProviderHidden('codex', false)
    expect(await screen.findByText('Codex')).toBeDefined()
    expect(screen.getByLabelText('Codex weekly 已用 43%')).toBeDefined()
  })

  it('设置面板隐藏全部 provider 后整个区块不渲染', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(report([codexOk]))
    const { container } = render(<PlanUsage onAuthLost={vi.fn()} />)
    expect(await screen.findByText('Codex')).toBeDefined()

    setProviderHidden('codex', true)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('登录失效时交给上层返回登录页', async () => {
    vi.mocked(fetchPlanUsage).mockRejectedValue(new AuthError())
    const onAuthLost = vi.fn()
    render(<PlanUsage onAuthLost={onAuthLost} />)

    await waitFor(() => expect(onAuthLost).toHaveBeenCalledOnce())
  })
})
