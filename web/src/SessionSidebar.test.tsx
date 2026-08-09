import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionSidebar } from './SessionSidebar'
import { MIN_SIDEBAR_WIDTH } from './sidebarSize'

vi.mock('./VersionBadge', () => ({ VersionBadge: () => null }))
vi.mock('./ResourceUsage', () => ({
  ResourceUsage: () => <div data-testid="resource-usage" />,
}))

const handlers = {
  selected: undefined,
  onSelect: vi.fn(),
  onCreate: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onUpdateStarted: vi.fn(),
  onAuthLost: vi.fn(),
  onOpenSettings: vi.fn(),
  width: 200,
  onWidthChange: vi.fn(),
}

describe('SessionSidebar agent 状态', () => {
  it('把系统资源仪表固定在侧栏 footer 的最下面', () => {
    const { container } = render(<SessionSidebar {...handlers} sessions={[]} />)
    const scroll = container.querySelector('.session-scroll') as HTMLElement
    const footer = container.querySelector('.sidebar-footer') as HTMLElement

    expect(scroll.firstElementChild?.tagName).toBe('UL')
    expect(scroll.lastElementChild).toBe(screen.getByRole('button', { name: '＋ 新建 session' }))
    expect(footer).toBeDefined()
    expect(footer.lastElementChild).toBe(screen.getByTestId('resource-usage'))
  })

  it('用不同图标展示各 coding agent 的精确状态', () => {
    render(
      <SessionSidebar
        {...handlers}
        sessions={[
          {
            name: 'agents',
            attached: false,
            windows: [],
            agents: [
              { kind: 'codex', status: 'running' },
              { kind: 'claude', status: 'waiting' },
              { kind: 'pi', status: 'running' },
              { kind: 'kimi', status: 'waiting' },
              { kind: 'opencode' },
            ],
          },
        ]}
      />,
    )

    expect(screen.getByLabelText('Codex：运行中；无活跃前台').getAttribute('data-agent')).toBe(
      'codex',
    )
    const claudeBadge = screen.getByLabelText('Claude Code：等待用户回应；无活跃前台')
    expect(claudeBadge.getAttribute('data-agent')).toBe('claude')
    expect(claudeBadge.querySelector('.agent-status-dot')).not.toBeNull()
    const piBadge = screen.getByLabelText('Pi：运行中；无活跃前台')
    expect(piBadge.getAttribute('data-agent')).toBe('pi')
    expect(piBadge.getAttribute('data-attached')).toBe('false')
    expect(piBadge.querySelector('svg')?.getAttribute('data-logo')).toBe('official')
    expect(
      screen.getByLabelText('Kimi Code：等待用户回应；无活跃前台').getAttribute('data-agent'),
    ).toBe('kimi')
    expect(screen.getByLabelText('OpenCode：状态未知；无活跃前台').getAttribute('data-agent')).toBe(
      'opencode',
    )
  })

  it('未配置 hooks 时只标识 agent，不猜测运行状态', () => {
    render(
      <SessionSidebar
        {...handlers}
        sessions={[
          {
            name: 'codex-only',
            attached: true,
            windows: [],
            agents: [{ kind: 'codex' }],
          },
        ]}
      />,
    )

    const badge = screen.getByLabelText('Codex：状态未知；有活跃前台')
    expect(badge.getAttribute('data-status')).toBe('unknown')
    expect(badge.querySelector('.agent-status-dot')).toBeNull()
  })

  it('普通 shell session 显示 Terminal 图标且不伪造 agent 状态', () => {
    render(
      <SessionSidebar
        {...handlers}
        sessions={[
          {
            name: 'shell',
            attached: true,
            windows: [],
          },
        ]}
      />,
    )

    const badge = screen.getByLabelText('Terminal：有活跃前台')
    expect(badge.getAttribute('data-agent')).toBe('terminal')
    expect(badge.getAttribute('data-attached')).toBe('true')
    expect(badge.querySelector('.agent-status-dot')).toBeNull()
  })

  it('移除旧绿灯并把明暗状态图标放在 session 名称前', () => {
    const { container } = render(
      <SessionSidebar
        {...handlers}
        sessions={[
          {
            name: 'dim-shell',
            attached: false,
            windows: [],
          },
        ]}
      />,
    )

    const session = container.querySelector('.session') as HTMLButtonElement
    expect(session.querySelector('.dot')).toBeNull()
    expect(session.children[0]?.classList.contains('agent-badges')).toBe(true)
    expect(session.children[1]?.classList.contains('session-name')).toBe(true)
    expect(screen.getByLabelText('Terminal：无活跃前台').getAttribute('data-attached')).toBe(
      'false',
    )
  })

  it('最窄时进入只显示图标的紧凑状态，同时保留 session 名称提示', () => {
    const { container } = render(
      <SessionSidebar
        {...handlers}
        width={MIN_SIDEBAR_WIDTH}
        sessions={[{ name: 'production', attached: true, windows: [] }]}
      />,
    )

    expect(container.querySelector('.sidebar')?.classList.contains('compact')).toBe(true)
    expect(screen.getByRole('button', { name: 'production' }).getAttribute('title')).toBe(
      'production',
    )
  })

  it('接近最窄时保持紧凑，避免完整内容在过窄空间里挤坏', () => {
    const { container } = render(<SessionSidebar {...handlers} width={96} sessions={[]} />)

    expect(container.querySelector('.sidebar')?.classList.contains('compact')).toBe(true)
  })

  it('分隔线支持键盘精调宽度、边界快捷键和 ARIA 数值', () => {
    const onWidthChange = vi.fn()
    render(<SessionSidebar {...handlers} width={200} onWidthChange={onWidthChange} sessions={[]} />)
    const separator = screen.getByRole('separator', { name: '调整 session 侧栏宽度' })
    expect(separator.getAttribute('aria-valuenow')).toBe('200')
    expect(separator.getAttribute('aria-valuemin')).toBe(String(MIN_SIDEBAR_WIDTH))

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(onWidthChange).toHaveBeenLastCalledWith(216)
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(onWidthChange).toHaveBeenLastCalledWith(184)
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(onWidthChange).toHaveBeenLastCalledWith(MIN_SIDEBAR_WIDTH)
    fireEvent.keyDown(separator, { key: 'End' })
    expect(onWidthChange).toHaveBeenLastCalledWith(480)
    fireEvent.keyDown(separator, { key: 'Enter' })
    expect(onWidthChange).toHaveBeenCalledTimes(4)
  })
})
