import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  APPEARANCE_STORAGE_KEY,
  THEMES,
  applyAppearance,
  fontById,
  loadAppearance,
  saveAppearance,
  themeById,
  type AppearanceSettings,
} from './appearance'

describe('appearance settings', () => {
  beforeEach(() => localStorage.clear())

  it('提供六套终端主题并默认使用 Tokyo Night', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual([
      'tokyo-night',
      'catppuccin-mocha',
      'dracula',
      'nord',
      'solarized-dark',
      'gruvbox-dark',
    ])
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('保存当前浏览器的主题、字体、字号、行高和光标', () => {
    const settings: AppearanceSettings = {
      theme: 'nord',
      font: 'jetbrains-mono',
      fontSize: 17,
      lineHeight: 1.2,
      cursorStyle: 'bar',
    }

    saveAppearance(settings)
    expect(loadAppearance()).toEqual(settings)
  })

  it('损坏或越界的本地设置回退到安全默认值', () => {
    localStorage.setItem(
      'tmux-webui.appearance.v1',
      JSON.stringify({
        theme: 'unknown',
        font: 'comic-sans',
        fontSize: 99,
        lineHeight: 9,
        cursorStyle: 'circle',
      }),
    )

    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('无法解析或字段不完整的本地设置回退到默认值', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{broken')
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE)

    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: 'nord' }))
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('接受字号上下界，并为未知主题和字体提供确定的回退', () => {
    saveAppearance({ ...DEFAULT_APPEARANCE, fontSize: 10 })
    expect(loadAppearance().fontSize).toBe(10)
    saveAppearance({ ...DEFAULT_APPEARANCE, fontSize: 24 })
    expect(loadAppearance().fontSize).toBe(24)

    expect(themeById('missing' as never).id).toBe('tokyo-night')
    expect(fontById('missing' as never).id).toBe('system-mono')
  })

  it('把主题应用到根节点供整页 CSS 变量读取', () => {
    applyAppearance({ ...DEFAULT_APPEARANCE, theme: 'dracula' })
    expect(document.documentElement.dataset.theme).toBe('dracula')
  })
})
