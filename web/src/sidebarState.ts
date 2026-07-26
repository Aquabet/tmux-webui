const KEY = 'sidebar-collapsed'

export function loadSidebarCollapsed(): boolean {
  return localStorage.getItem(KEY) === '1'
}

export function toggleSidebarCollapsed(current: boolean): boolean {
  const next = !current
  localStorage.setItem(KEY, next ? '1' : '0')
  return next
}
