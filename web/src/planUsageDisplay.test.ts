import { afterEach, describe, expect, it } from 'vitest'
import {
  formatResetIn,
  formatTokens,
  loadHiddenProviders,
  saveHiddenProviders,
  USAGE_DISPLAY_STORAGE_KEY,
} from './planUsageDisplay'

afterEach(() => {
  localStorage.clear()
})

describe('hidden provider 持久化', () => {
  it('默认没有隐藏任何 provider', () => {
    expect(loadHiddenProviders()).toEqual([])
  })

  it('保存后可读回', () => {
    saveHiddenProviders(['codex'])
    expect(loadHiddenProviders()).toEqual(['codex'])
  })

  it('存储内容损坏时回退为空', () => {
    localStorage.setItem(USAGE_DISPLAY_STORAGE_KEY, '{"not":"array"}')
    expect(loadHiddenProviders()).toEqual([])
    localStorage.setItem(USAGE_DISPLAY_STORAGE_KEY, '[1,2]')
    expect(loadHiddenProviders()).toEqual([])
    localStorage.setItem(USAGE_DISPLAY_STORAGE_KEY, 'not json')
    expect(loadHiddenProviders()).toEqual([])
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
