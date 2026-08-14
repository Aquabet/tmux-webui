import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPlanUsage, savePlanUsageProviders, type PlanUsageReport } from './api'
import { AppearanceSettingsDialog } from './AppearanceSettings'
import { DEFAULT_APPEARANCE } from './appearance'

vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchPlanUsage: vi.fn(),
  savePlanUsageProviders: vi.fn().mockResolvedValue(undefined),
}))

afterEach(() => {
  localStorage.clear()
})

// 旧用例不关心用量分区：默认让它拿到空列表从而不渲染
beforeEach(() => {
  vi.mocked(fetchPlanUsage).mockResolvedValue({
    schemaVersion: 1,
    collectedAt: 0,
    providers: [],
  })
  vi.mocked(savePlanUsageProviders).mockResolvedValue(undefined)
})

function usageReport(entries: Array<[string, 'ok' | 'disabled']>): PlanUsageReport {
  return {
    schemaVersion: 1,
    collectedAt: 0,
    providers: entries.map(([id, status]) => ({
      providerId: id,
      displayName: id === 'codex' ? 'Codex' : id,
      status,
      windows: [],
    })),
  }
}

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

  it('列出全部 provider，勾选状态跟随服务端的启用情况', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(
      usageReport([
        ['codex', 'ok'],
        ['claude-quota', 'disabled'],
      ]),
    )
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      ((await screen.findByRole('checkbox', { name: /Codex/ })) as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByRole('checkbox', { name: /claude-quota/ }) as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('打开开关就让服务端启用该 provider', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(
      usageReport([
        ['codex', 'ok'],
        ['claude-quota', 'disabled'],
      ]),
    )
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /claude-quota/ }))
    await waitFor(() =>
      expect(savePlanUsageProviders).toHaveBeenCalledWith(['codex', 'claude-quota']),
    )
  })

  it('关闭开关就把它从启用列表里去掉', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(
      usageReport([
        ['codex', 'ok'],
        ['claude-quota', 'ok'],
      ]),
    )
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /Codex/ }))
    await waitFor(() => expect(savePlanUsageProviders).toHaveBeenCalledWith(['claude-quota']))
  })

  it('注册表为空时不显示该分区', async () => {
    vi.mocked(fetchPlanUsage).mockResolvedValue(usageReport([]))
    render(
      <AppearanceSettingsDialog
        settings={DEFAULT_APPEARANCE}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(fetchPlanUsage).toHaveBeenCalled())
    expect(screen.queryByText('计划用量')).toBeNull()
  })
})
