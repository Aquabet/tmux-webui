import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionSidebar } from './SessionSidebar'

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
              { kind: 'claude', status: 'idle' },
              { kind: 'pi', status: 'running' },
              { kind: 'kimi', status: 'idle' },
              { kind: 'opencode' },
            ],
          },
        ]}
      />,
    )

    expect(
      screen.getByLabelText('Codex：运行中；无活跃前台').getAttribute('data-agent'),
    ).toBe('codex')
    expect(screen.getByLabelText('Claude Code：已停下；无活跃前台').getAttribute('data-agent')).toBe(
      'claude',
    )
    const piBadge = screen.getByLabelText('Pi：运行中；无活跃前台')
    expect(piBadge.getAttribute('data-agent')).toBe('pi')
    expect(piBadge.getAttribute('data-attached')).toBe('false')
    expect(piBadge.querySelector('svg')?.getAttribute('data-logo')).toBe('official')
    expect(
      screen.getByLabelText('Kimi Code：已停下；无活跃前台').getAttribute('data-agent'),
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

    expect(
      screen.getByLabelText('Codex：状态未知；有活跃前台').getAttribute('data-status'),
    ).toBe('unknown')
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
})
