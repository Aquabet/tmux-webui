import { afterEach, describe, expect, it } from 'vitest'
import {
  elapsedPercent,
  formatResetIn,
  formatTokens,
  loadCollapsedProviders,
  setProviderCollapsed,
} from './planUsageDisplay'

afterEach(() => {
  localStorage.clear()
})

describe('setProviderCollapsed', () => {
  it('折叠状态持久化在本浏览器', () => {
    setProviderCollapsed('codex', true)
    expect(loadCollapsedProviders()).toEqual(['codex'])
    setProviderCollapsed('codex', true)
    expect(loadCollapsedProviders()).toEqual(['codex'])
    setProviderCollapsed('codex', false)
    expect(loadCollapsedProviders()).toEqual([])
  })

  it('存储损坏时回退为空', () => {
    localStorage.setItem('tmux-webui.usage-collapsed.v1', 'not json')
    expect(loadCollapsedProviders()).toEqual([])
  })
})

describe('formatTokens', () => {
  it('小数字原样显示', () => {
    expect(formatTokens(999)).toBe('999')
  })

  it('千位以上缩写', () => {
    expect(formatTokens(1_500)).toBe('1.5k')
    expect(formatTokens(2_340_000)).toBe('2.3M')
  })
})

describe('formatResetIn', () => {
  const now = 1_000_000_000
  it('按剩余时长选择单位', () => {
    expect(formatResetIn(now + 90 * 24 * 3600 * 1000, now)).toBe('90d')
    expect(formatResetIn(now + 26 * 3600 * 1000, now)).toBe('1d2h')
    expect(formatResetIn(now + 3 * 3600 * 1000, now)).toBe('3h')
    expect(formatResetIn(now + 45 * 60 * 1000, now)).toBe('45m')
  })

  it('已过期返回 undefined', () => {
    expect(formatResetIn(now - 1, now)).toBeUndefined()
  })
})

describe('elapsedPercent', () => {
  const now = 1_000_000_000
  const hour = 3600 * 1000

  it('5h 窗口还剩 1.5h 时基准线在 70%', () => {
    expect(elapsedPercent(300, now + 1.5 * hour, now)).toBeCloseTo(70)
  })

  it('周窗口按同样比例计算', () => {
    expect(elapsedPercent(10080, now + 7 * 24 * hour, now)).toBe(0)
    expect(elapsedPercent(10080, now + 3.5 * 24 * hour, now)).toBeCloseTo(50)
  })

  it('缺少窗口长度或重置时间时没有基准线', () => {
    expect(elapsedPercent(undefined, now + hour, now)).toBeUndefined()
    expect(elapsedPercent(300, undefined, now)).toBeUndefined()
  })

  it('剩余时间越界时夹到 0-100', () => {
    expect(elapsedPercent(300, now - hour, now)).toBe(100)
    expect(elapsedPercent(300, now + 99 * hour, now)).toBe(0)
  })
})
