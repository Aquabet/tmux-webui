import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateNotice } from './UpdateNotice'
import { fetchVersion } from './api'

vi.mock('./api', () => ({ fetchVersion: vi.fn() }))

const info = {
  current: '0.1.0',
  latest: '0.2.0',
  url: 'https://example.test/v0.2.0',
  updateAvailable: true,
}

describe('UpdateNotice', () => {
  it('有新版本时显示指向发布页的链接', async () => {
    vi.mocked(fetchVersion).mockResolvedValue(info)
    render(<UpdateNotice />)
    const link = await screen.findByRole('link')
    expect(link.getAttribute('href')).toBe('https://example.test/v0.2.0')
    expect(link.textContent).toContain('0.2.0')
  })

  it('已是最新时什么都不渲染', async () => {
    vi.mocked(fetchVersion).mockResolvedValue({ ...info, updateAvailable: false })
    const { container } = render(<UpdateNotice />)
    await waitFor(() => expect(fetchVersion).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('查询失败时静默，不影响页面', async () => {
    vi.mocked(fetchVersion).mockRejectedValue(new Error('offline'))
    const { container } = render(<UpdateNotice />)
    await waitFor(() => expect(fetchVersion).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
