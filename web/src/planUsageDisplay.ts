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

// storage 事件只在跨标签页时触发，同页内组件（侧栏组件与设置面板）
// 靠这个自定义事件同步
export const USAGE_DISPLAY_EVENT = 'tmux-webui:usage-display-changed'

function toggleEntry(list: string[], id: string, present: boolean): string[] {
  if (present) return list.includes(id) ? list : [...list, id]
  return list.filter((entry) => entry !== id)
}

export function setProviderHidden(id: string, hidden: boolean): void {
  saveHiddenProviders(toggleEntry(loadHiddenProviders(), id, hidden))
  window.dispatchEvent(new Event(USAGE_DISPLAY_EVENT))
}

// 折叠只是侧栏内的展开状态，与设置面板的显示开关互相独立
const COLLAPSED_STORAGE_KEY = 'tmux-webui.usage-collapsed.v1'

export function loadCollapsedProviders(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export function setProviderCollapsed(id: string, collapsed: boolean): void {
  localStorage.setItem(
    COLLAPSED_STORAGE_KEY,
    JSON.stringify(toggleEntry(loadCollapsedProviders(), id, collapsed)),
  )
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
