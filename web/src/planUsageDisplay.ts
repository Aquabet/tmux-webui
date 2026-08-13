// 客户端「显示/隐藏」偏好只影响展示；采集哪些 provider 由服务端
// TMUX_WEBUI_USAGE_PROVIDERS 配置决定，这里藏起来不代表服务停止采集。

export const USAGE_DISPLAY_STORAGE_KEY = 'tmux-webui.usage-display.v1'

export function loadHiddenProviders(): string[] {
  try {
    const stored = localStorage.getItem(USAGE_DISPLAY_STORAGE_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export function saveHiddenProviders(ids: string[]): void {
  localStorage.setItem(USAGE_DISPLAY_STORAGE_KEY, JSON.stringify(ids))
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

export function formatResetIn(resetsAt: number, now: number): string | undefined {
  const remainMs = resetsAt - now
  if (remainMs <= 0) return undefined
  const minutes = Math.round(remainMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  if (days < 3 && restHours > 0) return `${days}d${restHours}h`
  return `${days}d`
}
