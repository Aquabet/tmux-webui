import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('./TerminalView', () => ({
  TerminalView: ({ onForegroundChange }: { onForegroundChange?: () => void }) => (
    <button data-testid="term" onClick={onForegroundChange} />
  ),
}))

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

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

  it('Sessions 标题右侧可打开外观设置', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '外观设置' }))

    expect(screen.getByRole('dialog', { name: '外观设置' })).toBeDefined()
    expect(screen.getByRole('button', { name: /Tokyo Night/ })).toBeDefined()
    expect(screen.getByLabelText('终端字体')).toBeDefined()
  })

  it('切换主题时即时应用并保存到当前浏览器', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([])
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '外观设置' }))
    fireEvent.click(screen.getByRole('button', { name: /Nord/ }))

    expect(document.documentElement.dataset.theme).toBe('nord')
    expect(JSON.parse(localStorage.getItem('tmux-webui.appearance.v1') ?? '{}').theme).toBe(
      'nord',
    )
  })

  it('启动时恢复浏览器保存的主题', async () => {
    localStorage.setItem(
      'tmux-webui.appearance.v1',
      JSON.stringify({
        theme: 'gruvbox-dark',
        font: 'system-mono',
        fontSize: 14,
        lineHeight: 1,
        cursorStyle: 'block',
      }),
    )
    vi.mocked(checkAuth).mockResolvedValue(false)
    render(<App />)

    await screen.findByRole('button', { name: '登录' })
    expect(document.documentElement.dataset.theme).toBe('gruvbox-dark')
  })

  it('终端前台连接变化时立即刷新 session 亮暗状态', async () => {
    vi.mocked(checkAuth).mockResolvedValue(true)
    vi.mocked(fetchSessions).mockResolvedValue([
      { name: 'demo', attached: false, windows: [{ index: 0, name: 'sh', active: true }] },
    ])
    render(<App />)
    const terminal = await screen.findByTestId('term')
    const callsBeforeForegroundChange = vi.mocked(fetchSessions).mock.calls.length

    fireEvent.click(terminal)

    await waitFor(() =>
      expect(fetchSessions).toHaveBeenCalledTimes(callsBeforeForegroundChange + 1),
    )
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
