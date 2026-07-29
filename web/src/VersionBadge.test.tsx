import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VersionBadge } from './VersionBadge'
import { fetchVersion, startUpdate } from './api'

vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchVersion: vi.fn(),
  startUpdate: vi.fn(),
}))

const upToDate = {
  current: '3.1.0',
  latest: '3.1.0',
  url: 'https://example.test/v3.1.0',
  updateAvailable: false,
  canUpdate: true,
}
const outdated = { ...upToDate, latest: '3.14.0', updateAvailable: true }

afterEach(() => {
  vi.restoreAllMocks()
})

function renderBadge() {
  const onUpdateStarted = vi.fn()
  const onAuthLost = vi.fn()
  render(<VersionBadge onUpdateStarted={onUpdateStarted} onAuthLost={onAuthLost} />)
  return { onUpdateStarted, onAuthLost }
}

describe('VersionBadge', () => {
  it('默认显示当前版本，没有新版本时不出现更新按钮', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(upToDate)
    renderBadge()
    expect(await screen.findByText('v3.1.0')).toBeDefined()
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
  })

  it('有新版本时同时给出新旧版本、发布页链接与更新按钮', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(outdated)
    renderBadge()
    const link = await screen.findByRole('link')
    expect(link.textContent).toContain('3.14.0')
    expect(link.textContent).toContain('3.1.0')
    expect(link.getAttribute('href')).toBe('https://example.test/v3.1.0')
    expect(screen.getByRole('button', { name: '更新' })).toBeDefined()
  })

  it('服务端不支持一键更新时只提示不给按钮', async () => {
    vi.mocked(fetchVersion).mockResolvedValue({ ...outdated, canUpdate: false })
    renderBadge()
    await screen.findByRole('link')
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
  })

  it('点更新前先确认，确认后把新建的 session 交给上层切过去', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(outdated)
    vi.mocked(startUpdate).mockResolvedValue('tmux-webui-update')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onUpdateStarted } = renderBadge()
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    await waitFor(() => expect(onUpdateStarted).toHaveBeenCalledWith('tmux-webui-update'))
  })

  it('确认框取消时不发起更新', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(outdated)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderBadge()
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it('启动失败时显示服务端给的原因', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(outdated)
    vi.mocked(startUpdate).mockRejectedValue(new Error('更新已在进行中'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderBadge()
    fireEvent.click(await screen.findByRole('button', { name: '更新' }))
    expect(await screen.findByText('更新已在进行中')).toBeDefined()
  })

  it('查不到版本时什么都不渲染', async () => {
    vi.mocked(fetchVersion).mockRejectedValue(new Error('offline'))
    const { container } = render(<VersionBadge onUpdateStarted={vi.fn()} onAuthLost={vi.fn()} />)
    await waitFor(() => expect(fetchVersion).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
