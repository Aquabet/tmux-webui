import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { checkAuth, fetchSessions, fetchVersion } from './api'

vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  checkAuth: vi.fn(),
  fetchSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  fetchVersion: vi.fn().mockRejectedValue(new Error('无关')),
}))
// TerminalView 会拉起 xterm 与 WebSocket，本用例只关心外层布局
vi.mock('./TerminalView', () => ({ TerminalView: () => <div data-testid="term" /> }))

describe('App 无 session 时', () => {
  it('仍然渲染侧栏开关——否则手机端抽屉打不开，永远建不了 session', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([])
    render(<App />)
    await waitFor(() => expect(fetchSessions).toHaveBeenCalled())
    expect(await screen.findByLabelText('切换 session 列表')).toBeDefined()
  })

  // 侧栏那个新建按钮在 DOM 里始终存在（窄屏只是被 CSS 移出屏幕），
  // 所以必须限定在 main 区域内找，否则用例对这个 bug 不敏感
  it('空状态里直接给出新建入口', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([])
    const { container } = render(<App />)
    await waitFor(() => expect(fetchSessions).toHaveBeenCalled())
    const main = within(container.querySelector('main') as HTMLElement)
    expect(main.getByRole('button', { name: /新建 session/ })).toBeDefined()
  })

  it('有 session 时照常渲染终端与开关', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([
      { name: 'demo', attached: true, windows: [{ index: 0, name: 'sh', active: true }] },
    ])
    render(<App />)
    expect(await screen.findByTestId('term')).toBeDefined()
    expect(screen.getByLabelText('切换 session 列表')).toBeDefined()
  })

  it('新版提示也渲染在顶栏，手机侧栏关闭时仍可见', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([])
    vi.mocked(fetchVersion).mockResolvedValue({
      current: '3.1.3',
      latest: '3.1.4',
      url: 'https://example.test/v3.1.4',
      updateAvailable: true,
      canUpdate: true,
    })
    const { container } = render(<App />)
    await screen.findByLabelText('切换 session 列表')
    const header = within(container.querySelector('.main-header') as HTMLElement)

    expect(await header.findByRole('link', { name: '新版 v3.1.4' })).toBeDefined()
    expect(header.getByRole('button', { name: '更新' })).toBeDefined()
  })
})
