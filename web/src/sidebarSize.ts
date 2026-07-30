const KEY = 'sidebar-width'

export const DEFAULT_SIDEBAR_WIDTH = 200
export const MIN_SIDEBAR_WIDTH = 64
export const MAX_SIDEBAR_WIDTH = 480
export const COMPACT_SIDEBAR_MAX_WIDTH = 128

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(Math.max(Math.round(width), MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH)
}

export function loadSidebarWidth(): number {
  const stored = Number(localStorage.getItem(KEY))
  return localStorage.getItem(KEY) === null || !Number.isFinite(stored)
    ? DEFAULT_SIDEBAR_WIDTH
    : clampSidebarWidth(stored)
}

export function saveSidebarWidth(width: number): number {
  const next = clampSidebarWidth(width)
  localStorage.setItem(KEY, String(next))
  return next
}

export function resizeSidebar(startWidth: number, startX: number, currentX: number): number {
  return clampSidebarWidth(startWidth + currentX - startX)
}
