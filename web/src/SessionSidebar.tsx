import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { VersionBadge } from './VersionBadge'
import { AgentBadge, TerminalBadge } from './AgentBadge'
import type { ApiSession } from './api'
import { ResourceUsage } from './ResourceUsage'
import {
  COMPACT_SIDEBAR_MAX_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
  resizeSidebar,
} from './sidebarSize'

interface Props {
  sessions: ApiSession[]
  selected: string | undefined
  onSelect: (name: string) => void
  onCreate: () => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
  onUpdateStarted: (session: string) => void
  onAuthLost: () => void
  onOpenSettings: () => void
  width: number
  onWidthChange: (width: number) => void
}

export function SessionSidebar({
  sessions,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onUpdateStarted,
  onAuthLost,
  onOpenSettings,
  width,
  onWidthChange,
}: Props) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number }>()
  const compact = width <= COMPACT_SIDEBAR_MAX_WIDTH

  useEffect(
    () => () => {
      document.body.classList.remove('sidebar-resizing')
    },
    [],
  )

  function handleResizeStart(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('sidebar-resizing')
    event.preventDefault()
  }

  function handleResizeMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onWidthChange(resizeSidebar(drag.startWidth, drag.startX, event.clientX))
  }

  function handleResizeEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    document.body.classList.remove('sidebar-resizing')
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = width - 16
    if (event.key === 'ArrowRight') next = width + 16
    if (event.key === 'Home') next = MIN_SIDEBAR_WIDTH
    if (event.key === 'End') next = MAX_SIDEBAR_WIDTH
    if (next === undefined) return
    event.preventDefault()
    onWidthChange(clampSidebarWidth(next))
  }

  return (
    <aside
      className={`sidebar${compact ? ' compact' : ''}`}
      style={{ '--sidebar-width': `${width}px` } as CSSProperties}
    >
      <div className="sidebar-heading">
        <h2>Sessions</h2>
        <button
          className="settings-trigger"
          type="button"
          onClick={onOpenSettings}
          aria-label="外观设置"
          title="外观设置"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.94 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.06 4.6a1.7 1.7 0 0 0 1.88-.34L17 4.2 19.83 7l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.59.65 1 1.25 1H21v4h-.35c-.6 0-1.11.41-1.25 1Z" />
          </svg>
        </button>
      </div>
      <div className="session-scroll">
        <ul>
          {sessions.map((s) => (
            <li key={s.name}>
              <button
                className={`session${s.name === selected ? ' selected' : ''}`}
                aria-label={s.name}
                title={s.name}
                onClick={() => onSelect(s.name)}
              >
                <span className="agent-badges">
                  {s.agents?.length ? (
                    s.agents.map((agent) => (
                      <AgentBadge key={agent.kind} agent={agent} attached={s.attached} />
                    ))
                  ) : (
                    <TerminalBadge attached={s.attached} />
                  )}
                </span>
                <span className="session-name">{s.name}</span>
              </button>
              <button
                className="session-action"
                title="重命名"
                aria-label={`重命名 ${s.name}`}
                onClick={() => onRename(s.name)}
              >
                ✎
              </button>
              <button
                className="session-action"
                title="删除"
                aria-label={`删除 ${s.name}`}
                onClick={() => onDelete(s.name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button className="new-session" aria-label="＋ 新建 session" onClick={onCreate}>
          <span aria-hidden="true">＋</span>
          <span className="new-session-label">新建 session</span>
        </button>
      </div>
      <div className="sidebar-footer">
        <VersionBadge onUpdateStarted={onUpdateStarted} onAuthLost={onAuthLost} />
        <ResourceUsage onAuthLost={onAuthLost} />
      </div>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整 session 侧栏宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onLostPointerCapture={handleResizeEnd}
        onKeyDown={handleResizeKeyDown}
      />
    </aside>
  )
}
