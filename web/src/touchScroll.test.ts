import { describe, expect, it, vi } from 'vitest'
import { createTouchScroll } from './touchScroll'

describe('createTouchScroll', () => {
  it('手指上滑超过步长时发正向 wheel（查看更晚内容）', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.start(100)
    s.move(75)
    expect(emit).toHaveBeenCalledWith(25)
  })

  it('手指下滑发负向 wheel（回看更早内容）', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.start(100)
    s.move(130)
    expect(emit).toHaveBeenCalledWith(-30)
  })

  it('小于步长的移动不发，累积到阈值才发', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.start(100)
    s.move(90)
    expect(emit).not.toHaveBeenCalled()
    s.move(75)
    expect(emit).toHaveBeenCalledWith(25)
  })

  it('发出后从当前位置重新累积', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.start(100)
    s.move(75)
    s.move(70)
    expect(emit).toHaveBeenCalledTimes(1)
    s.move(50)
    expect(emit).toHaveBeenLastCalledWith(25)
  })

  it('未 start 时 move 不发', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.move(50)
    expect(emit).not.toHaveBeenCalled()
  })

  it('end 后 move 不发', () => {
    const emit = vi.fn()
    const s = createTouchScroll(emit, 20)
    s.start(100)
    s.end()
    s.move(50)
    expect(emit).not.toHaveBeenCalled()
  })
})
