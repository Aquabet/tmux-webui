import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { fetchPlanUsage, type PlanUsageProvider } from './api'
import {
  CURSOR_OPTIONS,
  DEFAULT_APPEARANCE,
  FONT_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  THEMES,
  type AppearanceSettings,
  type FontId,
} from './appearance'
import { loadHiddenProviders, setProviderHidden, USAGE_DISPLAY_EVENT } from './planUsageDisplay'

// 设置面板里的用量开关只控制展示；服务端采集哪些 provider 由
// TMUX_WEBUI_USAGE_PROVIDERS 决定，这里看不到未启用的 provider
function UsageDisplaySection() {
  const [providers, setProviders] = useState<PlanUsageProvider[]>([])
  const [hidden, setHidden] = useState<string[]>(loadHiddenProviders)

  useEffect(() => {
    let stopped = false
    fetchPlanUsage()
      .then((report) => {
        if (!stopped) setProviders(report.providers)
      })
      .catch(() => undefined)
    const sync = () => setHidden(loadHiddenProviders())
    window.addEventListener(USAGE_DISPLAY_EVENT, sync)
    return () => {
      stopped = true
      window.removeEventListener(USAGE_DISPLAY_EVENT, sync)
    }
  }, [])

  if (providers.length === 0) return null

  return (
    <fieldset className="settings-field usage-display-field">
      <legend>用量显示</legend>
      <div className="usage-display-toggles">
        {providers.map((provider) => (
          <label key={provider.providerId} className="usage-display-toggle">
            <input
              type="checkbox"
              checked={!hidden.includes(provider.providerId)}
              onChange={(event) => setProviderHidden(provider.providerId, !event.target.checked)}
              aria-label={`显示 ${provider.displayName} 用量`}
            />
            <span>{provider.displayName}</span>
          </label>
        ))}
      </div>
      <small>只影响侧栏展示；采集哪些 provider 由服务端配置决定。</small>
    </fieldset>
  )
}

interface AppearanceSettingsDialogProps {
  settings: AppearanceSettings
  onChange: (settings: AppearanceSettings) => void
  onClose: () => void
}

type PreviewStyle = CSSProperties & Record<`--preview-${string}`, string>

export function AppearanceSettingsDialog({
  settings,
  onChange,
  onClose,
}: AppearanceSettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [])

  const update = <Key extends keyof AppearanceSettings>(key: Key, value: AppearanceSettings[Key]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="settings-backdrop">
      <button
        className="settings-dismiss"
        type="button"
        aria-label="关闭设置（背景）"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <p className="settings-eyebrow">TERMINAL APPEARANCE</p>
            <h2 id="settings-title">外观设置</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="settings-content">
          <fieldset className="settings-section">
            <legend>主题配色</legend>
            <div className="theme-grid">
              {THEMES.map((theme) => {
                const previewStyle: PreviewStyle = {
                  '--preview-bg': theme.preview.background,
                  '--preview-fg': theme.preview.foreground,
                  '--preview-accent': theme.preview.accent,
                  '--preview-green': theme.preview.green,
                  '--preview-yellow': theme.preview.yellow,
                  '--preview-red': theme.preview.red,
                }
                return (
                  <button
                    key={theme.id}
                    className="theme-card"
                    style={previewStyle}
                    type="button"
                    aria-pressed={settings.theme === theme.id}
                    onClick={() => update('theme', theme.id)}
                  >
                    <span className="theme-preview" aria-hidden="true">
                      <span className="preview-topbar">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="preview-line">
                        <b>❯</b> npm run dev
                      </span>
                      <span className="preview-line preview-muted">
                        ready on :8090 <em>█</em>
                      </span>
                    </span>
                    <span className="theme-meta">
                      <strong>{theme.label}</strong>
                      <small>{theme.description}</small>
                    </span>
                    <span className="theme-check" aria-hidden="true">
                      ✓
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="settings-controls">
            <label className="settings-field">
              <span>终端字体</span>
              <select
                aria-label="终端字体"
                value={settings.font}
                onChange={(event) => update('font', event.target.value as FontId)}
              >
                {FONT_OPTIONS.map((font) => (
                  <option key={font.id} value={font.id}>
                    {font.label}
                  </option>
                ))}
              </select>
              <small>字体需已安装在当前设备上，否则自动使用系统等宽字体。</small>
            </label>

            <label className="settings-field font-size-field">
              <span>
                终端字号 <output>{settings.fontSize}px</output>
              </span>
              <input
                aria-label="终端字号"
                type="range"
                min="10"
                max="24"
                step="1"
                value={settings.fontSize}
                onChange={(event) => update('fontSize', Number(event.target.value))}
              />
              <span className="range-labels" aria-hidden="true">
                <small>紧凑</small>
                <small>宽大</small>
              </span>
            </label>

            <fieldset className="settings-field segmented-field">
              <legend>行高</legend>
              <div className="segmented-control">
                {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                  <button
                    key={lineHeight}
                    type="button"
                    aria-pressed={settings.lineHeight === lineHeight}
                    onClick={() => update('lineHeight', lineHeight)}
                  >
                    {lineHeight.toFixed(1)}×
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="settings-field segmented-field">
              <legend>光标形状</legend>
              <div className="segmented-control">
                {CURSOR_OPTIONS.map((cursor) => (
                  <button
                    key={cursor.id}
                    type="button"
                    aria-pressed={settings.cursorStyle === cursor.id}
                    onClick={() => update('cursorStyle', cursor.id)}
                  >
                    {cursor.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <UsageDisplaySection />
          </div>
        </div>

        <footer className="settings-footer">
          <button
            className="secondary-button"
            type="button"
            onClick={() => onChange({ ...DEFAULT_APPEARANCE })}
          >
            恢复默认
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  )
}
