import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WindowTabs } from './WindowTabs'

const windows = [
  { index: 0, name: 'claude', active: true },
  { index: 1, name: 'logs', active: false },
]

describe('WindowTabs', () => {
  it('渲染所有 window 名并高亮选中项', () => {
    render(<WindowTabs windows={windows} selected={1} onSelect={() => undefined} />)
    expect(screen.getByText('0: claude')).toBeDefined()
    const selectedTab = screen.getByText('1: logs')
    expect(selectedTab.className).toContain('selected')
  })

  it('点击 tab 触发 onSelect', () => {
    const onSelect = vi.fn()
    render(<WindowTabs windows={windows} selected={0} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('1: logs'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })
})
