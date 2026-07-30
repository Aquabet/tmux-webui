import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthError, fetchSystemResources } from './api'
import { ResourceUsage } from './ResourceUsage'

vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchSystemResources: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ResourceUsage', () => {
  it('用两枚环形图展示 CPU 与 RAM 占用', async () => {
    vi.mocked(fetchSystemResources).mockResolvedValue({
      cpuPercent: 37.4,
      cpuCount: 8,
      memoryUsedBytes: 3 * 1024 ** 3,
      memoryTotalBytes: 8 * 1024 ** 3,
      memoryPercent: 37.5,
    })
    render(<ResourceUsage onAuthLost={vi.fn()} />)

    expect(await screen.findByLabelText('CPU 使用率 37%')).toBeDefined()
    expect(screen.getByLabelText('RAM 使用率 38%')).toBeDefined()
    expect(screen.getByText('8 核')).toBeDefined()
    expect(screen.getByText('3.0/8.0 GB')).toBeDefined()
  })

  it('暂时取不到数据时保留仪表位置，不用错误信息挤动侧栏', async () => {
    vi.mocked(fetchSystemResources).mockRejectedValue(new Error('offline'))
    render(<ResourceUsage onAuthLost={vi.fn()} />)

    await waitFor(() => expect(fetchSystemResources).toHaveBeenCalled())
    expect(screen.getByLabelText('CPU 使用率暂不可用')).toBeDefined()
    expect(screen.getByLabelText('RAM 使用率暂不可用')).toBeDefined()
  })

  it('登录失效时交给上层返回登录页', async () => {
    vi.mocked(fetchSystemResources).mockRejectedValue(new AuthError())
    const onAuthLost = vi.fn()
    render(<ResourceUsage onAuthLost={onAuthLost} />)

    await waitFor(() => expect(onAuthLost).toHaveBeenCalledOnce())
  })
})
