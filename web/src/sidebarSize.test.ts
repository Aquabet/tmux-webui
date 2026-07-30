import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  loadSidebarWidth,
  resizeSidebar,
  saveSidebarWidth,
} from './sidebarSize'

describe('sidebarSize', () => {
  beforeEach(() => localStorage.clear())

  it('没有已保存宽度时使用默认值', () => {
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('保存并恢复侧栏宽度', () => {
    saveSidebarWidth(268)
    expect(loadSidebarWidth()).toBe(268)
  })

  it('损坏或越界的已保存值会安全回退或收窄', () => {
    localStorage.setItem('sidebar-width', 'garbage')
    expect(loadSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)

    localStorage.setItem('sidebar-width', '10')
    expect(loadSidebarWidth()).toBe(MIN_SIDEBAR_WIDTH)

    localStorage.setItem('sidebar-width', '9999')
    expect(loadSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH)
  })

  it('按拖动距离计算新宽度并限制在允许范围内', () => {
    expect(resizeSidebar(200, 100, 148)).toBe(248)
    expect(resizeSidebar(200, 100, -200)).toBe(MIN_SIDEBAR_WIDTH)
    expect(resizeSidebar(200, 100, 999)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })
})
