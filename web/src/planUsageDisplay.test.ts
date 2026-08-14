import { afterEach, describe, expect, it } from 'vitest'
import {
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
