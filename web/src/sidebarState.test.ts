import { beforeEach, describe, expect, it } from 'vitest'
import { loadSidebarCollapsed, toggleSidebarCollapsed } from './sidebarState'

describe('sidebarState', () => {
  beforeEach(() => localStorage.clear())

  it('默认不折叠', () => {
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('toggle 返回新状态并持久化', () => {
    expect(toggleSidebarCollapsed(false)).toBe(true)
    expect(loadSidebarCollapsed()).toBe(true)
    expect(toggleSidebarCollapsed(true)).toBe(false)
    expect(loadSidebarCollapsed()).toBe(false)
  })

  it('localStorage 值损坏时回退为不折叠', () => {
    localStorage.setItem('sidebar-collapsed', 'garbage')
    expect(loadSidebarCollapsed()).toBe(false)
  })
})
