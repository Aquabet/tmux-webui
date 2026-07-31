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

  it('字号变化后读取新的动态步长，不必重建手势处理器', () => {
    const emit = vi.fn()
    let stepPx = 20
    const s = createTouchScroll(emit, () => stepPx)
    s.start(100)
    stepPx = 30
    s.move(75)
    expect(emit).not.toHaveBeenCalled()
    s.move(65)
    expect(emit).toHaveBeenCalledWith(35)
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

describe('惯性速度', () => {
  it('匀速上滑后 end 返回近似速度（px/ms，正向）', () => {
    const s = createTouchScroll(vi.fn(), 20)
    s.start(500, 0)
    s.move(480, 16)
    s.move(460, 32)
    s.move(440, 48)
    const v = s.end(48)
    expect(v).toBeGreaterThan(0.8)
    expect(v).toBeLessThan(1.6)
  })

  it('下滑速度为负', () => {
    const s = createTouchScroll(vi.fn(), 20)
    s.start(100, 0)
    s.move(140, 16)
    s.move(180, 32)
    expect(s.end(32)).toBeLessThan(0)
  })

  it('停顿后抬手速度为 0', () => {
    const s = createTouchScroll(vi.fn(), 20)
    s.start(500, 0)
    s.move(460, 16)
    const v = s.end(500)
    expect(v).toBe(0)
  })

  it('未滑动直接 end 速度为 0', () => {
    const s = createTouchScroll(vi.fn(), 20)
    s.start(100, 0)
    expect(s.end(10)).toBe(0)
  })
})
