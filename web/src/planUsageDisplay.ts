// 折叠只是侧栏内的展开状态，存在本浏览器；启用与否由服务端的开关决定
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
  const current = loadCollapsedProviders()
  const next = collapsed
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((entry) => entry !== id)
  localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
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
