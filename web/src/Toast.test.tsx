import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('没有消息时不渲染', () => {
    const { container } = render(<Toast message={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('10 秒后自动消失', () => {
    vi.useFakeTimers()
    render(<Toast message="同名 session 已存在" />)
    expect(screen.getByRole('alert').textContent).toContain('同名 session 已存在')

    act(() => {
      vi.advanceTimersByTime(9999)
    })
    expect(screen.queryByRole('alert')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('可以手动关掉', () => {
    render(<Toast message="操作失败" />)
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('新消息重新显示并重新计时', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Toast message="第一条" />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(<Toast message="第二条" />)
    expect(screen.getByRole('alert').textContent).toContain('第二条')
    act(() => {
      vi.advanceTimersByTime(9999)
    })
    expect(screen.queryByRole('alert')).not.toBeNull()
  })
})
