import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppearanceSettingsDialog } from './AppearanceSettings'
import { DEFAULT_APPEARANCE } from './appearance'

describe('AppearanceSettingsDialog', () => {
  it('主题卡片可即时切换，并提供字体和字号控制', () => {
    const onChange = vi.fn()
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Catppuccin Mocha/ }))
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_APPEARANCE,
      theme: 'catppuccin-mocha',
    })

    fireEvent.change(screen.getByLabelText('终端字体'), {
      target: { value: 'jetbrains-mono' },
    })
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_APPEARANCE,
      font: 'jetbrains-mono',
    })

    fireEvent.change(screen.getByLabelText('终端字号'), { target: { value: '18' } })
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, fontSize: 18 })
  })

  it('Escape 关闭弹窗，重置按钮恢复默认值', () => {
    const onClose = vi.fn()
    const onChange = vi.fn()
    render(
      <AppearanceSettingsDialog
        settings={{ ...DEFAULT_APPEARANCE, theme: 'dracula', fontSize: 18 }}
        onChange={onChange}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(onChange).toHaveBeenCalledWith(DEFAULT_APPEARANCE)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('可切换行高和光标形状', () => {
    const onChange = vi.fn()
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '1.2×' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, lineHeight: 1.2 })
    fireEvent.click(screen.getByRole('button', { name: '竖线' }))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_APPEARANCE, cursorStyle: 'bar' })
  })

  it('关闭按钮、完成按钮和背景点击都能关闭', () => {
    const onClose = vi.fn()
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭设置（背景）' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('打开时聚焦关闭按钮，并把 Tab 限制在弹窗内', () => {
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const close = screen.getByRole('button', { name: '关闭设置' })
    const done = screen.getByRole('button', { name: '完成' })
    expect(document.activeElement).toBe(close)

    done.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(done)
  })
})
